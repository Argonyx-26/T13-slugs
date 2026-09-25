import { createUIMessageStream, createUIMessageStreamResponse, generateId } from 'ai';
import { z } from 'zod';
import type { PatientChatMessage } from '@/features/patients/api/types';
import { answerQuestion } from '@/features/patients/server/assistant';
import { LumenApiError } from '@/features/patients/server/lumen-api';

// The orchestrator's /ask can wait for the GPU slot
export const maxDuration = 90;

const requestSchema = z.object({
  patientId: z.string().min(1).max(64),
  question: z.string().trim().min(1).max(500)
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Word-sized pieces, whitespace kept, so the answer types out like the model is streaming it. */
function pieces(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'patientId and a question of up to 500 characters are required.' }, { status: 400 });
  }
  const { patientId, question } = parsed.data;

  const stream = createUIMessageStream<PatientChatMessage>({
    execute: async ({ writer }) => {
      const { answer, source } = await answerQuestion(patientId, question);

      writer.write({ type: 'start', messageMetadata: { refused: answer.refused, source } });
      const id = generateId();
      writer.write({ type: 'text-start', id });
      for (const delta of pieces(answer.answer)) {
        writer.write({ type: 'text-delta', id, delta });
        await sleep(12);
      }
      writer.write({ type: 'text-end', id });
      if (answer.citations.length) {
        writer.write({ type: 'data-citations', data: { items: answer.citations } });
      }
      writer.write({ type: 'finish' });
    },
    // Only messages written for people; exception details can contain patient text
    onError: (error) =>
      error instanceof LumenApiError ? error.message : 'The assistant is unavailable right now.'
  });

  return createUIMessageStreamResponse({ stream });
}
