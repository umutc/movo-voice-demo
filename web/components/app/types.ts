// Shared client types. The state snapshot mirrors agent/src/state-channel.ts (StateSnapshot).
export interface Pipeline {
  stt: string;
  llm: string;
  tts: string;
}

export interface FormValues {
  guardianName: string;
  phone: string;
  email: string;
  consent: boolean;
}

export interface StateSnapshot {
  v: 1;
  callId: string | null;
  roomName: string;
  identitySource: 'caller_id_only' | 'self_reported';
  family: { bound: boolean; label: string | null; isDemo: boolean | null; hasHistory: boolean };
  pipeline: Pipeline;
  proposal: { state: string; summary: string | null; clearedBecause: string | null; readbackText: string | null } | null;
  toolCalls: { name: string; ok: boolean; summary: string; durationMs: number | null; at: string }[];
  lastTurn: { e2eMs: number | null; endOfTurnMs: number | null; llmTtftMs: number | null; ttsTtfbMs: number | null } | null;
  interruptions: number;
  bookingIds: string[];
  outcome: string;
  ended: boolean;
}

export interface TranscriptLine {
  id: string;
  role: 'agent' | 'user';
  text: string;
  at: number;
}

export const ATTR = {
  guardianName: 'movo.guardian_name',
  phone: 'movo.phone',
  email: 'movo.email',
  consent: 'movo.consent',
} as const;
