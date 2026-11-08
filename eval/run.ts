// Scenario eval entrypoint: `pnpm eval --profile core|sms|guardian|outbound|all [--only <id>] [--no-braintrust]`.
// Runs scenarios sequentially (shared LiveKit credit), prints a markdown scorecard, writes
// eval/out/last-run.json and exits 1 when an invariant fails or a threshold is missed. An
// inference credit or quota error (429) aborts the run: exit 2 and an aborted marker, no scorecard.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Eval } from 'braintrust';
import { CreditGuard, InferenceCreditExhausted, writeAbortedMarker } from './credit.ts';
import { defaultLlm, runScenario, type HarnessResult } from './harness.ts';
import type { InvariantResult } from './invariants.ts';
import { loadScenarios, PROFILES, type Profile, type ScenarioDef } from './scenarios.ts';
import { defaultJudgeLlm, scoreGoalCompletion, scoreGrounding, scoreInvariants, scoreStyle, type GoalResult, type GroundingResult, type StyleResult } from './scorers.ts';
import { makeCallerLlm } from './simulated-caller.ts';

const OUT_DIR = fileURLToPath(new URL('./out/', import.meta.url));
const OUT_FILE = `${OUT_DIR}last-run.json`;

const THRESHOLDS = { goal: 0.8, grounding: 0.9, styleFailuresAllowed: 1 } as const;

interface Args {
  profile: Profile | 'all';
  only: string | null;
  braintrust: boolean;
}

function parseArgs(argv: string[]): Args {
  let profile: Args['profile'] = 'core';
  let only: string | null = null;
  let braintrust = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--profile') profile = (argv[++i] ?? '') as Args['profile'];
    else if (a.startsWith('--profile=')) profile = a.slice('--profile='.length) as Args['profile'];
    else if (a === '--only') only = argv[++i] ?? null;
    else if (a.startsWith('--only=')) only = a.slice('--only='.length);
    else if (a === '--no-braintrust') braintrust = false;
  }
  if (profile !== 'all' && !(PROFILES as readonly string[]).includes(profile)) {
    throw new Error(`unknown profile "${profile}"; use core, sms, guardian, outbound or all`);
  }
  return { profile, only, braintrust };
}

/** `all` runs core plus every stretch profile whose feature flag is on. */
function profilesFor(p: Args['profile']): Profile[] {
  if (p !== 'all') return [p];
  const on = (name: string) => ['true', '1'].includes((process.env[name] ?? '').toLowerCase());
  return ['core', ...(on('FEATURE_SMS') ? (['sms'] as const) : []), ...(on('FEATURE_GUARDIAN') ? (['guardian'] as const) : []), ...(on('FEATURE_OUTBOUND') ? (['outbound'] as const) : [])];
}

