// SmsPort: the only way the agent would send a text message. Only the fake exists: agent.ts wires
// it for live runs too, and no Twilio adapter or SMS tool is built yet.

export type SmsResult = { ok: true; messageId: string } | { ok: false; reason: string };

export interface SmsPort {
  send(to: string, body: string): Promise<SmsResult>;
}

export class FakeSmsPort implements SmsPort {
  readonly sent: { to: string; body: string }[] = [];
  private seq = 0;
  private readonly failWith: string | undefined;
  constructor(failWith?: string) {
    this.failWith = failWith;
  }

  async send(to: string, body: string): Promise<SmsResult> {
    if (this.failWith) return { ok: false, reason: this.failWith };
    this.sent.push({ to, body });
    this.seq += 1;
    return { ok: true, messageId: `fake-sms-${this.seq}` };
  }

  reset(): void {
    this.sent.length = 0;
    this.seq = 0;
  }
}
