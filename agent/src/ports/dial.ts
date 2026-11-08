// DialPort: the only way the agent would place an outbound call. Only the fake exists: agent.ts
// wires it for live runs too, and no LiveKit SIP adapter is built yet.

export type DialResult =
  | { ok: true; participantIdentity: string }
  | { ok: false; reason: 'no_answer' | 'busy' | 'failed'; detail?: string };

export interface DialPort {
  dial(opts: { roomName: string; phone: string; timeoutMs: number }): Promise<DialResult>;
}

export class FakeDialPort implements DialPort {
  readonly calls: { roomName: string; phone: string }[] = [];
  private readonly outcome: DialResult;
  constructor(outcome: DialResult = { ok: true, participantIdentity: 'sip-fake' }) {
    this.outcome = outcome;
  }

  async dial(opts: { roomName: string; phone: string; timeoutMs: number }): Promise<DialResult> {
    this.calls.push({ roomName: opts.roomName, phone: opts.phone });
    return this.outcome;
  }
}
