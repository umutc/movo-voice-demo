import {
  AgentSession,
  AgentSessionEventTypes,
  type JobContext,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  log,
} from '@livekit/agents';
import { fileURLToPath } from 'node:url';
import { openDb } from 'db';
import { DrizzleOps } from 'db/ops';
import { agentAlerter, autoPause, watchProviderErrors } from './alerts.ts';
import { loadConfig } from './config.ts';
import { ATTR, PARTICIPANT_KIND_SIP, resolveIdentity, SessionContext } from './context.ts';
import { admitPhoneCall, buildClosedLineAgent, startCallTimer } from './limits.ts';
import { closeCall, makeLlmAffirmationJudge, openCall } from './memory.ts';
import { attachMetrics } from './metrics.ts';
import { buildModels } from './models.ts';
import { attachUsageMeter, pipelineLabels } from './cost.ts';
import { runPostCallBudget } from './budget.ts';
import { checkDbPause, endPausedJob } from './pause.ts';
import { FakeDialPort, FakeSmsPort } from './ports/index.ts';
import { buildEnrollmentAgent, wireSessionEvents } from './session.ts';
import { STATE_TOPIC, StateChannel } from './state-channel.ts';
import { setupTracing } from './tracing.ts';

// Worker entry. Identity comes from server-reported facts (participant kind, SIP attributes,
// dispatch metadata), the family is bound once here, tools read it from the session context.
// Real ports are wired here only; tests and evals use fakes (CLAUDE.md hard rule 6).

// Finalizers keyed by job, run from onSessionEnd (the worker waits for it) or job shutdown.
const finalizers = new WeakMap<JobContext, (reason: string) => Promise<void>>();

