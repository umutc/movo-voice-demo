import {
  Agent,
  AgentSession,
  AgentSessionEventTypes,
  type JobContext,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  log,
} from '@livekit/agents';
import { fileURLToPath } from 'node:url';
import { loadConfig, splitTtsModel } from './config.ts';
import { buildSystemPrompt } from './prompt.ts';

// Phase 1: hello-world worker. STT, LLM and TTS come from LiveKit Inference with ids from env.
// VAD and turn detection use the SDK's bundled inference.VAD and inference.TurnDetector (no
// plugins needed, see README "Decisions"). Identity, tools, memory and metrics arrive in Phases 3
// and 5.

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const cfg = loadConfig();
    const logger = log();

    const agent = Agent.create({
      instructions: buildSystemPrompt({
        academyName: cfg.DEMO_ACADEMY_NAME,
        personaName: cfg.DEMO_AGENT_PERSONA_NAME,
        variant: 'inbound',
        now: new Date(),
      }),
      onEnter: async ({ session }) => {
        session.generateReply({
          instructions:
            'Greet the caller in one short sentence, say you are an AI assistant, and ask how you can help with enrollment.',
        });
      },
    });

    const tts = splitTtsModel(cfg.LK_TTS_MODEL);

    const session = new AgentSession({
      vad: new inference.VAD({ model: 'silero' }),
      stt: new inference.STT({ model: cfg.LK_STT_MODEL, language: 'en' }),
      llm: new inference.LLM({ model: cfg.LK_LLM_MODEL }),
      tts: new inference.TTS({ model: tts.model, ...(tts.voice ? { voice: tts.voice } : {}), language: 'en' }),
      ttsTextTransforms: ['filter_markdown', 'filter_emoji'],
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        interruption: { mode: 'adaptive', resumeFalseInterruption: true, falseInterruptionTimeout: 1000 },
        endpointing: { mode: 'dynamic', minDelay: 300, maxDelay: 3000 },
        preemptiveGeneration: { enabled: true },
      },
    });

    session.on(AgentSessionEventTypes.Close, (ev) => {
      logger.info({ reason: ev.reason, room: ctx.room.name }, 'session closed');
    });

    ctx.addShutdownCallback(async () => {
      logger.info({ usage: session.usage, room: ctx.room.name }, 'session usage summary');
    });

    await session.start({ agent, room: ctx.room });
  },
});

// The worker CLI (dev | start | console | download-files). Skipped under Vitest.
if (process.env.VITEST === undefined) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: process.env.AGENT_NAME?.trim() || 'enroll-agent',
    }),
  );
}
