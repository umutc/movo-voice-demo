import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return url;
}

export function academyName(): string {
  return process.env.DEMO_ACADEMY_NAME?.trim() || 'Brooklyn Youth Soccer Academy';
}

export function personaName(): string {
  return process.env.DEMO_AGENT_PERSONA_NAME?.trim() || 'Maya';
}

/** Same parsing as agent/src/config.ts: 'true' or '1' is on, anything else off. */
export function flag(name: 'FEATURE_SMS' | 'FEATURE_OUTBOUND'): boolean {
  const v = process.env[name]?.trim();
  return v === 'true' || v === '1';
}

/** Shape written by eval/run.ts to eval/out/last-run.json (only the fields the console reads). */
export interface EvalRun {
  date: string;
  profile: string;
  n: number;
  pass: boolean;
  failures: string[];
  totals: { invariantsFailed: number; goalMean: number; groundingMean: number; styleFailures: number };
  scenarios: {
    scenarioId: string;
    title: string;
    turns: number;
    invariantsPass: boolean;
    failedInvariants: string[];
    goal: number;
    grounding: number;
    stylePass: boolean;
    styleProblems: string[];
  }[];
}

/** Reads the last `pnpm eval` output at request time; null when the file is not in this deployment. */
export function readLastEvalRun(): EvalRun | null {
  const candidates = [path.join(process.cwd(), '..', 'eval', 'out', 'last-run.json'), path.join(process.cwd(), 'eval', 'out', 'last-run.json')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as EvalRun;
      if (Array.isArray(json.scenarios) && json.totals) return json;
    } catch {
      return null;
    }
  }
  return null;
}