export default defineAgent({
  onSessionEnd: async (ctx: JobContext) => {
    await finalizers.get(ctx)?.('session end');
  },
  entry: async (ctx: JobContext) => {
    const cfg = loadConfig();
    const logger = log();
    // DEMO_PAUSED: end the call before any database, session or inference work.
    if (cfg.DEMO_PAUSED) {
      await endPausedJob(ctx, logger);
      return;
    }
    const { port: db, db: drizzleDb, close: closeDb } = openDb(cfg.DATABASE_URL);
    // Ops state on the same connection: the demo_state pause row and the alert dedupe log.
    const ops = new DrizzleOps(drizzleDb);
    const alerter = agentAlerter(ops, logger);
    // demo_state: the database pause switch. A failed check fails closed: the call ends and one
    // fail_closed alert goes out (deduped), because the spend guards cannot run without the database.
    const pause = await checkDbPause(ops);
    if (!pause.ok || pause.state.paused) {
      if (!pause.ok) logger.warn({ error: pause.error }, 'pause check failed: refusing the call (fail closed)');
      await endPausedJob(ctx, logger, pause.ok ? 'demo_state' : 'pause check failed', async () => {
        if (!pause.ok) await alerter.send('fail_closed', { detail: 'agent pause check' });
        await closeDb();
      });
      return;
    }
    // Braintrust: SDK spans over OTLP plus manual call/tool spans (agent/src/tracing.ts). Off without a key.
    const tracing = setupTracing({
      enabled: Boolean(cfg.BRAINTRUST_API_KEY),
      ...(cfg.BRAINTRUST_API_KEY ? { apiKey: cfg.BRAINTRUST_API_KEY } : {}),
      project: cfg.BRAINTRUST_PROJECT,
      metadata: { 'movo.job_id': ctx.job.id, 'movo.room': ctx.job.room?.name ?? 'unknown' },
    });

    await ctx.connect();
    // Console and debugger sessions are fake jobs without a remote participant: treat them as a
    // self-reported browser session with no attributes.
    const participant = ctx.isFakeJob ? null : await ctx.waitForParticipant();
    // Dev-only knob for console and debugger sessions (fake jobs, no room): pretend the caller id
    // is CONSOLE_SIMULATE_SIP_PHONE so returning-family memory can be exercised without a phone.
    // Never consulted when a real participant exists.
    const simulatedSip = ctx.isFakeJob ? process.env.CONSOLE_SIMULATE_SIP_PHONE?.trim() : undefined;
    const identity = resolveIdentity({
      participantKind: participant?.kind ?? (simulatedSip ? PARTICIPANT_KIND_SIP : null),
      attributes: participant?.attributes ?? (simulatedSip ? { [ATTR.sipPhone]: simulatedSip } : {}),
      jobMetadata: ctx.job.metadata || null,
    });
    const direction = identity.source === 'caller_id_only' ? 'inbound' : identity.reason === 'follow_up' ? 'outbound' : 'browser';

    // MODEL_PROVIDER: LiveKit Inference or the direct Deepgram and OpenAI plugins (agent/src/models.ts).
    const models = buildModels(cfg);
    const llmModel = models.llm;
    // Counts STT audio, TTS characters and LLM tokens from each model's own metrics, so the
    // post-call summary and the affirmation judge (same LLM instance) are counted too.
    const usageMeter = attachUsageMeter(models);
    const sc = new SessionContext({
      identity,
      db,
      // SMS and dial are fakes only: no Twilio adapter and no SMS tool exist yet.
      sms: new FakeSmsPort(),
      dial: new FakeDialPort(),
      judge: makeLlmAffirmationJudge(llmModel),
      // SMS stays off in the prompt whatever FEATURE_SMS says, so the agent never offers a text it cannot send.
      features: { sms: false, guardian: false },
      roomName: ctx.room.name ?? 'unknown',
    });
    // Daily demo cap for phone calls. Browser calls were counted by the web token route, so only
    // real SIP participants are checked here. A refused call gets one sentence and no call row.
    const admission =
      participant?.kind === PARTICIPANT_KIND_SIP ? await admitPhoneCall(db, cfg.DEMO_LIMIT_GLOBAL_PER_DAY, sc.now()) : { admitted: true };
    if (admission.admitted) {
      await sc.bindFamily();
      await openCall(sc, direction);
      tracing?.startCall(sc);
    } else {
      logger.warn({ error: admission.error ?? null }, 'phone call refused: daily demo limit');
      // A failed count is fail_closed; a full day is daily_limit. Not awaited: the caller hears the
      // closed-line sentence at once, and Alerter.send never throws.
      void alerter.send(admission.error ? 'fail_closed' : 'daily_limit', { detail: admission.error ? 'agent phone usage count' : 'phone call refused' });
    }
    logger.info(
      { identitySource: identity.source, hasPhone: Boolean(identity.phone), familyBound: Boolean(sc.familyId), history: sc.familyHasHistory, callId: sc.callId },
      'session identity resolved',
    );

    const agent = admission.admitted
      ? buildEnrollmentAgent(sc, {
          academyName: cfg.DEMO_ACADEMY_NAME,
          personaName: cfg.DEMO_AGENT_PERSONA_NAME,
          variant: identity.reason === 'follow_up' ? 'follow_up' : 'inbound',
        })
      : buildClosedLineAgent();

    const sttModel = models.stt;
    const ttsModel = models.tts;
    const session = new AgentSession<SessionContext>({
      userData: sc,
      vad: new inference.VAD({ model: 'silero' }),
      stt: sttModel,
      llm: llmModel,
      tts: ttsModel,
      ttsTextTransforms: ['filter_markdown', 'filter_emoji'],
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        interruption: { mode: 'adaptive', resumeFalseInterruption: true, falseInterruptionTimeout: 1000 },
        endpointing: { mode: 'dynamic', minDelay: 300, maxDelay: 3000 },
        preemptiveGeneration: { enabled: true },
      },
    });
    wireSessionEvents(session, sc);
    // Automatic pause: the first credit, quota or auth error from any model pauses the demo in the
    // database, sends one provider_credit alert, and ends this call, so the caller does not sit
    // with a silent agent and the next visitor sees the paused notice.
    watchProviderErrors({ stt: sttModel, llm: llmModel, tts: ttsModel }, (cls, source) => {
      logger.warn({ kind: cls.kind, detail: cls.detail, source }, 'provider credit, quota or auth error');
      void autoPause(ops, alerter, cls, source, new Date(), logger).finally(() => session.shutdown({ drain: false, reason: 'provider_credit' }));
    });
    tracing?.attach(session);

    // "Under the hood" snapshots for the browser demo: real state only, best effort delivery.
    const pipeline = pipelineLabels(cfg);
    const state = new StateChannel(pipeline);
    if (!ctx.isFakeJob) {
      state.attach({
        send: async (text) => {
          await ctx.room.localParticipant?.sendText(text, { topic: STATE_TOPIC });
        },
      });
    }
    sc.onChange = () => state.push(sc);
    session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      if (ev.item.type === 'message' && ev.item.role === 'assistant' && ev.item.interrupted) state.interruptions += 1;
      state.push(sc);
    });
    session.on(AgentSessionEventTypes.FunctionToolsExecuted, () => state.push(sc));
    // Per-turn latency from ChatMessage.metrics and plugin metrics -> metrics/<callId>.json (FR-10).
    const metrics = attachMetrics(session, sc, state, pipeline);

    // Summary + call row finish run once, whichever comes first: session close or job shutdown.
    let finalized: Promise<void> | null = null;
    const finalize = (reason: string): Promise<void> => {
      finalized ??= (async () => {
        const endedAt = sc.now();
        let metricsPath: string | null = null;
        try {
          metricsPath = await metrics.flush(endedAt);
        } catch (err) {
          logger.warn({ err }, 'metrics flush failed');
        }
        const { summary, error } = await closeCall(sc, llmModel, session.history.items, { metrics: metrics.snapshot(), traceId: tracing?.traceId ?? null });
        tracing?.finish(sc, { summary, outcome: sc.outcome });
        // Cost, budget and balance checks: after the call ended (the caller is gone), bounded by a
        // timeout, never throws. Awaited only so the database stays open until it settles.
        const budget = runPostCallBudget({ cfg, ops, alerter, logger, callId: sc.callId, usage: usageMeter.totals(), now: sc.now() });
        logger.info({ reason, outcome: sc.outcome, summaryWritten: Boolean(summary), error, metricsPath, turns: metrics.turns.length, usage: session.usage }, 'call closed');
        await budget;
        await closeDb();
      })();
      return finalized;
    };
    finalizers.set(ctx, finalize);
    // Max call length timer, started once the session runs, cleared on close.
    let stopCallTimer: () => void = () => {};
    session.on(AgentSessionEventTypes.Close, (ev) => {
      stopCallTimer();
      logger.info({ reason: ev.reason, room: ctx.room.name }, 'session closed');
      state.ended = true;
      state.push(sc);
      // End the job when the session ends (end_call, caller hung up, error). The worker then runs
      // onSessionEnd (summary + call row) and the shutdown callbacks before it disconnects.
      ctx.shutdown(`session closed: ${String(ev.reason)}`);
    });
    ctx.addShutdownCallback(async () => {
      await finalize('job shutdown');
      await tracing?.shutdown();
    });

    // deleteRoomOnClose: the browser sees the room go away when the agent hangs up (end_call).
    await session.start({ agent, room: ctx.room, inputOptions: { deleteRoomOnClose: true } });
    state.push(sc);
    // At DEMO_MAX_CALL_SECONDS: a short goodbye, then the same drain shutdown end_call uses, so
    // the Close handler and finalize() run as for any other call end.
    if (!state.ended) {
      stopCallTimer = startCallTimer(session, cfg.DEMO_MAX_CALL_SECONDS, () => {
        logger.info({ maxSeconds: cfg.DEMO_MAX_CALL_SECONDS }, 'max call length reached, ending the call');
      });
    }
  },
});

// The worker CLI (dev | start | console | download-files). Skipped under Vitest.
if (process.env.VITEST === undefined) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: process.env.AGENT_NAME?.trim() || 'enroll-agent',
    }),
  );
}
