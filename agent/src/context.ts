// Per-session context: identity and trust level, bound family, booking proposal state machine,
// call row id. Tools read everything they need from here (CLAUDE.md hard rule 4). No SDK imports,
// so the state machine is unit-testable without a session.
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { DbPort, FamilyWithDetails, IdentitySource } from 'db/port';
import type { DialPort, SmsPort } from './ports/index.ts';

// ---------- identity ----------

/** Participant attribute keys the browser token endpoint is allowed to set (PRD section 3.3). */
export const ATTR = {
  guardianName: 'movo.guardian_name',
  phone: 'movo.phone',
  email: 'movo.email',
  consent: 'movo.consent',
  sipPhone: 'sip.phoneNumber',
} as const;

/** Mirrors @livekit/rtc-node ParticipantKind.SIP (3). Compared by value so this file stays SDK-free. */
export const PARTICIPANT_KIND_SIP = 3;

export interface Identity {
  source: IdentitySource;
  /** E.164 or null. For `caller_id_only` the SIP caller id; for `self_reported` the form or metadata value. */
  phone: string | null;
  guardianName: string | null;
  email: string | null;
  /** Dispatch metadata reason, e.g. `follow_up` for outbound calls. */
  reason: string | null;
  /** Family id from dispatch metadata (self-reported, only honored when the family is a demo family). */
  claimedFamilyId: string | null;
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), 'US');
  // isPossible (length and prefix shape), not isValid: synthetic 555 numbers must pass, and caller
  // id is never trusted as verification anyway.
  return parsed?.isPossible() ? parsed.number : null;
}

/**
 * Resolves identity from server-reported facts only. The participant kind decides the trust
 * level: SIP participants are `caller_id_only`; everything else is `self_reported` (browser form
 * attributes or dispatch metadata). Attributes never upgrade trust.
 */
