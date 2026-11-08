// Runs one scenario: real prompt, real tool handlers and real LLM over fake ports, driven by the
// simulated caller through the SDK testing API (`session.run`). Records a ScenarioRun.
import { AgentSession, inference, initializeLogger, type llm } from '@livekit/agents';
import { FakeDb } from 'db/fake';
import { ATTR, PARTICIPANT_KIND_SIP, SessionContext, readbackMatchScore, READBACK_MATCH_THRESHOLD, resolveIdentity, type Identity } from 'agent/src/context.ts';
import { makeLlmAffirmationJudge } from 'agent/src/memory.ts';
import { FakeDialPort, FakeSmsPort } from 'agent/src/ports/index.ts';
import { buildEnrollmentAgent, wireSessionEvents } from 'agent/src/session.ts';
import { rethrowIfCredit } from './credit.ts';
import { SimulatedCaller, type TranscriptLine } from './simulated-caller.ts';
import type { ScenarioDef } from './scenarios.ts';
import type { ScenarioRun, TimelineEvent } from './timeline.ts';

initializeLogger({ pretty: false, level: 'warn' });

export const DEMO_PHONE = '+17185550100';
const REAL_PHONE = '+17185550177';
const TURN_TIMEOUT_MS = 120_000;

export interface FinalState {
  bookings: number;
  callbacks: number;
  smsSent: number;
}

export interface HarnessResult {
  run: ScenarioRun;
  transcript: TranscriptLine[];
  /** Text of the memory the agent was given, an allowed grounding source. */
  memoryText: string;
  finalState: FinalState;
  error: string | null;
}

export function defaultLlm(): inference.LLM {
  return new inference.LLM({ model: (process.env['LK_LLM_MODEL'] || 'openai/gpt-6.1-terra') as inference.LLMModels });
}

