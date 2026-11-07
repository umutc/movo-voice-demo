// Simulated caller: a persona LLM (LiveKit Inference) that plays the parent. Scripted lines
// override the LLM so the tricky scenarios (5, 8, 13) are deterministic.
import { inference, llm } from '@livekit/agents';
import { z } from 'zod';

export const ScriptLine = z.object({
  when: z.enum(['start', 'after_readback', 'next']),
  say: z.string().min(1),
});
export type ScriptLine = z.infer<typeof ScriptLine>;

export const DEFAULT_CALLER_MODEL = 'openai/gpt-6-luna';

export function makeCallerLlm(): inference.LLM {
  return new inference.LLM({ model: DEFAULT_CALLER_MODEL as inference.LLMModels });
}

export interface TranscriptLine {
  role: 'agent' | 'caller';
  text: string;
}

export interface CallerPersona {
  persona: string;
  goal: string;
  script?: ScriptLine[] | undefined;
}

export type CallerTurn = { kind: 'say'; text: string; scripted: boolean } | { kind: 'done'; refused: boolean };

const SYSTEM = [
  'You are role-playing a parent or guardian on a phone call with the AI enrollment assistant of a youth soccer academy. Stay in character at all times.',
  'Reply with only the caller\'s next spoken line: one or two short sentences of plain spoken English. No quotes, no stage directions, no lists, no emoji.',
  'Answer what the assistant asked. Reveal other facts only when they matter. Say numbers the way a person says them aloud.',
  'When the assistant reads a booking back and asks you to confirm, say a clear yes if it matches your goal, otherwise say exactly what is wrong.',
  'Never invent facts that contradict your persona. Never mention that this is a test or a simulation.',
  'Finish with a marker instead of a spoken line:',
  '- Output exactly DONE (nothing else) when your goal is reached and the assistant has acknowledged the outcome, or when you would naturally hang up satisfied.',
  '- Output exactly DONE REFUSED (nothing else) when the assistant clearly refused or cannot help with what you need and you give up.',
  'Do not output a marker while you still have something to ask or confirm.',
].join('\n');

async function askCaller(model: llm.LLM, system: string, user: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const chatCtx = llm.ChatContext.empty();
    chatCtx.addMessage({ role: 'system', content: system });
    chatCtx.addMessage({ role: 'user', content: user });
    try {
      const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), 45_000));
      const result = await Promise.race([model.chat({ chatCtx }).collect().then((r) => r.text), timer]);
      const text = result?.trim();
      if (text) return text;
    } catch {
      // retry once
    }
  }
  throw new Error('simulated caller LLM returned nothing');
}

export function parseMarker(text: string): { done: boolean; refused: boolean } {
  const t = text.trim().replace(/[."'`*]/g, '').toUpperCase();
  if (/^DONE\b/.test(t)) return { done: true, refused: /REFUS|DECLIN|GIVE UP/.test(t) };
  return { done: false, refused: false };
}

export class SimulatedCaller {
  private readonly model: llm.LLM;
  private readonly spec: CallerPersona;
  private scriptIndex = 0;
  private lastScriptReadbacks = 0;
  private turn = 0;

  constructor(model: llm.LLM, spec: CallerPersona) {
    this.model = model;
    this.spec = spec;
  }

  /**
   * `readbackCount` is the number of read-backs recorded so far; `lastAgentIsReadback` says
   * whether the latest assistant turn is the newest read-back. Together they gate
   * `after_readback` script lines so each one reacts to a fresh read-back.
   */
  async nextTurn(transcript: TranscriptLine[], state: { readbackCount: number; lastAgentIsReadback: boolean }): Promise<CallerTurn> {
    const first = this.turn === 0;
    this.turn += 1;
    const line = this.spec.script?.[this.scriptIndex];
    if (line) {
      const ready =
        line.when === 'start'
          ? first
          : line.when === 'next'
            ? true
            : state.lastAgentIsReadback && state.readbackCount > this.lastScriptReadbacks;
      if (ready) {
        this.scriptIndex += 1;
        if (line.when === 'after_readback') this.lastScriptReadbacks = state.readbackCount;
        return { kind: 'say', text: line.say, scripted: true };
      }
    }
    const log = transcript.map((t) => `${t.role === 'agent' ? 'Assistant' : 'Caller (you)'}: ${t.text}`).join('\n');
    const system = `${SYSTEM}\n\nYour persona: ${this.spec.persona.trim()}\nYour goal: ${this.spec.goal.trim()}`;
    const user = `Conversation so far:\n${log || '(the call just connected, the assistant has not spoken yet)'}\n\nWrite the caller's next line, or a DONE marker.`;
    const out = await askCaller(this.model, system, user);
    const marker = parseMarker(out);
    if (marker.done) return { kind: 'done', refused: marker.refused };
    return { kind: 'say', text: out.replace(/^caller( \(you\))?:\s*/i, '').trim(), scripted: false };
  }
}