interface ScenarioScore {
  def: ScenarioDef;
  result: HarnessResult;
  invariants: InvariantResult[];
  goal: GoalResult;
  grounding: GroundingResult;
  style: StyleResult;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function f2(n: number): string {
  return n.toFixed(2);
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}~`;
}

function summarize(s: ScenarioScore) {
  return {
    scenarioId: s.def.id,
    title: s.def.title,
    turns: s.result.run.turnsUsed,
    endedBy: s.result.run.endedBy,
    bookings: s.result.finalState.bookings,
    callbacks: s.result.finalState.callbacks,
    invariantsPass: s.invariants.every((i) => i.pass),
    failedInvariants: s.invariants.filter((i) => !i.pass).map((i) => `${i.name}: ${i.detail}`),
    goal: s.goal.score,
    goalRationale: s.goal.rationale,
    grounding: s.grounding.score,
    ungrounded: s.grounding.ungrounded,
    stylePass: s.style.pass,
    styleProblems: s.style.problems,
    transcript: s.result.transcript,
  };
}

async function scoreOne(def: ScenarioDef, judge: ReturnType<typeof defaultJudgeLlm>, result: HarnessResult): Promise<ScenarioScore> {
  const invariants = scoreInvariants(result.run, result.error);
  const goal = await scoreGoalCompletion(def, result, judge);
  return { def, result, invariants, goal, grounding: scoreGrounding(result), style: scoreStyle(result) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 10);
  const profiles = profilesFor(args.profile);
  let scenarios = loadScenarios().filter((s) => profiles.includes(s.profile));
  if (args.only) scenarios = scenarios.filter((s) => s.id === args.only);
  if (scenarios.length === 0) throw new Error(`no scenarios match profile ${args.profile}${args.only ? ` and id ${args.only}` : ''}`);

  const agentLlm = defaultLlm();
  const callerLlm = makeCallerLlm();
  const judgeLlm = defaultJudgeLlm();
  const credit = new CreditGuard().watch(agentLlm, 'agent LLM').watch(callerLlm, 'simulated caller').watch(judgeLlm, 'judge');
  const scores: ScenarioScore[] = [];
  for (const def of scenarios) {
    process.stderr.write(`running scenario ${def.id}: ${def.title}\n`);
    const result = await runScenario(def, { agentLlm, callerLlm });
    credit.check();
    scores.push(await scoreOne(def, judgeLlm, result));
    credit.check();
  }

  // ---- scorecard ----
  const lines: string[] = [];
  lines.push('| id | scenario | turns | inv | goal | ground | style |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of scores) {
    const inv = s.invariants.every((i) => i.pass) ? 'ok' : 'FAIL';
    lines.push(`| ${s.def.id} | ${clip(s.def.title, 28)} | ${s.result.run.turnsUsed} | ${inv} | ${f2(s.goal.score)} | ${f2(s.grounding.score)} | ${s.style.pass ? 'ok' : 'FAIL'} |`);
  }
  const notes: string[] = [];
  for (const s of scores) {
    for (const i of s.invariants.filter((x) => !x.pass)) notes.push(`- ${s.def.id} invariant ${i.name}: ${i.detail}`);
    if (s.goal.score < 1) notes.push(`- ${s.def.id} goal ${f2(s.goal.score)}: ${s.goal.rationale}`);
    if (s.grounding.ungrounded.length) notes.push(`- ${s.def.id} ungrounded: ${s.grounding.ungrounded.join(', ')}`);
    if (!s.style.pass) notes.push(`- ${s.def.id} style: ${s.style.problems.join('; ')}`);
  }

  const invFailed = scores.filter((s) => s.invariants.some((i) => !i.pass)).length;
  const goalMean = mean(scores.map((s) => s.goal.score));
  const groundMean = mean(scores.map((s) => s.grounding.score));
  const styleFails = scores.filter((s) => !s.style.pass).length;
  const failures: string[] = [];
  if (invFailed > 0) failures.push(`invariants failed in ${invFailed} scenario(s)`);
  if (goalMean < THRESHOLDS.goal) failures.push(`goal ${f2(goalMean)} < ${THRESHOLDS.goal}`);
  if (groundMean < THRESHOLDS.grounding) failures.push(`grounding ${f2(groundMean)} < ${THRESHOLDS.grounding}`);
  if (styleFails > THRESHOLDS.styleFailuresAllowed) failures.push(`style failed in ${styleFails} scenarios (max ${THRESHOLDS.styleFailuresAllowed})`);
  const pass = failures.length === 0;

  console.log(`\n## Scenario eval scorecard (${args.profile}, ${date})\n`);
  console.log(lines.join('\n'));
  if (notes.length) console.log(`\nNotes:\n${notes.join('\n')}`);
  console.log(
    `\nTotals: ${date}, profile ${args.profile}, n=${scores.length}, invariants ${scores.length - invFailed}/${scores.length}, ` +
      `goal ${f2(goalMean)} (>= ${THRESHOLDS.goal}), grounding ${f2(groundMean)} (>= ${THRESHOLDS.grounding}), ` +
      `style ${scores.length - styleFails}/${scores.length} (at most ${THRESHOLDS.styleFailuresAllowed} fail), ${pass ? 'PASS' : `FAIL (${failures.join('; ')})`}`,
  );

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = OUT_FILE;
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        date,
        profile: args.profile,
        n: scores.length,
        pass,
        failures,
        totals: { invariantsFailed: invFailed, goalMean, groundingMean: groundMean, styleFailures: styleFails },
        scenarios: scores.map(summarize),
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${outFile}`);

  // ---- Braintrust: replay of the recorded results, so a failure never hides the local scorecard ----
  if (args.braintrust && process.env['BRAINTRUST_API_KEY']) {
    try {
      const byId = new Map(scores.map((s) => [s.def.id, s]));
      const pick = (input: unknown) => byId.get((input as { id: string }).id);
      await Eval(process.env['BRAINTRUST_PROJECT'] ?? 'movo-voice-demo', {
        experimentName: `${args.profile}-${date}`,
        data: scores.map((s) => ({ input: { id: s.def.id, title: s.def.title, goal: s.def.goal, persona: s.def.persona }, expected: s.def.expected, metadata: { profile: s.def.profile } })),
        task: async (input: { id: string }) => {
          const s = byId.get(input.id);
          return s ? summarize(s) : { error: 'unknown scenario' };
        },
        scores: [
          ({ input }) => {
            const s = pick(input);
            return { name: 'invariants', score: s && s.invariants.every((i) => i.pass) ? 1 : 0, metadata: { failed: s?.invariants.filter((i) => !i.pass).map((i) => `${i.name}: ${i.detail}`) ?? [] } };
          },
          ({ input }) => {
            const s = pick(input);
            return { name: 'goalCompletion', score: s?.goal.score ?? 0, metadata: { rationale: s?.goal.rationale ?? '' } };
          },
          ({ input }) => {
            const s = pick(input);
            return { name: 'grounding', score: s?.grounding.score ?? 0, metadata: { ungrounded: s?.grounding.ungrounded ?? [] } };
          },
          ({ input }) => {
            const s = pick(input);
            return { name: 'style', score: s?.style.pass ? 1 : 0, metadata: { problems: s?.style.problems ?? [], avgWords: s?.style.avgWords ?? 0 } };
          },
        ],
        maxConcurrency: 1,
      });
    } catch (err) {
      console.log(`\nBraintrust upload failed (local scorecard above is complete): ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log(args.braintrust ? '\nBraintrust skipped: no BRAINTRUST_API_KEY' : '\nBraintrust skipped: --no-braintrust');
  }

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  if (err instanceof InferenceCreditExhausted) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeAbortedMarker(OUT_FILE, err, profileForMarker(), new Date().toISOString().slice(0, 10));
    console.error(`\n${err.message}`);
    console.error(`Wrote an aborted marker to ${OUT_FILE} (no scorecard).`);
    process.exit(2);
  }
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

function profileForMarker(): string {
  try {
    return parseArgs(process.argv.slice(2)).profile;
  } catch {
    return 'unknown';
  }
}
