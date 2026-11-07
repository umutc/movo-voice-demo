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
import { loadConfig, splitTtsModel } from './config.ts';
import { ATTR, PARTICIPANT_KIND_SIP, resolveIdentity, SessionContext } from './context.ts';
import { closeCall, makeLlmAffirmationJudge, openCall } from './memory.ts';
import { FakeDialPort, FakeSmsPort } from './ports/index.ts';
import { buildEnrollmentAgent, wireSessionEvents } from './session.ts';
import { STATE_TOPIC, StateChannel } from './state-channel.ts';

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
    const { port: db, close: closeDb } = openDb(cfg.DATABASE_URL);

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

    const llmModel = new inference.LLM({ model: cfg.LK_LLM_MODEL });
    const sc = new SessionContext({
      identity,
      db,
      // SMS and dial stay fake until FEATURE_SMS / FEATURE_OUTBOUND wire real adapters (Phase 9, stretch).
      sms: new FakeSmsPort(),
      dial: new FakeDialPort(),
      judge: makeLlmAffirmationJudge(llmModel),
      features: { sms: cfg.FEATURE_SMS, guardian: false },
      roomName: ctx.room.name ?? 'unknown',
    });
    await sc.bindFamily();
    await openCall(sc, direction);
    logger.info(
      { identitySource: identity.source, hasPhone: Boolean(identity.phone), familyBound: Boolean(sc.familyId), history: sc.familyHasHistory, callId: sc.callId },
      'session identity resolved',
    );

    const agent = buildEnrollmentAgent(sc, {
      academyName: cfg.DEMO_ACADEMY_NAME,
      personaName: cfg.DEMO_AGENT_PERSONA_NAME,
      variant: identity.reason === 'follow_up' ? 'follow_up' : 'inbound',
    });

    const tts = splitTtsModel(cfg.LK_TTS_MODEL);
    const session = new AgentSession<SessionContext>({
      userData: sc,
      vad: new inference.VAD({ model: 'silero' }),
      stt: new inference.STT({ model: cfg.LK_STT_MODEL, language: 'en' }),
      llm: llmModel,
      tts: new inference.TTS({ model: tts.model, ...(tts.voice ? { voice: tts.voice } : {}), language: 'en' }),
      ttsTextTransforms: ['filter_markdown', 'filter_emoji'],
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        interruption: { mode: 'adaptive', resumeFalseInterruption: true, falseInterruptionTimeout: 1000 },
        endpointing: { mode: 'dynamic', minDelay: 300, maxDelay: 3000 },
        preemptiveGeneration: { enabled: true },
      },
    });
    wireSessionEvents(session, sc);

    // "Under the hood" snapshots for the browser demo: real state only, best effort delivery.
    const state = new StateChannel({ stt: cfg.LK_STT_MODEL, llm: cfg.LK_LLM_MODEL, tts: cfg.LK_TTS_MODEL });
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

    // Summary + call row finish run once, whichever comes first: session close or job shutdown.
    let finalized: Promise<void> | null = null;
    const finalize = (reason: string): Promise<void> => {
      finalized ??= (async () => {
        const { summary, error } = await closeCall(sc, llmModel, session.history.items);
        logger.info({ reason, outcome: sc.outcome, summaryWritten: Boolean(summary), error, usage: session.usage }, 'call closed');
        await closeDb();
      })();
      return finalized;
    };
    finalizers.set(ctx, finalize);
    session.on(AgentSessionEventTypes.Close, (ev) => {
      logger.info({ reason: ev.reason, room: ctx.room.name }, 'session closed');
      state.ended = true;
      state.push(sc);
      // End the job when the session ends (end_call, caller hung up, error). The worker then runs
      // onSessionEnd (summary + call row) and the shutdown callbacks before it disconnects.
      ctx.shutdown(`session closed: ${String(ev.reason)}`);
    });
    ctx.addShutdownCallback(() => finalize('job shutdown'));

    // deleteRoomOnClose: the browser sees the room go away when the agent hangs up (end_call).
    await session.start({ agent, room: ctx.room, inputOptions: { deleteRoomOnClose: true } });
    state.push(sc);
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
