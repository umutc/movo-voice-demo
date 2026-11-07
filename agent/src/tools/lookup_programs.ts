import { tool } from '@livekit/agents';
import { z } from 'zod';
import type { SessionContext } from '../context.ts';
import { describeProgram, SORRY } from './shared.ts';

export const lookupPrograms = tool({
  name: 'lookup_programs',
  description:
    'Find soccer programs that fit a child by age. Call this as soon as you know the child age, before offering any program. Returns up to three programs with id, age range, days, location and monthly price. Offer at most two aloud.',
  parameters: z.object({
    child_age: z.number().int().min(1).max(20).describe('Child age in years'),
    location_pref: z.string().optional().describe('Optional location preference the caller mentioned, e.g. Prospect Park'),
  }),
  execute: async ({ child_age, location_pref }, { ctx }) => {
    const sc = ctx.userData as SessionContext;
    const startedAt = Date.now();
    try {
      if (child_age < 4 || child_age > 14) {
        sc.logTool('lookup_programs', true, `age ${child_age} out of range`, startedAt);
        return {
          sayThis: `${SORRY} the academy only has programs for children aged four to fourteen, so there is no program for a ${child_age} year old. I can have the staff call back about future options.`,
          programs: [],
        };
      }
      const programs = await sc.db.listPrograms(child_age, location_pref);
      sc.logTool('lookup_programs', true, `${programs.length} programs for age ${child_age}`, startedAt);
      if (programs.length === 0) {
        return { sayThis: `${SORRY} there is no program for a ${child_age} year old right now. I can have the staff call back.`, programs: [] };
      }
      return {
        sayThis: `Programs for a ${child_age} year old: ${programs.map(describeProgram).join('; ')}.`,
        programs: programs.map((p) => ({ id: p.id, name: p.name, ages: `${p.ageMin} to ${p.ageMax}`, days: p.days, location: p.location, monthlyPriceDollars: Math.round(p.monthlyPriceCents / 100) })),
      };
    } catch (err) {
      sc.logTool('lookup_programs', false, err instanceof Error ? err.message : String(err), startedAt);
      return { sayThis: `${SORRY} I could not look up programs right now. I can have the staff call back.`, programs: [] };
    }
  },
});
