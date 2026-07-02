function getErrorMessage(error: unknown): string {
  return String((error as any)?.message ?? error ?? 'Unknown error');
}

function getErrorDetails(error: unknown): string {
  return String((error as any)?.details ?? '');
}

function getConfiguredSupabaseHost(): string | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).host;
  } catch {
    return null;
  }
}

export function getSupabaseEnvIssue(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) return 'Missing NEXT_PUBLIC_SUPABASE_URL in .env/.env.local';
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      return 'NEXT_PUBLIC_SUPABASE_URL must start with http:// or https://';
    }
  } catch {
    return 'NEXT_PUBLIC_SUPABASE_URL is not a valid URL';
  }

  if (!anon) return 'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env/.env.local';
  if (!service) return 'Missing SUPABASE_SERVICE_ROLE_KEY in .env/.env.local';

  return null;
}

export function mapSupabaseApiError(error: unknown, fallbackMessage: string): { status: number; message: string } {
  const envIssue = getSupabaseEnvIssue();
  if (envIssue) {
    return {
      status: 500,
      message: `Supabase configuration error: ${envIssue}`,
    };
  }

  const message = getErrorMessage(error);
  const details = getErrorDetails(error);
  const combined = `${message}\n${details}`.toLowerCase();

  if (combined.includes('enotfound') || combined.includes('getaddrinfo enotfound') || combined.includes('fetch failed')) {
    const host = getConfiguredSupabaseHost();
    return {
      status: 503,
      message: `Supabase host is unreachable${host ? ` (${host})` : ''}. Check NEXT_PUBLIC_SUPABASE_URL in .env/.env.local and verify the project URL in Supabase dashboard.`,
    };
  }

  return { status: 500, message: fallbackMessage };
}
