// Pause switch. The demo is paused when DEMO_PAUSED is true OR the demo_state row says paused
// (set by `pnpm demo:pause` or by the automatic pause on a provider credit error). A paused demo
// ends every call at entry: no AgentSession, no inference (TTS would spend credit too), no calls
// row and no demo_usage row.
import type { DemoState, DemoStatePort } from 'db/ops';

/** The part of JobContext the pause path uses; JobContext satisfies it. */
export interface PausableJob {
  readonly isFakeJob: boolean;
  readonly job: { room?: { name?: string } | undefined };
  deleteRoom(roomName?: string): Promise<void>;
  shutdown(reason?: string): void;
}

export interface InfoLogger {
  info(obj: object, msg: string): void;
}

/**
 * Ends a job while the demo is paused. Deleting the room disconnects every participant, so a
 * phone caller hears the line drop at once instead of waiting in silence. `beforeShutdown` (for
 * example an alert) runs after the room is gone, so the caller never waits for it. Then the job
 * shuts down.
 */
export async function endPausedJob(
  ctx: PausableJob,
  logger: InfoLogger,
  source = 'DEMO_PAUSED=true',
  beforeShutdown?: () => Promise<void>,
): Promise<void> {
  const room = ctx.job.room?.name;
  logger.info({ room: room ?? null, source }, 'demo paused: ending the call without a session');
  if (room && !ctx.isFakeJob) await ctx.deleteRoom(room);
  if (beforeShutdown) await beforeShutdown().catch(() => {});
  ctx.shutdown('demo paused');
}

export type DbPauseCheck = { ok: true; state: DemoState } | { ok: false; error: string };

/** Reads the demo_state row with a timeout. Never throws; a failure is returned so the caller can fail closed. */
export async function checkDbPause(ops: Pick<DemoStatePort, 'getDemoState'>, timeoutMs = 5000): Promise<DbPauseCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await Promise.race([
      ops.getDemoState(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`pause check timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, state };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
