// Builds the enrollment agent and wires session events to the session context. Shared by the
// worker entry (agent.ts), the behavior tests and the eval runner, so all three run the same
// prompt, tools and proposal state machine.
import { Agent, type AgentSession, AgentSessionEventTypes, type llm } from '@livekit/agents';
import type { SessionContext } from './context.ts';
import { memoryBlockFor } from './memory.ts';
import { buildSystemPrompt, type PromptVariant } from './prompt.ts';
import { coreTools } from './tools/index.ts';

export interface AgentBuildOptions {
  academyName: string;
  personaName: string;
  variant: PromptVariant;
  extraTools?: llm.FunctionTool[];
}

export function instructionsFor(sc: SessionContext, opts: AgentBuildOptions): string {
  return buildSystemPrompt({
    academyName: opts.academyName,
    personaName: opts.personaName,
    variant: opts.variant,
    now: sc.now(),
    memory: memoryBlockFor(sc.family, sc.familyHasHistory),
    features: sc.features,
  });
}

export function buildEnrollmentAgent(sc: SessionContext, opts: AgentBuildOptions): Agent<SessionContext> {
  return Agent.create<SessionContext>({
    instructions: instructionsFor(sc, opts),
    tools: [...coreTools, ...(opts.extraTools ?? [])],
    onEnter: async ({ session }) => {
      const known = sc.familyHasHistory && sc.family?.guardianName;
      session.generateReply({
        instructions: known
          ? `Greet ${sc.family?.guardianName} by name in one short sentence, say you are an AI assistant, mention in a few words what you talked about last time, and ask how you can help today.`
          : 'Greet the caller in one short sentence, say you are an AI assistant, and ask how you can help with enrollment.',
      });
    },
    onUserTurnCompleted: async (_ctx, _chatCtx, newMessage) => {
      // Drives the proposal state machine: the user turn right after the read-back decides it.
      await sc.proposals.onUserTurn(newMessage.textContent, sc.judge);
    },
  });
}

/** Subscribes the proposal state machine to assistant turns and tool executions. Call before start(). */
export function wireSessionEvents(session: AgentSession<SessionContext>, sc: SessionContext): void {
  session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    const item = ev.item;
    if (item.type === 'message' && item.role === 'assistant') {
      sc.proposals.onAssistantMessage(item.textContent, item.interrupted);
    }
  });
  session.on(AgentSessionEventTypes.FunctionToolsExecuted, (ev) => {
    for (const call of ev.functionCalls) {
      if (call.name !== 'propose_booking') sc.proposals.onToolExecuted(call.name);
    }
  });
}
