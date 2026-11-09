// demo:pause / demo:resume / demo:status helpers against the in-memory ops fake. No database.
import { describe, expect, it } from 'vitest';
import { FakeOps } from '../db/ops.ts';
import { parseDemoArgs, runDemoCommand } from './demo-state.ts';

const now = new Date('2026-11-09T12:00:00Z');

describe('parseDemoArgs', () => {
  it('reads pause with a reason (pnpm may pass --), resume and status', () => {
    expect(parseDemoArgs(['pause', '--', 'credit top-up pending'])).toEqual({ cmd: 'pause', reason: 'credit top-up pending' });
    expect(parseDemoArgs(['pause'])).toEqual({ cmd: 'pause', reason: 'manual pause' });
    expect(parseDemoArgs(['resume'])).toEqual({ cmd: 'resume' });
    expect(parseDemoArgs(['status'])).toEqual({ cmd: 'status' });
    expect(() => parseDemoArgs(['nope'])).toThrow('usage');
  });
});

describe('runDemoCommand', () => {
  it('pauses, reports status and resumes, printing the state only', async () => {
    const ops = new FakeOps();
    expect((await runDemoCommand({ cmd: 'status' }, ops, now))[0]).toBe('demo_state: not paused | reason: - | updated: never');
    expect((await runDemoCommand({ cmd: 'pause', reason: '  credit\n top-up  ' }, ops, now))[0]).toBe(
      'demo_state: paused | reason: credit top-up | updated: 2026-11-09T12:00:00.000Z',
    );
    expect(ops.state.paused).toBe(true);
    expect((await runDemoCommand({ cmd: 'resume' }, ops, now))[0]).toBe('demo_state: not paused | reason: - | updated: 2026-11-09T12:00:00.000Z');
    expect(ops.state).toMatchObject({ paused: false, reason: null });
  });
});
