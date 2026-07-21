import { NextResponse } from 'next/server';
import { mapSupabaseApiError } from '@/lib/supabase-errors';
import { authErrorResponse } from '@/lib/auth';

/**
 * AI-provider failures (OpenAI quota, rate limits, bad key, network) are
 * operational, not bugs — return 503 with a message the user can act on
 * instead of a generic 500.
 */
function mapAIProviderError(error: unknown): { status: number; message: string } | null {
  const status = (error as any)?.status ?? (error as any)?.response?.status;
  const code = (error as any)?.code ?? (error as any)?.error?.code ?? '';
  const message = String((error as any)?.message ?? '');

  if (code === 'insufficient_quota' || /exceeded your current quota/i.test(message)) {
    return {
      status: 503,
      message:
        'KI-Anbieter-Kontingent aufgebraucht — OpenAI-Abrechnung prüfen · AI provider quota exhausted, check OpenAI billing',
    };
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return {
      status: 503,
      message: 'KI-Anbieter überlastet, bitte kurz warten · AI provider rate-limited, retry shortly',
    };
  }
  const missingKey = message.match(/(OPENAI|GROQ|ANTHROPIC)_API_KEY is not configured/i)?.[1]?.toUpperCase();
  if (missingKey || /environment variable is missing/i.test(message)) {
    return {
      status: 503,
      message: `KI nicht konfiguriert — ${missingKey ?? 'AI'}_API_KEY setzen · AI not configured, set ${missingKey ?? 'AI'}_API_KEY`,
    };
  }
  if (/incorrect api key|invalid api key|invalid_api_key/i.test(message)) {
    return {
      status: 503,
      message: 'KI-Anbieter-Schlüssel ungültig · Invalid AI provider API key',
    };
  }
  return null;
}

/**
 * Standard error → response mapping for API routes:
 * ApiAuthError → its status (401/403/429), AI provider → 503,
 * otherwise Supabase/env mapping.
 */
export function apiError(error: unknown, fallbackMessage: string): NextResponse {
  const authErr = authErrorResponse(error);
  if (authErr) {
    return NextResponse.json({ data: null, error: authErr.message }, { status: authErr.status });
  }
  console.error(fallbackMessage, error);
  const aiErr = mapAIProviderError(error);
  if (aiErr) {
    return NextResponse.json({ data: null, error: aiErr.message }, { status: aiErr.status });
  }
  const mapped = mapSupabaseApiError(error, fallbackMessage);
  return NextResponse.json({ data: null, error: mapped.message }, { status: mapped.status });
}
