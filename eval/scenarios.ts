// Loads and validates eval/scenarios.yaml.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { ScriptLine } from './simulated-caller.ts';

export const PROFILES = ['core', 'sms', 'guardian', 'outbound'] as const;
export type Profile = (typeof PROFILES)[number];

export const ScenarioSchema = z.object({
  id: z.union([z.number().int(), z.string()]).transform(String),
  profile: z.enum(PROFILES),
  title: z.string().min(1),
  identity: z.enum(['sip-demo', 'sip-new', 'browser-anon', 'browser-demo', 'browser-real-phone']),
  variant: z.enum(['inbound', 'follow_up']).optional(),
  persona: z.string().min(1),
  goal: z.string().min(1),
  maxTurns: z.number().int().min(1).max(12),
  forbiddenTools: z.array(z.string()),
  expected: z.object({ booking: z.boolean(), callback: z.boolean() }),
  script: z.array(ScriptLine).optional(),
});
export type ScenarioDef = z.infer<typeof ScenarioSchema>;

export function loadScenarios(path = fileURLToPath(new URL('./scenarios.yaml', import.meta.url))): ScenarioDef[] {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  return z.array(ScenarioSchema).parse(raw);
}
