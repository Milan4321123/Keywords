import { NextResponse } from 'next/server';
import { mapSupabaseApiError } from '@/lib/supabase-errors';
import { authErrorResponse } from '@/lib/auth';

/**
 * Standard error → response mapping for API routes:
 * ApiAuthError → its status (401/403), otherwise Supabase/env mapping.
 */
export function apiError(error: unknown, fallbackMessage: string): NextResponse {
  const authErr = authErrorResponse(error);
  if (authErr) {
    return NextResponse.json({ data: null, error: authErr.message }, { status: authErr.status });
  }
  console.error(fallbackMessage, error);
  const mapped = mapSupabaseApiError(error, fallbackMessage);
  return NextResponse.json({ data: null, error: mapped.message }, { status: mapped.status });
}
