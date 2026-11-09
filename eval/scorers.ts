// Scorers for the scenario eval: goal completion (LLM judge), grounding and style
// (deterministic), and the must-pass invariants (wrapped from eval/invariants.ts).
import type { llm } from '@livekit/agents';
import { makeLlm, providerFromEnv } from 'agent/src/models.ts';
import { askLlm } from 'agent/src/memory.ts';
import { checkInvariants, type InvariantResult } from './invariants.ts';
import type { ScenarioDef } from './scenarios.ts';
import type { HarnessResult } from './harness.ts';
import type { ScenarioRun } from './timeline.ts';

// ---------- number words ----------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// "first", "second" and "third" are left alone: "the first one" is not a date.
const ORDINALS: Record<string, number> = {
  fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const NOT_FACT_AFTER = new Set(['moment', 'moments', 'second', 'seconds', 'sec', 'sentence', 'sentences', 'question', 'questions', 'business', 'more', 'thing', 'things', 'word', 'words', 'call', 'calls']);

/** Rewrites number words as digits: "one hundred fifteen" to "115", "nine thirty" to "9 30". */
export function wordsToDigits(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(\d):(\d{2})/g, '$1 $2')
    .replace(/[-,]/g, ' ')
    .replace(/[^a-z0-9$ ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    // "oh five" after a number token reads as zero five: "nine oh five" is 9 05
    if (t === 'oh' && out.length > 0 && /^\d+$/.test(out.at(-1)!) && tokens[i + 1] && tokens[i + 1]! in UNITS && UNITS[tokens[i + 1]!]! < 10) {
      out.push(`0${UNITS[tokens[i + 1]!]!}`);
      i += 2;
      continue;
    }
    const parsed = parseNumber(tokens, i);
    if (parsed) {
      out.push(String(parsed.value));
      i = parsed.next;
      continue;
    }
    const ord = ORDINALS[t];
    if (ord !== undefined) {
      out.push(String(ord));
      i += 1;
      continue;
    }
    out.push(t);
    i += 1;
  }
  return out.join(' ');
}

function parseNumber(tokens: string[], start: number): { value: number; next: number } | null {
  let i = start;
  let value = 0;
  const first = tokens[i]!;
  if (first in UNITS && UNITS[first]! < 10 && tokens[i + 1] === 'hundred') {
    value = UNITS[first]! * 100;
    i += 2;
    if (tokens[i] === 'and' && tokens[i + 1] && (tokens[i + 1]! in UNITS || tokens[i + 1]! in TENS)) i += 1;
    const rest = parseUnderHundred(tokens, i);
    if (rest) {
      value += rest.value;
      i = rest.next;
    }
    return { value, next: i };
  }
  const small = parseUnderHundred(tokens, i);
  if (!small) return null;
  // a lone "one" is an idiom ("one moment"), not a fact; a lone "zero" through "ten" stays a number
  if (small.next === i + 1 && first === 'one') return null;
  return small;
}

function parseUnderHundred(tokens: string[], i: number): { value: number; next: number } | null {
  const t = tokens[i];
  if (!t) return null;
  if (t in TENS) {
    const nxt = tokens[i + 1];
    if (nxt && nxt in UNITS && UNITS[nxt]! >= 1 && UNITS[nxt]! <= 9) return { value: TENS[t]! + UNITS[nxt]!, next: i + 2 };
    if (nxt && nxt in ORDINALS && ORDINALS[nxt]! >= 4 && ORDINALS[nxt]! <= 9) return { value: TENS[t]! + ORDINALS[nxt]!, next: i + 2 };
    return { value: TENS[t]!, next: i + 1 };
  }
  if (t in UNITS) return { value: UNITS[t]!, next: i + 1 };
  return null;
}

// ---------- grounding ----------

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const KNOWN_PLACES = ['prospect park', 'mccarren park'];
const TIME_RE = /\b(\d{1,2})(?: (\d{2}))? (?:in the (morning|afternoon|evening)|(am|pm)|a m|p m|o ?clock(?: in the (morning|afternoon|evening))?)(?!\w)/g;
const DOLLAR_RE = /\b(\d+) dollars?\b/g;

function stripNoise(output: string): string {
  return output
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, ' ')
    .replace(/[a-z0-9]+-(?:prospect|mccarren)[a-z0-9-]*/gi, ' ');
}

function timeKey(h: string, m: string | undefined, period: string | undefined): string {
  const pm = period === 'afternoon' || period === 'evening' || period === 'pm';
  return `${Number(h)}:${m ?? '00'}${pm ? 'pm' : period ? 'am' : ''}`;
}

function extractTimes(normalized: string): { keys: string[]; rest: string } {
  const keys: string[] = [];
  const rest = normalized.replace(TIME_RE, (_m, h: string, mm: string | undefined, p1: string | undefined, p2: string | undefined, p3: string | undefined) => {
    keys.push(timeKey(h, mm, p1 ?? p2 ?? p3));
    return ' ';
  });
  return { keys, rest };
}

