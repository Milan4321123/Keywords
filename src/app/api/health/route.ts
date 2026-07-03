import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// GET /api/health - liveness + database reachability (no auth, no data)
export async function GET() {
  const startedAt = Date.now();
  let database = 'ok';
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from('organizations').select('id', { count: 'exact', head: true }).limit(1);
    if (error) database = 'error';
  } catch {
    database = 'error';
  }

  const healthy = database === 'ok';
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      latency_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
