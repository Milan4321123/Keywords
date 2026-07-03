import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { ReportSections } from '@/lib/reports/generate';

type RouteParams = { params: Promise<{ id: string }> };

function esc(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toMarkdown(title: string, s: ReportSections): string {
  const lines: string[] = [`# ${title}`, ''];
  lines.push('## Executive Summary', s.executive_summary, '');
  lines.push('## Scope', s.scope, '');
  if (s.kpi_table.length > 0) {
    lines.push('## KPI Table', '', '| Metric | Value | Rows | Formula |', '|---|---|---|---|');
    for (const k of s.kpi_table) {
      lines.push(`| ${k.metric} | ${k.value ?? '—'} | ${k.matched_rows} | ${k.formula ?? ''} |`);
    }
    lines.push('');
  }
  if (s.trends) lines.push('## Trends', s.trends, '');
  if (s.anomalies.length > 0) lines.push('## Anomalies', ...s.anomalies.map((a) => `- ${a}`), '');
  if (s.risks) lines.push('## Risks', s.risks, '');
  if (s.missing_data.length > 0) lines.push('## Missing Data', ...s.missing_data.map((m) => `- ${m}`), '');
  if (s.recommended_actions.length > 0) {
    lines.push('## Recommended Actions', ...s.recommended_actions.map((a, i) => `${i + 1}. ${a}`), '');
  }
  if (s.keywords_used.length > 0) {
    lines.push('## Keywords Used', s.keywords_used.map((k) => k.title).join(', '), '');
  }
  if (s.data_sources.length > 0) {
    lines.push('## Data Sources', ...s.data_sources.map((d) => `- ${d.type}: ${d.name}`), '');
  }
  if (s.evidence.length > 0) {
    lines.push('## Evidence References', ...s.evidence.slice(0, 50).map((e) => `- ${e.kind}: ${e.reference}`), '');
  }
  return lines.join('\n');
}

function toHtml(title: string, s: ReportSections): string {
  const section = (heading: string, body: string) =>
    body ? `<h2>${esc(heading)}</h2>${body}` : '';
  const list = (items: string[]) =>
    items.length > 0 ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
  const kpiRows = s.kpi_table
    .map(
      (k) =>
        `<tr><td>${esc(k.metric)}</td><td>${k.value ?? '—'}</td><td>${k.matched_rows}</td><td>${esc(k.formula ?? '')}</td><td>${k.trend
          .map((t) => `${esc(t.period)}: ${t.value ?? '—'}`)
          .join('<br/>')}</td></tr>`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#1e293b;line-height:1.6}
h1{border-bottom:2px solid #e2e8f0;padding-bottom:12px}h2{margin-top:32px;color:#0f172a}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #e2e8f0;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f8fafc}.muted{color:#64748b;font-size:13px}
@media print{body{margin:0}h2{page-break-after:avoid}}
</style></head><body>
<h1>${esc(title)}</h1>
${section('Executive Summary', `<p>${esc(s.executive_summary)}</p>`)}
${section('Scope', `<p>${esc(s.scope)}</p>`)}
${s.kpi_table.length > 0 ? `<h2>KPI Table</h2><table><tr><th>Metric</th><th>Value</th><th>Rows</th><th>Formula</th><th>Recent trend</th></tr>${kpiRows}</table>` : ''}
${section('Trends', `<p>${esc(s.trends)}</p>`)}
${section('Anomalies', list(s.anomalies))}
${section('Risks', `<p>${esc(s.risks)}</p>`)}
${section('Missing Data', list(s.missing_data))}
${section('Recommended Actions', list(s.recommended_actions))}
${section('Keywords Used', `<p class="muted">${esc(s.keywords_used.map((k) => k.title).join(', '))}</p>`)}
${section('Data Sources', list(s.data_sources.map((d) => `${d.type}: ${d.name}`)))}
${section('Evidence References', list(s.evidence.slice(0, 50).map((e) => `${e.kind}: ${e.reference}`)))}
<p class="muted">Every number above was computed from stored data. Use your browser's Print → Save as PDF for a PDF copy.</p>
</body></html>`;
}

function toCsv(s: ReportSections): string {
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['metric,value,matched_rows,formula'];
  for (const k of s.kpi_table) {
    lines.push([k.metric, k.value ?? '', k.matched_rows, k.formula ?? ''].map(escape).join(','));
  }
  return lines.join('\n');
}

// GET /api/reports/[id]/export?format=md|html|csv
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('export_data');
    const { id } = await params;
    const format = new URL(req.url).searchParams.get('format') ?? 'md';

    const { data: report, error } = await ctx.supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (error) throw error;
    if (!report) return NextResponse.json({ data: null, error: 'Report not found' }, { status: 404 });

    const sections = report.sections as ReportSections;
    const safeTitle = report.title.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);

    await audit(ctx, 'data.export', { type: 'report', id }, { format });

    if (format === 'html') {
      return new NextResponse(toHtml(report.title, sections), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    if (format === 'csv') {
      return new NextResponse(toCsv(sections), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeTitle}.csv"`,
        },
      });
    }
    return new NextResponse(toMarkdown(report.title, sections), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeTitle}.md"`,
      },
    });
  } catch (error) {
    return apiError(error, 'Failed to export report');
  }
}
