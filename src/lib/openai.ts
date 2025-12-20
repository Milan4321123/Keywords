import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function createEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text,
  });
  return response.data[0].embedding;
}

export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: { temperature?: number; max_tokens?: number; model?: string }
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: options?.model ?? 'gpt-4-turbo-preview',
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.max_tokens ?? 2000,
  });
  return response.choices[0].message.content || '';
}

export async function rerankChunks(params: {
  question: string;
  chunks: Array<{ id: string; text: string }>;
  topN?: number;
  model?: string;
}): Promise<Array<{ id: string; score: number }>> {
  const topN = Math.max(1, Math.min(params.topN ?? 10, 20));
  const model = params.model ?? 'gpt-4o-mini';

  // Keep payload bounded
  const candidates = params.chunks.slice(0, 25).map((c) => ({
    id: c.id,
    text: c.text.length > 900 ? c.text.slice(0, 900) + '…' : c.text,
  }));

  const system =
    'You are a retrieval reranker. Score each chunk for how useful it is to answer the question. ' +
    'Return ONLY valid JSON.';
  const user = {
    question: params.question,
    instructions: {
      score_range: '0..1',
      pick_top_n: topN,
      rules: [
        'Prefer chunks that directly answer the question.',
        'Prefer specific, factual, and on-topic information.',
        'Down-rank boilerplate, navigation, or irrelevant text.',
      ],
    },
    chunks: candidates,
    output_schema: {
      rankings: [{ id: 'chunk id', score: 0.0 }],
    },
  };

  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      temperature: 0,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });

    const content = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(content) as { rankings?: Array<{ id: string; score: number }> };
    const rankings = Array.isArray(parsed.rankings) ? parsed.rankings : [];

    const cleaned = rankings
      .filter((r) => typeof r?.id === 'string' && typeof r?.score === 'number')
      .map((r) => ({ id: r.id, score: Math.max(0, Math.min(1, r.score)) }));

    // Keep order as provided (assumed descending), but ensure only requested count.
    return cleaned.slice(0, topN);
  } catch {
    return [];
  }
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const uint8Array = new Uint8Array(audioBuffer);
  const file = new File([uint8Array], 'audio.webm', { type: 'audio/webm' });
  const response = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en', // Can be made dynamic
  });
  return response.text;
}

export { openai };