export interface GroundingResult {
  score: number;
  total: number;
  found: number;
  ungrounded: string[];
}

export interface GroundingSources {
  /** Concatenated tool outputs: the source of truth for prices, times, weekdays, places and numbers. */
  toolOutputs: string;
  /** Memory the agent was given (guardian summary, children). Counts like a tool output. */
  memory: string;
  /** What the caller said. Counts only for plain numbers (ages, phone digits), never for prices, times, days or places. */
  userText: string;
}

export function scoreGroundingText(assistantTexts: string[], src: GroundingSources): GroundingResult {
  const truth = wordsToDigits(`${stripNoise(src.toolOutputs)} ${src.memory}`);
  const truthPlain = `${stripNoise(src.toolOutputs)} ${src.memory}`.toLowerCase();
  const truthTimes = extractTimes(truth);
  const truthNumbers = new Set([...truth.matchAll(/\d+/g)].map((m) => String(Number(m[0]))));
  const truthDollarNumbers = new Set([...truth.matchAll(DOLLAR_RE)].map((m) => String(Number(m[1]))));
  const userNumbers = new Set([...wordsToDigits(src.userText).matchAll(/\d+/g)].map((m) => String(Number(m[0]))));
  // tool outputs list prices as monthlyPriceDollars: 95 as well as "95 dollars a month"
  for (const m of truth.matchAll(/monthlypricedollars\s*(\d+)/g)) truthDollarNumbers.add(String(Number(m[1])));

  let total = 0;
  let found = 0;
  const ungrounded: string[] = [];
  const check = (ok: boolean, label: string) => {
    total += 1;
    if (ok) found += 1;
    else ungrounded.push(label);
  };

  for (const text of assistantTexts) {
    const lowerText = text.toLowerCase();
    let norm = wordsToDigits(text.replace(/\$\s?(\d[\d,]*)/g, '$1 dollars'));
    // 1. clock times
    const times = extractTimes(norm);
    norm = times.rest;
    for (const key of times.keys) check(truthTimes.keys.includes(key) || truthTimes.keys.includes(key.replace(/(am|pm)$/, '')), `time ${key}`);
    // 2. dollar amounts
    norm = norm.replace(DOLLAR_RE, (_m, n: string) => {
      const v = String(Number(n));
      check(truthDollarNumbers.has(v), `price ${v} dollars`);
      return ' ';
    });
    // 3. weekday names
    for (const day of WEEKDAYS) if (new RegExp(`\\b${day}s?\\b`).test(lowerText)) check(truthPlain.includes(day), `weekday ${day}`);
    // 4. place names: known places plus "<Capitalized Words> Park|Field|Gym|Center|School"
    const places = new Set<string>(KNOWN_PLACES.filter((p) => lowerText.includes(p)));
    for (const m of text.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)* (?:Park|Field|Gym|Center|School|Stadium))\b/g)) places.add(m[1]!.toLowerCase());
    for (const place of places) check(truthPlain.includes(place), `place ${place}`);
    // 5. remaining plain numbers
    const words = norm.split(/\s+/);
    words.forEach((w, idx) => {
      if (!/^\d+$/.test(w)) return;
      const prev = words[idx - 1] ?? '';
      if (/[a-z]/.test(prev) && /^u$/.test(prev)) return; // "U8"
      if (NOT_FACT_AFTER.has(words[idx + 1] ?? '')) return;
      if (/^(19|20)\d{2}$/.test(w)) return; // years are not facts we serve
      const v = String(Number(w));
      check(truthNumbers.has(v) || userNumbers.has(v), `number ${v}`);
    });
  }
  return { score: total === 0 ? 1 : found / total, total, found, ungrounded };
}

export function scoreGrounding(r: HarnessResult): GroundingResult {
  const t = r.run.timeline;
  return scoreGroundingText(
    t.filter((e) => e.kind === 'assistant').map((e) => (e as { text: string }).text),
    {
      toolOutputs: t.filter((e) => e.kind === 'tool_output' && !e.isError).map((e) => (e as { output: string }).output).join('\n'),
      // The caller-id last four digits come from the prompt (the callback number check), like memory.
      memory: [r.memoryText, r.callerIdText].filter(Boolean).join(' '),
      userText: t.filter((e) => e.kind === 'user').map((e) => (e as { text: string }).text).join(' '),
    },
  );
}

// ---------- style ----------

export interface StyleResult {
  pass: boolean;
  avgWords: number;
  problems: string[];
}

