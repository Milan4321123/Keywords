import { openai } from '@/lib/openai';

export type AIProviderName = 'openai' | 'anthropic';

export interface ProviderChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object response. */
  json?: boolean;
  /** 'fast' = cheap routing/classification model; 'strong' = answer synthesis. */
  tier?: 'fast' | 'strong';
}

export interface AIProvider {
  name: AIProviderName;
  chat(messages: ProviderChatMessage[], options?: ProviderChatOptions): Promise<string>;
}

const OPENAI_MODELS = { fast: 'gpt-4o-mini', strong: 'gpt-4o' };
const ANTHROPIC_MODELS = {
  fast: process.env.ANTHROPIC_FAST_MODEL ?? 'claude-haiku-4-5-20251001',
  strong: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
};

const openaiProvider: AIProvider = {
  name: 'openai',
  async chat(messages, options = {}) {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODELS[options.tier ?? 'strong'],
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1500,
      ...(options.json ? { response_format: { type: 'json_object' as const } } : {}),
    });
    return response.choices[0]?.message?.content ?? '';
  },
};

const anthropicProvider: AIProvider = {
  name: 'anthropic',
  async chat(messages, options = {}) {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODELS[options.tier ?? 'strong'],
        max_tokens: options.maxTokens ?? 1500,
        temperature: options.temperature ?? 0.3,
        ...(system ? { system } : {}),
        messages: conversation.length > 0 ? conversation : [{ role: 'user', content: ' ' }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    const text = (data.content ?? [])
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('');
    // JSON mode is emulated by prompt on Anthropic; strip code fences if present
    if (options.json) {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      return match ? match[1].trim() : text.trim();
    }
    return text;
  },
};

/**
 * Provider selection: AI_PROVIDER env var ('openai' | 'anthropic'),
 * defaulting to OpenAI. Embeddings and Whisper stay on OpenAI regardless.
 * Note: the structured-data tool loop currently uses OpenAI's native tool
 * calling; provider switching applies to routing and answer synthesis.
 */
export function getProvider(): AIProvider {
  const name = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();
  if (name === 'anthropic' && process.env.ANTHROPIC_API_KEY) return anthropicProvider;
  return openaiProvider;
}
