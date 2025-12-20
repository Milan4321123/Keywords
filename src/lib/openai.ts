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
  options?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.max_tokens ?? 2000,
  });
  return response.choices[0].message.content || '';
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
