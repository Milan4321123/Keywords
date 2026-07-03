import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api';
import { generateReport } from '@/lib/reports/generate';

export const maxDuration = 120;

// GET /api/reports - Saved reports
export async function GET() {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const { data, error } = await ctx.supabase
      .from('reports')
      .select('id, title, report_type, period_start, period_end, status, created_at, profiles:created_by(email, full_name)')
      .eq('organization_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json({ data: data ?? [], error: null });
  } catch (error) {
    return apiError(error, 'Failed to list reports');
  }
}

// POST /api/reports - Generate and save a report
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('generate_reports');
    enforceRateLimit('heavy', ctx.user.id);
    const body = await req.json().catch(() => ({}));

    const generated = await generateReport(ctx, {
      title: body.title,
      report_type: typeof body.report_type === 'string' ? body.report_type : 'custom',
      period:
        body.period?.from && body.period?.to
          ? { from: String(body.period.from), to: String(body.period.to) }
          : null,
      keyword_ids: Array.isArray(body.keyword_ids) ? body.keyword_ids : [],
    });

    const { data: report, error } = await ctx.supabase
      .from('reports')
      .insert({
        organization_id: ctx.org.id,
        title: generated.title,
        report_type: generated.report_type,
        period_start: generated.period_start,
        period_end: generated.period_end,
        sections: generated.sections,
        sources: generated.sources,
        status: 'final',
        created_by: ctx.user.id,
      })
      .select()
      .single();
    if (error) throw error;

    await ctx.supabase.from('report_versions').insert({
      report_id: report.id,
      organization_id: ctx.org.id,
      version_no: 1,
      snapshot: report,
      changed_by: ctx.user.id,
    });

    await audit(ctx, 'report.generate', { type: 'report', id: report.id }, {
      title: report.title,
      report_type: report.report_type,
    });

    return NextResponse.json({ data: report, error: null });
  } catch (error) {
    return apiError(error, 'Failed to generate report');
  }
}
