import { SupabaseClient } from '@supabase/supabase-js';
import { runTableQuery, DatasetRow, TableQueryFilter, AggregateOp } from '@/lib/analytics';

export interface MetricDefinition {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  formula: string | null;
  aggregation: string | null;
  source_table_id: string | null;
  value_column: string | null;
  date_column: string | null;
  dimensions: string[];
  filters: TableQueryFilter[] | Record<string, never>;
  time_grain: string;
  caveats: string | null;
}

export interface MetricPoint {
  period: string;
  value: number | null;
  rows: number;
  anomaly?: boolean;
}

export interface MetricComputation {
  metric_id: string;
  metric_name: string;
  mode: 'value' | 'series';
  value: number | null;
  series: MetricPoint[];
  matched_rows: number;
  evidence_row_ids: string[];
  missing: string[];
}

const VALID_AGGS: AggregateOp[] = ['count', 'sum', 'avg', 'min', 'max'];

function periodKey(raw: unknown, grain: string): string | null {
  if (raw == null) return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  switch (grain) {
    case 'day': return `${y}-${m}-${d}`;
    case 'quarter': return `${y}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    case 'year': return String(y);
    case 'month':
    default: return `${y}-${m}`;
  }
}

/** Flag series points more than 2 standard deviations from the mean. */
export function flagAnomalies(series: MetricPoint[]): MetricPoint[] {
  const values = series.map((p) => p.value).filter((v): v is number => v != null);
  if (values.length < 4) return series;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  if (std === 0) return series;
  return series.map((p) => ({
    ...p,
    anomaly: p.value != null && Math.abs(p.value - mean) > 2 * std,
  }));
}

async function loadRows(
  supabase: SupabaseClient,
  organizationId: string,
  tableId: string
): Promise<DatasetRow[] | null> {
  // Tenancy check via the dataset join
  const { data: table } = await supabase
    .from('dataset_tables')
    .select('id, datasets!inner(organization_id)')
    .eq('id', tableId)
    .eq('datasets.organization_id', organizationId)
    .maybeSingle();
  if (!table) return null;

  const rows: DatasetRow[] = [];
  const pageSize = 2000;
  for (let offset = 0; offset < 50_000; offset += pageSize) {
    const { data, error } = await supabase
      .from('dataset_rows')
      .select('id, row_index, data, source_json')
      .eq('dataset_table_id', tableId)
      .order('row_index')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as DatasetRow[]));
    if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

/**
 * Compute a metric from its catalog definition. The definition — not the
 * question — decides which table, column, filters, and aggregation to use,
 * so "what is our income this month?" always computes the same way.
 */
export async function computeMetric(
  supabase: SupabaseClient,
  organizationId: string,
  metric: MetricDefinition,
  options: { mode?: 'value' | 'series'; period?: { from: string; to: string } } = {}
): Promise<MetricComputation> {
  const missing: string[] = [];
  const mode = options.mode ?? 'value';
  const empty: MetricComputation = {
    metric_id: metric.id,
    metric_name: metric.name,
    mode,
    value: null,
    series: [],
    matched_rows: 0,
    evidence_row_ids: [],
    missing,
  };

  if (!metric.source_table_id) {
    missing.push(`Metric "${metric.name}" has no source table configured.`);
    return empty;
  }
  const aggregation = (metric.aggregation ?? 'sum') as AggregateOp;
  if (!VALID_AGGS.includes(aggregation)) {
    missing.push(`Metric "${metric.name}" has unsupported aggregation "${metric.aggregation}".`);
    return empty;
  }
  if (aggregation !== 'count' && !metric.value_column) {
    missing.push(`Metric "${metric.name}" needs a value column for ${aggregation}.`);
    return empty;
  }

  const rows = await loadRows(supabase, organizationId, metric.source_table_id);
  if (rows === null) {
    missing.push(`Source table for metric "${metric.name}" was not found.`);
    return empty;
  }
  if (rows.length === 0) {
    missing.push(`Source table for metric "${metric.name}" has no rows.`);
    return empty;
  }

  const filters: TableQueryFilter[] = Array.isArray(metric.filters) ? metric.filters : [];
  if (options.period) {
    if (!metric.date_column) {
      missing.push(`Metric "${metric.name}" has no date column; the period filter was ignored.`);
    } else {
      filters.push({
        field: metric.date_column,
        op: 'between',
        min: options.period.from,
        max: options.period.to,
      });
    }
  }

  const metricSpec = {
    op: aggregation,
    field: metric.value_column ?? undefined,
    as: 'value',
  };

  if (mode === 'series') {
    if (!metric.date_column) {
      missing.push(`Metric "${metric.name}" has no date column; cannot build a time series.`);
      return empty;
    }
    // Materialize the period bucket, then group on it
    const augmented = rows.map((row) => ({
      ...row,
      data: { ...row.data, __period: periodKey(row.data[metric.date_column!], metric.time_grain) },
    }));
    const result = runTableQuery(augmented, {
      filters: [...filters, { field: '__period', op: 'not_null' }],
      group_by: ['__period'],
      metrics: [metricSpec, { op: 'count', as: '__count' }],
      order_by: [{ field: '__period', direction: 'asc' }],
      limit: 200,
      evidence_limit: 10,
    });
    const series: MetricPoint[] = result.rows.map((r) => ({
      period: String(r.__period),
      value: typeof r.value === 'number' ? r.value : null,
      rows: typeof r.__count === 'number' ? r.__count : 0,
    }));
    return {
      ...empty,
      series: flagAnomalies(series),
      matched_rows: result.stats.matched_rows,
      evidence_row_ids: result.evidence.used_row_ids,
    };
  }

  const result = runTableQuery(rows, {
    filters,
    metrics: [metricSpec],
    evidence_limit: 25,
  });
  const raw = result.rows[0]?.value;
  return {
    ...empty,
    value: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
    matched_rows: result.stats.matched_rows,
    evidence_row_ids: result.evidence.used_row_ids,
  };
}
