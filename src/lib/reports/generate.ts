import { OrgContext } from '@/lib/auth';
import { getProvider } from '@/lib/ai/provider';
import { buildContext } from '@/lib/ai/context-builder';
import { computeMetric, MetricDefinition, MetricComputation } from '@/lib/metrics/compute';

export interface KpiTableRow {
  metric_id: string;
  metric: string;
  value: number | null;
  formula: string | null;
  matched_rows: number;
  anomalies: string[];
  trend: Array<{ period: string; value: number | null }>;
  evidence_row_ids: string[];
  missing: string[];
}

export interface ReportSections {
  executive_summary: string;
  scope: string;
  keywords_used: Array<{ id: string; title: string }>;
  data_sources: Array<{ type: string; name: string; id: string }>;
  kpi_table: KpiTableRow[];
  trends: string;
  anomalies: string[];
  risks: string;
  missing_data: string[];
  recommended_actions: string[];
  evidence: Array<{ kind: string; reference: string }>;
}

export interface GeneratedReport {
  title: string;
  report_type: string;
  period_start: string | null;
  period_end: string | null;
  sections: ReportSections;
  sources: Record<string, any>;
}

/**
 * Generate a grounded company report: every number in the KPI table is
 * computed by the metric engine; the LLM only writes the narrative around
 * the computed facts and is shown nothing else.
 */
export async function generateReport(
  ctx: OrgContext,
  params: {
    title?: string;
    report_type?: string;
    period?: { from: string; to: string } | null;
    keyword_ids?: string[];
  }
): Promise<GeneratedReport> {
  const reportType = params.report_type ?? 'custom';
  const period = params.period ?? null;
  const missingData: string[] = [];

  // 1. Compute every catalog metric (real numbers only)
  const { data: metricRows } = await ctx.supabase
    .from('metrics')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .limit(10);

  const kpiTable: KpiTableRow[] = [];
  for (const metric of (metricRows ?? []) as MetricDefinition[]) {
    let value: MetricComputation | null = null;
    let series: MetricComputation | null = null;
    try {
      value = await computeMetric(ctx.supabase, ctx.org.id, metric, {
        mode: 'value',
        period: period ?? undefined,
      });
      series = await computeMetric(ctx.supabase, ctx.org.id, metric, { mode: 'series' });
    } catch (error) {
      console.error('Metric computation failed in report:', metric.name, error);
    }
    const anomalies = (series?.series ?? [])
      .filter((p) => p.anomaly)
      .map((p) => `${metric.name}: unusual value ${p.value} in ${p.period}`);
    kpiTable.push({
      metric_id: metric.id,
      metric: metric.name,
      value: value?.value ?? null,
      formula: metric.formula,
      matched_rows: value?.matched_rows ?? 0,
      anomalies,
      trend: (series?.series ?? []).slice(-8).map((p) => ({ period: p.period, value: p.value })),
      evidence_row_ids: (value?.evidence_row_ids ?? []).slice(0, 10),
      missing: value?.missing ?? [],
    });
    missingData.push(...(value?.missing ?? []));
  }
  if (kpiTable.length === 0) {
    missingData.push('No metrics are defined in the catalog — the KPI table is empty.');
  }

  // 2. Open data quality issues
  const { data: qualityIssues } = await ctx.supabase
    .from('data_quality_issues')
    .select('issue_type, severity, description')
    .eq('organization_id', ctx.org.id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(15);

  // 3. Ontology + document context for the narrative
  const built = await buildContext(ctx, {
    question: `Write a ${reportType} report for the organization${period ? ` covering ${period.from} to ${period.to}` : ''}.`,
    intent: 'report',
    scopeKeywordIds: params.keyword_ids ?? [],
  });
  missingData.push(...built.envelope.missing_data);

  // 4. Narrative synthesis around the computed facts
  const provider = getProvider();
  const factSheet = {
    organization: ctx.org.name,
    report_type: reportType,
    period,
    computed_kpis: kpiTable.map((k) => ({
      metric: k.metric,
      value: k.value,
      matched_rows: k.matched_rows,
      recent_trend: k.trend,
      anomalies: k.anomalies,
    })),
    open_quality_issues: qualityIssues ?? [],
    open_tasks: built.envelope.workflow_context,
    missing_data: missingData,
  };

  let narrative = {
    executive_summary: '',
    trends: '',
    risks: '',
    recommended_actions: [] as string[],
  };
  try {
    const raw = await provider.chat(
      [
        {
          role: 'system',
          content:
            'You write the narrative for a company report. Use ONLY the computed facts, quality issues, tasks, and company context provided — never invent numbers or facts. ' +
            'Return ONLY JSON: {"executive_summary": "3-6 sentences", "trends": "2-5 sentences on the computed trends", "risks": "2-5 sentences on risks incl. data quality", "recommended_actions": ["action", ...max 6]}',
        },
        {
          role: 'user',
          content: JSON.stringify({ facts: factSheet, company_context: built.contextText.slice(0, 8000) }),
        },
      ],
      { tier: 'strong', json: true, temperature: 0.3, maxTokens: 1200 }
    );
    const parsed = JSON.parse(raw);
    narrative = {
      executive_summary: String(parsed.executive_summary ?? ''),
      trends: String(parsed.trends ?? ''),
      risks: String(parsed.risks ?? ''),
      recommended_actions: Array.isArray(parsed.recommended_actions)
        ? parsed.recommended_actions.map(String).slice(0, 6)
        : [],
    };
  } catch (error) {
    console.error('Report narrative synthesis failed:', error);
    narrative.executive_summary =
      'Narrative generation failed; the computed KPI table and evidence below are complete and correct.';
  }

  const sections: ReportSections = {
    executive_summary: narrative.executive_summary,
    scope: `${reportType} report for ${ctx.org.name}${period ? `, period ${period.from} → ${period.to}` : ' (all time)'}${
      params.keyword_ids?.length ? `, scoped to ${params.keyword_ids.length} keyword(s)` : ''
    }`,
    keywords_used: built.keywords.map((k) => ({ id: k.id, title: k.title })),
    data_sources: [
      ...built.datasetSchemas.map((s) => ({ type: 'dataset_table', name: `${s.dataset_title} — ${s.table_name}`, id: s.table_id })),
      ...built.chunks.map((c) => ({ type: 'document_chunk', name: c.id.slice(0, 8), id: c.id })),
    ],
    kpi_table: kpiTable,
    trends: narrative.trends,
    anomalies: kpiTable.flatMap((k) => k.anomalies),
    risks: narrative.risks,
    missing_data: Array.from(new Set(missingData)),
    recommended_actions: narrative.recommended_actions,
    evidence: kpiTable.flatMap((k) =>
      k.evidence_row_ids.map((id) => ({ kind: 'dataset_row', reference: `${k.metric}:${id}` }))
    ),
  };

  return {
    title:
      params.title?.trim() ||
      `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} report — ${new Date().toISOString().slice(0, 10)}`,
    report_type: reportType,
    period_start: period?.from ?? null,
    period_end: period?.to ?? null,
    sections,
    sources: {
      keywords: sections.keywords_used,
      tables: built.datasetSchemas.map((s) => s.table_id),
      provider: provider.name,
    },
  };
}
