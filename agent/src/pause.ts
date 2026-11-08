// Pause switch (DEMO_PAUSED). A paused demo ends every call at entry: no AgentSession, no
// inference (TTS would spend credit too), no calls row and no demo_usage row.

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
 * phone caller hears the line drop at once instead of waiting in silence. Then the job shuts down.
 */
export async function endPausedJob(ctx: PausableJob, logger: InfoLogger): Promise<void> {
  const room = ctx.job.room?.name;
  logger.info({ room: room ?? null }, 'demo paused (DEMO_PAUSED=true): ending the call without a session');
  if (room && !ctx.isFakeJob) await ctx.deleteRoom(room);
  ctx.shutdown('demo paused');
}