export function resolveIdentity(input: {
  participantKind: number | null;
  attributes: Record<string, string>;
  jobMetadata: string | null;
}): Identity {
  let metadata: Record<string, unknown> = {};
  if (input.jobMetadata) {
    try {
      const parsed: unknown = JSON.parse(input.jobMetadata);
      if (parsed && typeof parsed === 'object') metadata = parsed as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  if (input.participantKind === PARTICIPANT_KIND_SIP) {
    return {
      source: 'caller_id_only',
      phone: normalizePhone(input.attributes[ATTR.sipPhone]),
      guardianName: null,
      email: null,
      reason: str(metadata['reason']),
      claimedFamilyId: null,
    };
  }
  return {
    source: 'self_reported',
    phone: normalizePhone(input.attributes[ATTR.phone] ?? str(metadata['phone'])),
    guardianName: str(input.attributes[ATTR.guardianName]) ?? str(metadata['guardianName']),
    email: str(input.attributes[ATTR.email]) ?? str(metadata['email']),
    reason: str(metadata['reason']),
    claimedFamilyId: str(metadata['familyId']),
  };
}

// ---------- booking proposal state machine (PRD FR-14) ----------

export type ProposalState = 'pending' | 'readback_spoken' | 'confirmed' | 'cleared' | 'consumed';

export interface ProposalDetails {
  programId: string;
  slotId: string;
  childName: string;
  childAge: number;
  guardianName: string;
}

export interface Proposal extends ProposalDetails {
  proposalId: string;
  readbackText: string;
  state: ProposalState;
  /** Why the proposal left the live path, for logs and the UI aside. */
  clearedBecause: string | null;
}

export type Affirmation = 'yes' | 'no' | 'other';
/** Classifies the user's reply to the read-back. Production uses the LLM; tests inject a fake. */
export type AffirmationJudge = (readbackText: string, userReply: string) => Promise<Affirmation>;

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeSpeech(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Share of read-back tokens present in the spoken text, in order-insensitive multiset terms. */
export function readbackMatchScore(readbackText: string, spoken: string): number {
  const want = normalizeSpeech(readbackText);
  if (want.length === 0) return 0;
  const have = new Map<string, number>();
  for (const t of normalizeSpeech(spoken)) have.set(t, (have.get(t) ?? 0) + 1);
  let hit = 0;
  for (const t of want) {
    const n = have.get(t) ?? 0;
    if (n > 0) {
      hit += 1;
      have.set(t, n - 1);
    }
  }
  return hit / want.length;
}

export const READBACK_MATCH_THRESHOLD = 0.8;

export interface ProposalEvent {
  at: Date;
  kind: 'proposed' | 'readback_spoken' | 'confirmed' | 'cleared' | 'consumed';
  proposalId: string;
  detail?: string;
}

export class ProposalMachine {
  current: Proposal | null = null;
  readonly history: ProposalEvent[] = [];
  private seq = 0;
  /** In-flight verdict for the user turn after the read-back; tools await it via settle(). */
  private pending: Promise<Affirmation | null> | null = null;
  private readonly seenUserItems = new Set<string>();
  /** Judge verdicts per user turn that followed a read-back; read by the eval invariants. */
  readonly verdicts: { itemId: string | undefined; text: string; verdict: Affirmation | null }[] = [];

  propose(details: ProposalDetails, readbackText: string): Proposal {
    if (this.current && (this.current.state === 'pending' || this.current.state === 'readback_spoken' || this.current.state === 'confirmed')) {
      this.transition('cleared', 'replaced by a new proposal');
    }
    this.seq += 1;
    this.current = {
      ...details,
      childName: details.childName.trim(),
      proposalId: `prop-${this.seq}`,
      readbackText,
      state: 'pending',
      clearedBecause: null,
    };
    this.history.push({ at: new Date(), kind: 'proposed', proposalId: this.current.proposalId });
    return this.current;
  }

  /** Assistant message committed to the conversation (after playout, with the interrupted flag). */
  onAssistantMessage(text: string | undefined, interrupted: boolean): void {
    const p = this.current;
    if (!p) return;
    if (p.state === 'pending') {
      if (!text) return;
      if (readbackMatchScore(p.readbackText, text) >= READBACK_MATCH_THRESHOLD) {
        if (interrupted) this.transition('cleared', 'read-back was interrupted');
        else this.transition('readback_spoken');
      }
      return;
    }
    if (p.state === 'readback_spoken') {
      // Any further assistant turn before the user's reply breaks the chain.
      this.transition('cleared', 'another assistant turn after the read-back');
    }
  }

  /** A tool ran. Only matters between the read-back and the user's reply. */
  onToolExecuted(toolName: string): void {
    const p = this.current;
    if (p && p.state === 'readback_spoken') this.transition('cleared', `tool ${toolName} ran after the read-back`);
  }

  /**
   * Committed user message from the session (fires in text and audio mode). Starts the verdict
   * without blocking the pipeline; `book_trial_class` awaits it through settle().
   */
  onUserMessage(itemId: string, userText: string | undefined, judge: AffirmationJudge): void {
    if (this.seenUserItems.has(itemId)) return;
    this.seenUserItems.add(itemId);
    if (!this.current || (this.current.state !== 'pending' && this.current.state !== 'readback_spoken')) return;
    this.pending = this.onUserTurn(userText, judge)
      .then((verdict) => {
        this.verdicts.push({ itemId, text: userText ?? '', verdict });
        return verdict;
      })
      .finally(() => {
        this.pending = null;
      });
  }

  /** Waits for an in-flight verdict. Gives the user-message event a short grace period to arrive. */
  async settle(graceMs = 1500): Promise<void> {
    const start = Date.now();
    while (!this.pending && this.current?.state === 'readback_spoken' && Date.now() - start < graceMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (this.pending) await this.pending;
  }

  /** The user's turn right after the read-back decides the proposal. */
  async onUserTurn(userText: string | undefined, judge: AffirmationJudge): Promise<Affirmation | null> {
    const p = this.current;
    if (!p) return null;
    if (p.state === 'pending') {
      // The user spoke before the read-back was delivered (or it was never spoken as proposed).
      this.transition('cleared', 'user spoke before the read-back was delivered');
      return null;
    }
    if (p.state !== 'readback_spoken') return null;
    let verdict: Affirmation = 'other';
    try {
      verdict = await judge(p.readbackText, userText ?? '');
    } catch {
      verdict = 'other';
    }
    if (verdict === 'yes') this.transition('confirmed');
    else this.transition('cleared', verdict === 'no' ? 'user declined the read-back' : 'reply to the read-back was not a clear yes');
    return verdict;
  }

  /** Returns null when the booking may proceed, otherwise a spoken-friendly reason. */
  authorize(details: { programId: string; slotId: string; childName: string }): string | null {
    const p = this.current;
    if (!p) return 'I need to read the booking back to you and hear a yes before I can book it.';
    if (p.state === 'consumed') return 'That trial is already booked, so I will not book it twice.';
    if (p.state !== 'confirmed') {
      return 'I need to read the booking back to you again and hear a yes before I can book it.';
    }
    const same =
      p.programId === details.programId && p.slotId === details.slotId && normalizeName(p.childName) === normalizeName(details.childName);
    if (!same) return 'Those details are different from what you agreed to, so let me read the booking back to you again.';
    return null;
  }

  consume(): void {
    if (this.current?.state === 'confirmed') this.transition('consumed');
  }

  private transition(state: ProposalState, detail?: string): void {
    if (!this.current) return;
    this.current.state = state;
    if (state === 'cleared') this.current.clearedBecause = detail ?? null;
    const kind: ProposalEvent['kind'] = state === 'pending' ? 'proposed' : state;
    this.history.push({ at: new Date(), kind, proposalId: this.current.proposalId, ...(detail ? { detail } : {}) });
  }
}

// ---------- session context ----------

export interface SessionFeatures {
  sms: boolean;
  guardian: boolean;
}

export interface SessionContextInit {
  identity: Identity;
  db: DbPort;
  sms: SmsPort;
  dial: DialPort;
  judge: AffirmationJudge;
  features: SessionFeatures;
  roomName: string;
  now?: () => Date;
}

export class SessionContext {
  readonly identity: Identity;
  readonly db: DbPort;
  readonly sms: SmsPort;
  readonly dial: DialPort;
  readonly judge: AffirmationJudge;
  readonly features: SessionFeatures;
  readonly roomName: string;
  readonly now: () => Date;
  readonly proposals = new ProposalMachine();
  familyId: string | null = null;
  family: FamilyWithDetails | null = null;
  /** True when the bound family was loaded with history (memory allowed), false when created fresh. */
  familyHasHistory = false;
  callId: string | null = null;
  endRequested = false;
  outcome: 'inquiry' | 'booked' | 'callback' | 'no_answer' = 'inquiry';
  readonly bookingIds: string[] = [];
  readonly callbackIds: string[] = [];
  readonly toolLog: { at: Date; name: string; ok: boolean; summary: string; durationMs: number | null }[] = [];
  /** Called after every tool log entry and proposal change; the worker wires the state channel here. */
  onChange: (() => void) | null = null;

  constructor(init: SessionContextInit) {
    this.identity = init.identity;
    this.db = init.db;
    this.sms = init.sms;
    this.dial = init.dial;
    this.judge = init.judge;
    this.features = init.features;
    this.roomName = init.roomName;
    this.now = init.now ?? (() => new Date());
  }

  /**
   * Binds a family per PRD section 5. `caller_id_only` may load or create by phone.
   * `self_reported` loads only a demo family; otherwise nothing is bound yet and
   * `ensureFamily` creates a fresh family from the conversation when a tool needs one.
   */
  async bindFamily(): Promise<void> {
    const id = this.identity;
    if (id.source === 'caller_id_only') {
      if (!id.phone) return;
      const fam = await this.db.findFamilyByPhone(id.phone);
      if (fam) {
        this.familyId = fam.id;
        this.family = fam;
        this.familyHasHistory = Boolean(fam.summary || fam.children.length > 0);
      }
      return;
    }
    // self_reported: a demo family only
    const candidate = id.phone ? await this.db.findFamilyByPhone(id.phone) : id.claimedFamilyId ? await this.db.findFamilyById(id.claimedFamilyId) : null;
    if (candidate?.isDemo) {
      this.familyId = candidate.id;
      this.family = candidate;
      this.familyHasHistory = Boolean(candidate.summary || candidate.children.length > 0);
    }
  }

  /** Creates the family from the conversation when none is bound. Never from tool arguments alone. */
  async ensureFamily(hint: { guardianName?: string | null } = {}): Promise<string> {
    if (this.familyId) return this.familyId;
    const id = this.identity;
    const guardianName = id.guardianName ?? hint.guardianName ?? null;
    const fam = await this.db.createFamily({
      // A caller id may key a synthetic family; a self-reported phone is never a family key.
      phone: id.source === 'caller_id_only' ? id.phone : null,
      guardianName,
      email: id.email,
      isDemo: false,
    });
    this.familyId = fam.id;
    this.family = { ...fam, children: [], lastBooking: null };
    this.familyHasHistory = false;
    return fam.id;
  }

  logTool(name: string, ok: boolean, summary: string, startedAt?: number): void {
    this.toolLog.push({ at: this.now(), name, ok, summary, durationMs: startedAt ? Date.now() - startedAt : null });
    this.onChange?.();
  }

  notifyChange(): void {
    this.onChange?.();
  }
}
