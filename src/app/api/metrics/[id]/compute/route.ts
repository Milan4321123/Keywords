import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { computeMetric, MetricDefinition } from '@/lib/metrics/compute';

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/metrics/[id]/compute - { mode: 'value'|'series', period?: {from,to} }
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const { data: metric, error } = await ctx.supabase
      .from('metrics')
      .select('*')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (error) throw error;
    if (!metric) return NextResponse.json({ data: null, error: 'Metric not found' }, { status: 404 });

    const result = await computeMetric(ctx.supabase, ctx.org.id, metric as MetricDefinition, {
      mode: body.mode === 'series' ? 'series' : 'value',
      period:
        body.period?.from && body.period?.to
          ? { from: String(body.period.from), to: String(body.period.to) }
          : undefined,
    });

    await audit(ctx, 'metric.compute', { type: 'metric', id }, {
      mode: result.mode,
      matched_rows: result.matched_rows,
    });

    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    return apiError(error, 'Failed to compute metric');
  }
}
