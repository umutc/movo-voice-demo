// Family memory: builds the prompt memory block from the bound family, writes the call row,
// generates the post-call summary with the LLM and upserts it (PRD FR-2, FR-8).
import { llm } from '@livekit/agents';
import type { FamilyWithDetails } from 'db/port';
import type { Affirmation, AffirmationJudge, SessionContext } from './context.ts';
import type { MemoryBlock } from './prompt.ts';

export function memoryBlockFor(family: FamilyWithDetails | null, allowed: boolean): MemoryBlock | null {
  if (!family || !allowed) return null;
  return {
    guardianName: family.guardianName,
    summary: family.summary,
    children: family.children.map((c) => ({ name: c.name, age: c.age })),
    lastBooking: family.lastBooking
      ? { childName: family.lastBooking.child.name, programName: family.lastBooking.program.name, startsAt: family.lastBooking.slot.startsAt }
      : null,
    lastCallAt: family.lastCallAt,
  };
}

/** One-shot LLM call with a plain system + user prompt; returns trimmed text or null on failure. */
export async function askLlm(model: llm.LLM, system: string, user: string, timeoutMs = 8000): Promise<string | null> {
  const chatCtx = llm.ChatContext.empty();
  chatCtx.addMessage({ role: 'system', content: system });
  chatCtx.addMessage({ role: 'user', content: user });
  const stream = model.chat({ chatCtx });
  const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try {
    const result = await Promise.race([stream.collect().then((r) => r.text), timer]);
    return result?.trim() || null;
  } catch {
    return null;
  }
}

/** Production affirmation judge: classifies the reply to the read-back as yes, no, or other. */
export function makeLlmAffirmationJudge(model: llm.LLM): AffirmationJudge {
  return async (readbackText, userReply) => {
    const answer = await askLlm(
      model,
      'You classify a caller reply in a phone conversation. The assistant just read a booking back and asked for confirmation. ' +
        'Reply with exactly one word: YES if the caller clearly agrees to that booking as read, NO if the caller declines or asks to change anything, ' +
        'OTHER if the reply is a question, unrelated, unclear, or agrees to something else.',
      `Read-back: "${readbackText}"\nCaller reply: "${userReply}"\nOne word:`,
      6000,
    );
    const word = (answer ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const verdict: Affirmation = word.startsWith('YES') ? 'yes' : word.startsWith('NO') ? 'no' : 'other';
    return verdict;
  };
}

export function transcriptFromItems(items: llm.ChatItem[]): { role: string; text: string; interrupted?: boolean }[] {
  const out: { role: string; text: string; interrupted?: boolean }[] = [];
  for (const item of items) {
    if (item.type === 'message' && item.role !== 'system') {
      const text = item.textContent;
      if (text) out.push({ role: item.role, text, ...(item.interrupted ? { interrupted: true } : {}) });
    } else if (item.type === 'function_call') {
      out.push({ role: 'tool_call', text: `${item.name}(${item.args})` });
    } else if (item.type === 'function_call_output') {
      out.push({ role: 'tool_output', text: item.output });
    }
  }
  return out;
}

/** Writes the opening call row. */
export async function openCall(sc: SessionContext, direction: 'inbound' | 'outbound' | 'browser'): Promise<void> {
  const row = await sc.db.insertCall({
    direction,
    identitySource: sc.identity.source,
    phone: sc.identity.phone,
    familyId: sc.familyId,
    roomName: sc.roomName,
    startedAt: sc.now(),
  });
  sc.callId = row.id;
}

/**
 * End of call: 2 to 3 sentence summary from the transcript, family upsert, call row finish.
 * Never throws; failures are returned so the caller can log them.
 */
export async function closeCall(
  sc: SessionContext,
  model: llm.LLM | null,
  items: llm.ChatItem[],
  extra: { metrics?: unknown; traceId?: string | null } = {},
): Promise<{ summary: string | null; error: string | null }> {
  const transcript = transcriptFromItems(items);
  let summary: string | null = null;
  let error: string | null = null;
  try {
    const spoken = transcript.filter((t) => t.role === 'user' || t.role === 'assistant');
    if (model && spoken.length >= 2) {
      summary = await askLlm(
        model,
        'Write a 2 to 3 sentence summary of this enrollment call for the academy staff and for the next call with the same family. ' +
          'Use the guardian and child names if known, what was discussed, what was booked or requested, and what is still open. Plain prose, no lists.',
        spoken.map((t) => `${t.role === 'user' ? 'Caller' : 'Maya'}: ${t.text}`).join('\n'),
        10_000,
      );
    }
    if (sc.familyId && summary) await sc.db.upsertFamilySummary(sc.familyId, summary, sc.now());
    if (sc.callId) {
      await sc.db.finishCall(sc.callId, {
        endedAt: sc.now(),
        outcome: sc.outcome,
        summary,
        familyId: sc.familyId,
        transcript,
        ...(extra.metrics !== undefined ? { metrics: extra.metrics } : {}),
        ...(extra.traceId !== undefined ? { traceId: extra.traceId } : {}),
      });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { summary, error };
}
