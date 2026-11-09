// Pause switch in the database (demo_state). Prints the state only.
//   pnpm demo:pause -- "<reason>"   pnpm demo:resume   pnpm demo:status
// DEMO_PAUSED in the Amplify env and the agent secrets is a separate switch: the demo is paused
// when either one says so.
import { fileURLToPath } from 'node:url';
import { type DemoState, type DemoStatePort, openOps } from '../db/ops.ts';

export type DemoCommand = { cmd: 'pause'; reason: string } | { cmd: 'resume' } | { cmd: 'status' };

/** Parses `pause [--] <reason...>`, `resume` or `status`. pnpm may pass the `--` through. */
export function parseDemoArgs(argv: string[]): DemoCommand {
  const args = argv.filter((a) => a !== '--');
  const [cmd, ...rest] = args;
  if (cmd === 'pause') {
    const reason = rest.join(' ').trim();
    return { cmd, reason: reason || 'manual pause' };
  }
  if (cmd === 'resume' || cmd === 'status') return { cmd };
  throw new Error('usage: demo-state.ts pause "<reason>" | resume | status');
}

export function formatState(state: DemoState): string {
  const at = state.updatedAt ? state.updatedAt.toISOString() : 'never';
  return `demo_state: ${state.paused ? 'paused' : 'not paused'} | reason: ${state.reason ?? '-'} | updated: ${at}`;
}

/** Runs one command against the pause row and returns the lines to print. */
export async function runDemoCommand(command: DemoCommand, ops: DemoStatePort, now: Date): Promise<string[]> {
  let state: DemoState;
  if (command.cmd === 'pause') state = await ops.setDemoState({ paused: true, reason: command.reason, now });
  else if (command.cmd === 'resume') state = await ops.setDemoState({ paused: false, reason: null, now });
  else state = await ops.getDemoState();
  return [formatState(state), 'note: DEMO_PAUSED (Amplify env and agent secrets) is a separate switch; either one pauses the demo.'];
}

async function main(): Promise<void> {
  const command = parseDemoArgs(process.argv.slice(2));
  const { ops, close } = openOps(process.env.DATABASE_URL);
  try {
    for (const line of await runDemoCommand(command, ops, new Date())) console.log(line);
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