export function scoreStyle(r: HarnessResult): StyleResult {
  const texts = r.run.timeline.filter((e) => e.kind === 'assistant').map((e) => (e as { text: string }).text);
  const problems: string[] = [];
  const words = texts.map((t) => t.trim().split(/\s+/).filter(Boolean).length);
  const avgWords = words.length ? words.reduce((a, b) => a + b, 0) / words.length : 0;
  if (avgWords > 35) problems.push(`average ${avgWords.toFixed(1)} words per turn (max 35)`);
  const joined = texts.join('\n');
  if (/[*#]/.test(joined) || /^\s*[-•]\s/m.test(joined) || /^\s*\d+[.)]\s/m.test(joined)) problems.push('markdown (asterisk, hash, bullet or numbered list)');
  if (/\$/.test(joined)) problems.push('dollar sign');
  if (/\d\s?(?:a\.?m\.?|p\.?m\.?)(?!\w)/i.test(joined) || /\d{1,2}:\d{2}/.test(joined)) problems.push('digit time (use words)');
  if (/\d\s*dollars?\b/i.test(joined)) problems.push('digit price (use words)');
  return { pass: problems.length === 0, avgWords, problems };
}

// ---------- goal completion (LLM judge) ----------

export interface GoalResult {
  score: number;
  rationale: string;
  llmScore: number;
  capped: boolean;
}

export function expectationMismatches(def: ScenarioDef, state: { bookings: number; callbacks: number }): string[] {
  const out: string[] = [];
  if (def.expected.booking && state.bookings === 0) out.push('expected a booking, none made');
  if (!def.expected.booking && state.bookings > 0) out.push(`expected no booking, ${state.bookings} made`);
  if (def.expected.callback && state.callbacks === 0) out.push('expected a callback request, none logged');
  return out;
}

export async function scoreGoalCompletion(def: ScenarioDef, r: HarnessResult, judge: llm.LLM): Promise<GoalResult> {
  const transcript = r.run.timeline
    .map((e) => {
      if (e.kind === 'user') return `Caller: ${e.text}`;
      if (e.kind === 'assistant') return `Assistant: ${e.text}`;
      if (e.kind === 'tool_call') return `[tool call ${e.name} ${JSON.stringify(e.args)}]`;
      return `[tool result ${e.name}${e.isError ? ' ERROR' : ''}: ${e.output.slice(0, 300)}]`;
    })
    .join('\n');
  const state = `Final state: ${r.finalState.bookings} booking(s), ${r.finalState.callbacks} callback request(s), call ended by ${r.run.endedBy}.`;
  const answer = await askLlm(
    judge,
    'You grade one test conversation between a simulated caller and a youth soccer academy phone assistant. ' +
      'Score how fully the scenario goal was reached by the end of the conversation, from 0 to 1 (1 = fully reached, 0.5 = partly, 0 = not at all). ' +
      'Judge the assistant behavior and the final state, not the caller. Penalize invented facts, promises the assistant cannot keep, and bookings the caller did not clearly agree to. ' +
      'Reply with JSON only: {"score": <number>, "rationale": "<one short sentence>"}.',
    `Scenario goal: ${def.goal}\nExpected outcome: booking ${def.expected.booking ? 'made' : 'not made'}, callback ${def.expected.callback ? 'requested' : 'not required'}.\n${state}\n\nTranscript:\n${transcript}`,
    60_000,
  );
  let llmScore = 0;
  let rationale = 'judge returned nothing';
  if (answer) {
    const m = answer.match(/\{[\s\S]*\}/);
    try {
      const parsed = JSON.parse(m ? m[0] : answer) as { score?: unknown; rationale?: unknown };
      const s = Number(parsed.score);
      if (Number.isFinite(s)) llmScore = Math.max(0, Math.min(1, s));
      rationale = typeof parsed.rationale === 'string' ? parsed.rationale : 'no rationale';
    } catch {
      const num = answer.match(/\d(?:\.\d+)?/);
      llmScore = num ? Math.max(0, Math.min(1, Number(num[0]))) : 0;
      rationale = answer.slice(0, 120);
    }
  }
  // Final-state expectations are hard facts: a judge cannot talk its way past them.
  const mismatches = expectationMismatches(def, r.finalState);
  const capped = mismatches.length > 0 && llmScore > 0.4;
  const score = capped ? 0.4 : llmScore;
  return { score, rationale: mismatches.length ? `${rationale} (${mismatches.join('; ')})` : rationale, llmScore, capped };
}

// ---------- invariants ----------

export function scoreInvariants(run: ScenarioRun, harnessError: string | null): InvariantResult[] {
  const results = checkInvariants(run);
  if (harnessError) results.push({ name: 'harness_error', pass: false, detail: harnessError });
  return results;
}

/**
 * EVAL_JUDGE_MODEL (a `provider/model` id) picks the judge; it falls back to the agent's
 * LK_LLM_MODEL. MODEL_PROVIDER=direct calls OpenAI directly instead of LiveKit Inference.
 */
export function defaultJudgeLlm(): llm.LLM {
  const model = process.env['EVAL_JUDGE_MODEL']?.trim() || process.env['LK_LLM_MODEL']?.trim() || 'openai/gpt-6.1-terra';
  return makeLlm(model, providerFromEnv(), process.env['OPENAI_API_KEY']?.trim());
}
