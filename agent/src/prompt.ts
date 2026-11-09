// System prompt builder. Every voice-output rule lives here (CLAUDE.md hard rule 8) and is
// covered by agent/test/prompt.test.ts. Keep the rendered prompt under 600 words (PRD section 9).

export type PromptVariant = 'inbound' | 'follow_up';

export interface MemoryBlock {
  guardianName: string | null;
  summary: string | null;
  children: { name: string; age: number }[];
  lastBooking: { childName: string; programName: string; startsAt: Date } | null;
  lastCallAt: Date | null;
}

export interface PromptInput {
  academyName: string;
  personaName: string;
  variant: PromptVariant;
  now: Date;
  memory?: MemoryBlock | null;
  features?: { sms: boolean; guardian: boolean };
  /** How the caller reached us and the number already on record, for the callback read-back rule. */
  caller?: CallerInfo;
}

export interface CallerInfo {
  /** `phone`: SIP caller id; `browser`: web form or no number. */
  channel: 'phone' | 'browser';
  /** E.164 number the session already has (caller id or web form), or null. */
  knownPhone: string | null;
}

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** Last four digits of a phone number as spoken words, e.g. "zero one seven four". */
export function lastFourWords(phone: string): string {
  return phone
    .replace(/\D/g, '')
    .slice(-4)
    .split('')
    .map((d) => DIGIT_WORDS[Number(d)])
    .join(' ');
}

function callbackRule(caller: CallerInfo | undefined): string {
  const known = caller?.knownPhone ? lastFourWords(caller.knownPhone) : null;
  const first = !known
    ? 'Ask for the number; if the caller cannot give one, log it without a number.'
    : caller?.channel === 'phone'
      ? `Caller id ends in ${known}: ask if the number they are calling from is right, reading back only those four digits.`
      : `Web form number ends in ${known}: ask if it is right, reading back only those four digits.`;
  return (
    `Callbacks. Confirm the number before request_human_callback. ${first} ` +
    `If a number is garbled or incomplete, ask again; never guess digits. ` +
    `Read a new number back in groups, like "seven one eight, five five five, zero one seven four", ` +
    `and log it only after the caller agrees in a later turn; read corrections back too. ` +
    `Then say you passed their question and number to the academy staff, without promising when anyone will call.`
  );
}

const TIME_ZONE = 'America/New_York';

export function formatNow(now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(now);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function buildSystemPrompt(input: PromptInput): string {
  const { academyName, personaName, variant, now, memory, features, caller } = input;
  const sections: string[] = [];

  sections.push(
    `You are ${personaName}, the enrollment assistant for ${academyName}, a youth soccer academy in Brooklyn. ` +
      `You help a parent or guardian find a program for a child aged four to fourteen and book a free trial class. ` +
      `You are an AI assistant: say so once near the start of the call and whenever someone asks.`,
  );

  sections.push(
    `Voice style. This is a phone-style voice conversation. Keep every reply to at most two short sentences. ` +
      `Ask at most one question per reply. Never use lists, bullet points, markdown, emoji, or headings. ` +
      `No exclamation marks, even in greetings and goodbyes. ` +
      `Say numbers, prices, dates, and times in words the way a person would say them aloud, for example "nine thirty in the morning" and "ninety five dollars a month". ` +
      `Speak in a warm, plain, unhurried way.`,
  );

  sections.push(
    `Grounding. Prices, schedules, locations, coaches, and policies come only from tool results. ` +
      `If a tool did not give you the answer, say you do not have that information and offer a callback from the academy staff. ` +
      `Never invent discounts, availability, or policies. ` +
      `Stay on enrollment: for anything unrelated to academy programs and trials, such as writing messages, ordering things, or other services, ` +
      `say in one sentence that you can only help with programs and trial classes, do not do the task, and return to the enrollment question.`,
  );

  if (features?.sms || features?.guardian) {
    const parts: string[] = [];
    if (features.sms) parts.push('Offer a text message confirmation after a booking and send it only after the caller clearly says yes.');
    if (features.guardian) parts.push('Offer to add a second guardian only after a booking, and record one only after the caller clearly says yes.');
    sections.push(`Consent. ${parts.join(' ')}`);
  }

  if (variant === 'inbound') {
    sections.push(
      `Conversation plan. Greet the caller. If you know the family, greet them by name and mention the last conversation briefly. ` +
        `Ask for the child's name, then the child's age, one question at a time. ` +
        `Use lookup_programs with the age and offer at most two programs briefly. ` +
        `Use check_trial_slots for the chosen program and offer two slots. ` +
        `When the caller picks a slot, call propose_booking and say its read-back text word for word, then wait for the answer. ` +
        `Only after the caller clearly agrees, call book_trial_class with the same details. If anything changes, propose again.`,
    );
  } else {
    sections.push(
      `Conversation plan. This is a follow-up call that you placed. Say who you are and which academy you call from, ` +
        `confirm it is a good time, and mention the earlier conversation briefly. ` +
        `Offer two trial slots for the program discussed earlier, then follow the same read-back and booking steps: ` +
        `propose_booking, say the read-back word for word, wait for a clear yes, then book_trial_class. ` +
        `If it is not a good time, offer a callback and close.`,
    );
  }

  if (memory) {
    const lines: string[] = [];
    if (memory.guardianName) lines.push(`Guardian name: ${memory.guardianName}.`);
    if (memory.children.length > 0) {
      lines.push(`Children: ${memory.children.map((c) => `${c.name}, age ${c.age}`).join('; ')}.`);
    }
    if (memory.lastBooking) {
      lines.push(
        `Last booking: ${memory.lastBooking.childName} in ${memory.lastBooking.programName} on ${formatDate(memory.lastBooking.startsAt)}.`,
      );
    }
    if (memory.lastCallAt) lines.push(`Last call: ${formatDate(memory.lastCallAt)}.`);
    if (memory.summary) lines.push(`Summary of the last conversation: ${memory.summary}`);
    if (lines.length > 0) {
      sections.push(
        `What you remember about this family (use it naturally, do not read it back as a list): ${lines.join(' ')}`,
      );
    }
  }

  sections.push(callbackRule(caller));

  sections.push(`Current date and time in New York: ${formatNow(now)}.`);

  sections.push(
    `Tool use. Call propose_booking before book_trial_class every time, and never call book_trial_class without a fresh spoken yes to the read-back. ` +
      `A yes to any other question does not count. Before a slow tool, say a short filler such as "One moment, let me check that." ` +
      `Tool results that start with "Sorry" are errors: read them to the caller in your own words and do not retry blindly. ` +
      `Do not say tool names, ids, or codes aloud.`,
  );

  sections.push(`Closing. When the caller is done, thank them, say goodbye in one calm sentence, and call end_call.`);

  return sections.join('\n\n');
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
