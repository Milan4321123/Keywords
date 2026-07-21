import OpenAI from 'openai';
import { openai, AI_MODELS } from '@/lib/openai';

export type AIProviderName = 'openai' | 'anthropic' | 'groq';

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

export interface OpenAICompatibleToolRuntime {
  client: OpenAI;
  model: string;
  provider: 'openai' | 'groq';
}

const OPENAI_MODELS = { fast: AI_MODELS.fast, strong: AI_MODELS.chat };
const GROQ_MODELS = {
  fast: process.env.GROQ_FAST_MODEL ?? 'openai/gpt-oss-20b',
  strong: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
};
const ANTHROPIC_MODELS = {
  fast: process.env.ANTHROPIC_FAST_MODEL ?? 'claude-haiku-4-5-20251001',
  strong: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
};

let _groqClient: OpenAI | null = null;
function getGroqClient(): OpenAI {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }
  if (!_groqClient) {
    _groqClient = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return _groqClient;
}

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

const groqProvider: AIProvider = {
  name: 'groq',
  async chat(messages, options = {}) {
    const create = (jsonMode: boolean) => getGroqClient().chat.completions.create({
      model: GROQ_MODELS[options.tier ?? 'strong'],
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1500,
      ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    });

    let response;
    try {
      response = await create(Boolean(options.json));
    } catch (error) {
      // Groq can reject constrained JSON before returning a completion. Since
      // our JSON callers already demand JSON in their prompt and validate it,
      // retry once without constrained decoding instead of failing the page.
      if (!options.json || !/failed to validate json/i.test(String((error as any)?.message ?? error))) {
        throw error;
      }
      response = await create(false);
    }
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
 * Provider selection: AI_PROVIDER env var ('openai' | 'anthropic' | 'groq'),
 * defaulting to OpenAI. Embeddings and Whisper stay on OpenAI regardless.
 * Structured analytics uses the selected OpenAI-compatible runtime (Groq or
 * OpenAI) for native tool calling; the application still performs the math.
 */
export function getProvider(): AIProvider {
  const name = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();
  if (name === 'groq') {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured');
    return groqProvider;
  }
  if (name === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
    return anthropicProvider;
  }
  if (name === 'openai') return openaiProvider;
  throw new Error(`Unsupported AI_PROVIDER "${name}"`);
}

/** OpenAI-compatible native tool calling for the grounded analytics loop. */
export function getToolRuntime(tier: 'fast' | 'strong' = 'fast'): OpenAICompatibleToolRuntime {
  const provider = getProvider();
  if (provider.name === 'groq') {
    return { client: getGroqClient(), model: GROQ_MODELS[tier], provider: 'groq' };
  }
  if (provider.name === 'openai') {
    return { client: openai, model: OPENAI_MODELS[tier], provider: 'openai' };
  }
  throw new Error('ANTHROPIC_API_KEY is configured, but native analytics tool calling currently requires AI_PROVIDER=groq or openai');
}
