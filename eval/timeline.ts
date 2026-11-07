// Conversation timeline recorded by the eval runner: ordered user turns, assistant turns and tool
// calls, plus the final fake DB state. Consumed by eval/invariants.ts and eval/scorers.ts.
import type { FakeDb } from 'db/fake';
import type { ProposalEvent, SessionContext } from 'agent/src/context.ts';

export type TimelineEvent =
  | { kind: 'user'; text: string; at: number; itemId?: string }
  | { kind: 'assistant'; text: string; at: number; itemId?: string; interrupted?: boolean }
  | { kind: 'tool_call'; name: string; args: Record<string, unknown>; callId: string; at: number }
  | { kind: 'tool_output'; name: string; callId: string; output: string; isError: boolean; at: number };

export interface ScenarioRun {
  scenarioId: string;
  profile: string;
  timeline: TimelineEvent[];
  db: FakeDb;
  sc: SessionContext;
  proposalHistory: ProposalEvent[];
  /** Readback texts returned by propose_booking, in order. */
  readbacks: { proposalId: string; readbackText: string; programId: string; slotId: string; childName: string }[];
  /** Judge verdicts recorded by the context for each user turn after a read-back. */
  affirmations: { itemId: string | undefined; text: string; verdict: 'yes' | 'no' | 'other' | null }[]; // copy of sc.proposals.verdicts
  forbiddenTools: string[];
  turnsUsed: number;
  endedBy: 'goal' | 'refusal' | 'max_turns' | 'end_call';
}