async function buildIdentity(def: ScenarioDef, db: FakeDb): Promise<Identity> {
  const sipPhone = (phone: string) => resolveIdentity({ participantKind: PARTICIPANT_KIND_SIP, attributes: { [ATTR.sipPhone]: phone }, jobMetadata: null });
  switch (def.identity) {
    case 'sip-demo':
      return sipPhone(DEMO_PHONE);
    case 'sip-new':
      return sipPhone('+17185550123');
    case 'browser-demo':
      return resolveIdentity({
        participantKind: 0,
        attributes: { [ATTR.phone]: DEMO_PHONE, [ATTR.guardianName]: 'Jordan' },
        jobMetadata: def.variant === 'follow_up' ? JSON.stringify({ reason: 'follow_up' }) : null,
      });
    case 'browser-real-phone': {
      const real = await db.createFamily({ phone: REAL_PHONE, guardianName: 'Real Parent' });
      await db.upsertFamilySummary(real.id, 'Real Parent asked about U12 for Noah.', new Date());
      await db.findOrCreateChild(real.id, 'Noah', 11);
      return resolveIdentity({ participantKind: 0, attributes: { [ATTR.phone]: REAL_PHONE, [ATTR.guardianName]: 'Someone Else' }, jobMetadata: null });
    }
    case 'browser-anon':
      return resolveIdentity({ participantKind: 0, attributes: {}, jobMetadata: null });
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function runScenario(def: ScenarioDef, models: { agentLlm: llm.LLM; callerLlm: llm.LLM }): Promise<HarnessResult> {
  const db = new FakeDb({ demoPhone: DEMO_PHONE });
  const sms = new FakeSmsPort();
  const identity = await buildIdentity(def, db);
  const sc = new SessionContext({
    identity,
    db,
    sms,
    dial: new FakeDialPort(),
    judge: makeLlmAffirmationJudge(models.agentLlm),
    features: { sms: def.profile === 'sms', guardian: def.profile === 'guardian' },
    roomName: `eval-${def.id}`,
  });
  await sc.bindFamily();
  const memoryText = sc.familyHasHistory && sc.family ? [sc.family.summary ?? '', ...sc.family.children.map((c) => `${c.name} age ${c.age}`)].join(' ') : '';

  const agent = buildEnrollmentAgent(sc, { academyName: 'Brooklyn Youth Soccer Academy', personaName: 'Maya', variant: def.variant ?? 'inbound' });
  const session = new AgentSession<SessionContext>({ llm: models.agentLlm, userData: sc });
  wireSessionEvents(session, sc);

  const timeline: TimelineEvent[] = [];
  const readbacks: ScenarioRun['readbacks'] = [];
  const transcript: TranscriptLine[] = [];
  const outputByCall = new Map<string, string>();
  const seenItems = new Set<string>();
  let seq = 0;
  let turnsUsed = 0;
  let endedBy: ScenarioRun['endedBy'] = 'max_turns';
  let error: string | null = null;
  const caller = new SimulatedCaller(models.callerLlm, { persona: def.persona, goal: def.goal, script: def.script });

  const pushUser = (text: string, itemId?: string) => {
    timeline.push({ kind: 'user', text, at: seq++, ...(itemId ? { itemId } : {}) });
    transcript.push({ role: 'caller', text });
  };

  // Folds a run's events (agent-side items) into the timeline, deduplicated by item id.
  const absorb = (events: readonly { type: string; item: object }[]) => {
    for (const ev of events) {
      const item = ev.item as Record<string, unknown>;
      const id = typeof item['id'] === 'string' ? (item['id'] as string) : undefined;
      if (id && seenItems.has(id)) continue;
      if (id) seenItems.add(id);
      if (ev.type === 'message') {
        const role = item['role'];
        const text = typeof item['textContent'] === 'string' ? (item['textContent'] as string) : '';
        if (role === 'assistant' && text) {
          timeline.push({ kind: 'assistant', text, at: seq++, ...(id ? { itemId: id } : {}), interrupted: Boolean(item['interrupted']) });
          transcript.push({ role: 'agent', text });
        }
        // user messages are recorded by the loop with the caller's own text
      } else if (ev.type === 'function_call') {
        const callId = String(item['callId'] ?? id ?? '');
        timeline.push({ kind: 'tool_call', name: String(item['name']), args: parseArgs(String(item['args'] ?? '{}')), callId, at: seq++ });
      } else if (ev.type === 'function_call_output') {
        const callId = String(item['callId'] ?? '');
        const output = String(item['output'] ?? '');
        const name = String(item['name'] ?? '');
        timeline.push({ kind: 'tool_output', name, callId, output, isError: Boolean(item['isError']), at: seq++ });
        outputByCall.set(callId, output);
        if (name === 'propose_booking') {
          const call = timeline.find((e) => e.kind === 'tool_call' && e.callId === callId);
          let readbackText: string | null = null;
          try {
            const parsed: unknown = JSON.parse(output);
            if (parsed && typeof parsed === 'object' && typeof (parsed as { readbackText?: unknown }).readbackText === 'string') readbackText = (parsed as { readbackText: string }).readbackText;
          } catch {
            readbackText = null;
          }
          if (readbackText && call && call.kind === 'tool_call') {
            const proposed = sc.proposals.history.filter((h) => h.kind === 'proposed');
            readbacks.push({
              proposalId: proposed[readbacks.length]?.proposalId ?? `prop-${readbacks.length + 1}`,
              readbackText,
              programId: argString(call.args, 'program_id'),
              slotId: argString(call.args, 'slot_id'),
              childName: argString(call.args, 'child_name'),
            });
          }
        }
      }
    }
  };

  const lastAgentIsReadback = (): boolean => {
    const last = readbacks.at(-1);
    const lastAgent = [...timeline].reverse().find((e) => e.kind === 'assistant');
    const lastEvent = timeline.at(-1);
    return Boolean(last && lastAgent && lastEvent === lastAgent && readbackMatchScore(last.readbackText, lastAgent.text) >= READBACK_MATCH_THRESHOLD);
  };

  try {
    await session.start({ agent });
    // The greeting is generated by onEnter, outside any run; read it from the history once
    // the first turn has settled (below). Until then the caller sees an empty transcript.
    for (let i = 0; i < def.maxTurns; i++) {
      const turn = await caller.nextTurn(transcript, { readbackCount: readbacks.length, lastAgentIsReadback: lastAgentIsReadback() });
      if (turn.kind === 'done') {
        endedBy = turn.refused ? 'refusal' : 'goal';
        break;
      }
      turnsUsed += 1;
      const result = await withTimeout(session.run({ userInput: turn.text }).wait(), TURN_TIMEOUT_MS, `turn ${turnsUsed}`);
      // Greeting (assistant message before the first user turn) comes from the history.
      if (turnsUsed === 1) {
        const greeting = session.history.items.find((it) => it.type === 'message' && it.role === 'assistant');
        if (greeting && greeting.type === 'message' && greeting.textContent && !seenItems.has(greeting.id)) {
          const inRun = result.events.some((e) => (e.item as { id?: string }).id === greeting.id);
          if (!inRun) {
            seenItems.add(greeting.id);
            timeline.push({ kind: 'assistant', text: greeting.textContent, at: seq++, itemId: greeting.id, interrupted: greeting.interrupted });
            transcript.push({ role: 'agent', text: greeting.textContent });
          }
        }
      }
      const userItem = [...session.history.items].reverse().find((it) => it.type === 'message' && it.role === 'user' && it.textContent === turn.text);
      pushUser(turn.text, userItem?.id);
      absorb(result.events);
      if (sc.endRequested) {
        endedBy = 'end_call';
        break;
      }
    }
  } catch (err) {
    // An inference credit error is not an agent failure: stop the run instead of scoring it.
    rethrowIfCredit(err, 'agent LLM');
    error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      await session.close();
    } catch {
      // already closed by end_call
    }
  }

  const run: ScenarioRun = {
    scenarioId: String(def.id),
    profile: def.profile,
    timeline,
    db,
    sc,
    proposalHistory: [...sc.proposals.history],
    readbacks,
    affirmations: sc.proposals.verdicts.map((v) => ({ itemId: v.itemId, text: v.text, verdict: v.verdict })),
    forbiddenTools: def.forbiddenTools,
    turnsUsed,
    endedBy,
  };
  return { run, transcript, memoryText, finalState: { bookings: db.bookings.size, callbacks: db.callbacks.size, smsSent: sms.sent.length }, error };
}
