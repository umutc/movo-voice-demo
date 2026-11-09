// Shape of metrics/<callId>.json (PRD FR-10). Every value is measured; null means "not reported".
export interface TurnMetrics {
  turnId: string;
  at: string;
  e2eMs: number | null;
  endOfTurnMs: number | null;
  transcriptionDelayMs: number | null;
  llmTtftMs: number | null;
  ttsTtfbMs: number | null;
  interrupted: boolean;
}

export interface CallMetricsFile {
  v: 1;
  callId: string | null;
  roomName: string;
  identitySource: string;
  startedAt: string;
  endedAt: string | null;
  pipeline: { stt: string; llm: string; tts: string; provider?: 'inference' | 'direct' };
  turns: TurnMetrics[];
  interruptions: number;
  usage: unknown;
}
