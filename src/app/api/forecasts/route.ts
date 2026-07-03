import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api';
import { computeMetric, MetricDefinition } from '@/lib/metrics/compute';
import { forecastSeries } from '@/lib/forecasting/forecast';

// GET /api/forecasts - Past forecast runs
export async function GET() {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const { data, error } = await ctx.supabase
      .from('forecasts')
      .select('*, metric:metrics(id, name), runs:forecast_runs(*)')
      .eq('organization_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return NextResponse.json({ data: data ?? [], error: null });
  } catch (error) {
    return apiError(error, 'Failed to list forecasts');
  }
}

// POST /api/forecasts - Run a forecast for a metric: { metric_id, horizon }
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('generate_reports');
    enforceRateLimit('heavy', ctx.user.id);
    const body = await req.json();

    const metricId: string = body.metric_id;
    const horizon = Math.max(1, Math.min(parseInt(body.horizon, 10) || 3, 12));
    if (!metricId) {
      return NextResponse.json({ data: null, error: 'metric_id required' }, { status: 400 });
    }

    const { data: metric, error: mErr } = await ctx.supabase
      .from('metrics')
      .select('*')
      .eq('id', metricId)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!metric) return NextResponse.json({ data: null, error: 'Metric not found' }, { status: 404 });

    // History comes from the metric's own computation — never estimated
    const computation = await computeMetric(ctx.supabase, ctx.org.id, metric as MetricDefinition, {
      mode: 'series',
    });
    const history = computation.series
      .filter((p) => p.value != null)
      .map((p) => ({ period: p.period, value: p.value as number }));

    const result = forecastSeries(history, horizon);

    const { data: forecast, error: fErr } = await ctx.supabase
      .from('forecasts')
      .insert({
        organization_id: ctx.org.id,
        metric_id: metricId,
        name: `${metric.name} forecast (+${horizon} ${metric.time_grain ?? 'month'}s)`,
        horizon_periods: horizon,
        time_grain: metric.time_grain ?? 'month',
        created_by: ctx.user.id,
      })
      .select('id')
      .single();
    if (fErr) throw fErr;

    await ctx.supabase.from('forecast_runs').insert({
      forecast_id: forecast.id,
      organization_id: ctx.org.id,
      model: result.model,
      history_points: result.history_points,
      assumptions: { list: result.assumptions, fit: result.fit },
      results: result.forecasts,
      status: result.ok ? 'done' : 'failed',
    });

    await audit(ctx, 'forecast.run', { type: 'forecast', id: forecast.id }, {
      metric: metric.name,
      horizon,
      ok: result.ok,
    });

    return NextResponse.json({
      data: {
        forecast_id: forecast.id,
        metric: { id: metric.id, name: metric.name, time_grain: metric.time_grain },
        history,
        ...result,
        missing: computation.missing,
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to run forecast');
  }
}
