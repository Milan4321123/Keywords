export type FilterOp =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'contains'
  | 'between'
  | 'is_null'
  | 'not_null';

export type AggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface TableQueryFilter {
  field: string;
  op: FilterOp;
  value?: unknown;
  values?: unknown[];
  min?: unknown;
  max?: unknown;
}

export interface TableQueryMetric {
  op: AggregateOp;
  field?: string;
  as: string;
}

export interface TableQueryOrderBy {
  field: string;
  direction?: 'asc' | 'desc';
}

export interface TableQuerySpec {
  filters?: TableQueryFilter[];
  group_by?: string[];
  metrics: TableQueryMetric[];
  order_by?: TableQueryOrderBy[];
  limit?: number;
  evidence_limit?: number;
}

export interface DatasetRow {
  id: string;
  row_index: number;
  data: Record<string, unknown>;
  source_json?: Record<string, unknown>;
}

export interface TableQueryResult {
  rows: Array<Record<string, unknown>>;
  stats: {
    input_rows: number;
    matched_rows: number;
    grouped_rows: number;
  };
  evidence: {
    used_row_ids: string[];
    used_row_ids_by_group?: Record<string, string[]>;
  };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;
  const normalized = trimmed.replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.');
  const eu = Number(normalized);
  return Number.isFinite(eu) ? eu : null;
}

function comparable(value: unknown): number | string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = parseNumber(trimmed);
    if (num !== null) return num;
    const d = Date.parse(trimmed);
    if (!Number.isNaN(d)) return d;
    return trimmed.toLowerCase();
  }
  return String(value);
}

function matchesFilter(row: DatasetRow, filter: TableQueryFilter): boolean {
  const v = row.data[filter.field];
  switch (filter.op) {
    case 'is_null':
      return v == null || String(v).trim() === '';
    case 'not_null':
      return !(v == null || String(v).trim() === '');
    case 'eq':
      return comparable(v) === comparable(filter.value);
    case 'ne':
      return comparable(v) !== comparable(filter.value);
    case 'lt': {
      const a = comparable(v);
      const b = comparable(filter.value);
      return a != null && b != null && a < b;
    }
    case 'lte': {
      const a = comparable(v);
      const b = comparable(filter.value);
      return a != null && b != null && a <= b;
    }
    case 'gt': {
      const a = comparable(v);
      const b = comparable(filter.value);
      return a != null && b != null && a > b;
    }
    case 'gte': {
      const a = comparable(v);
      const b = comparable(filter.value);
      return a != null && b != null && a >= b;
    }
    case 'contains': {
      const text = v == null ? '' : String(v).toLowerCase();
      const needle = filter.value == null ? '' : String(filter.value).toLowerCase();
      return needle ? text.includes(needle) : true;
    }
    case 'in': {
      const set = new Set((filter.values ?? []).map((x) => comparable(x)));
      return set.has(comparable(v));
    }
    case 'between': {
      const a = comparable(v);
      const min = comparable(filter.min);
      const max = comparable(filter.max);
      if (a == null || min == null || max == null) return false;
      return a >= min && a <= max;
    }
    default:
      return true;
  }
}

function groupKeyFor(row: DatasetRow, groupBy: string[]): { key: string; dims: Record<string, unknown> } {
  const dims: Record<string, unknown> = {};
  const parts = groupBy.map((f) => {
    const v = row.data[f];
    dims[f] = v ?? null;
    return v == null ? '' : String(v);
  });
  return { key: parts.join('\u0001'), dims };
}

export function runTableQuery(rows: DatasetRow[], spec: TableQuerySpec): TableQueryResult {
  const filters = spec.filters ?? [];
  const groupBy = spec.group_by ?? [];
  const evidenceLimit = Math.max(0, spec.evidence_limit ?? 25);
  const limit = spec.limit ?? 100;

  const inputRows = rows.length;
  const matched: DatasetRow[] = [];
  for (const row of rows) {
    if (filters.every((f) => matchesFilter(row, f))) matched.push(row);
  }

  const usedRowIds: string[] = [];
  const takeEvidence = (id: string) => {
    if (evidenceLimit === 0) return;
    if (usedRowIds.length < evidenceLimit) usedRowIds.push(id);
  };

  if (groupBy.length === 0) {
    const output: Record<string, unknown> = {};
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};

    for (const m of spec.metrics) {
      if (m.op === 'count') output[m.as] = 0;
      else output[m.as] = null;
      if (m.op === 'sum' || m.op === 'avg') sums[m.as] = 0;
      if (m.op === 'avg') counts[m.as] = 0;
    }

    for (const row of matched) {
      takeEvidence(row.id);
      for (const m of spec.metrics) {
        if (m.op === 'count') {
          output[m.as] = (output[m.as] as number) + 1;
          continue;
        }
        const field = m.field;
        if (!field) continue;
        const raw = row.data[field];
        if (m.op === 'min' || m.op === 'max') {
          const a = comparable(raw);
          if (a == null) continue;
          const cur = output[m.as];
          if (cur == null) {
            output[m.as] = raw;
          } else {
            const b = comparable(cur);
            if (b == null) output[m.as] = raw;
            else if (m.op === 'min' ? a < b : a > b) output[m.as] = raw;
          }
          continue;
        }
        const num = parseNumber(raw);
        if (num == null) continue;
        if (m.op === 'sum') {
          sums[m.as] += num;
          output[m.as] = sums[m.as];
        } else if (m.op === 'avg') {
          sums[m.as] += num;
          counts[m.as] += 1;
          output[m.as] = sums[m.as] / Math.max(1, counts[m.as]);
        } else if (m.op === 'max') {
          output[m.as] = output[m.as] == null ? num : Math.max(output[m.as] as number, num);
        } else if (m.op === 'min') {
          output[m.as] = output[m.as] == null ? num : Math.min(output[m.as] as number, num);
        }
      }
    }

    return {
      rows: [output],
      stats: { input_rows: inputRows, matched_rows: matched.length, grouped_rows: 1 },
      evidence: { used_row_ids: usedRowIds },
    };
  }

  const groups = new Map<
    string,
    {
      dims: Record<string, unknown>;
      metrics: Record<string, unknown>;
      sums: Record<string, number>;
      counts: Record<string, number>;
      evidence: string[];
    }
  >();

  for (const row of matched) {
    const { key, dims } = groupKeyFor(row, groupBy);
    let g = groups.get(key);
    if (!g) {
      const initMetrics: Record<string, unknown> = { ...dims };
      const sums: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const m of spec.metrics) {
        if (m.op === 'count') initMetrics[m.as] = 0;
        else initMetrics[m.as] = null;
        if (m.op === 'sum' || m.op === 'avg') sums[m.as] = 0;
        if (m.op === 'avg') counts[m.as] = 0;
      }
      g = { dims, metrics: initMetrics, sums, counts, evidence: [] };
      groups.set(key, g);
    }
    if (evidenceLimit > 0 && g.evidence.length < evidenceLimit) g.evidence.push(row.id);

    for (const m of spec.metrics) {
      if (m.op === 'count') {
        g.metrics[m.as] = (g.metrics[m.as] as number) + 1;
        continue;
      }
      const field = m.field;
      if (!field) continue;
      const raw = row.data[field];
      if (m.op === 'min' || m.op === 'max') {
        const a = comparable(raw);
        if (a == null) continue;
        const cur = g.metrics[m.as];
        if (cur == null) {
          g.metrics[m.as] = raw;
        } else {
          const b = comparable(cur);
          if (b == null) g.metrics[m.as] = raw;
          else if (m.op === 'min' ? a < b : a > b) g.metrics[m.as] = raw;
        }
        continue;
      }
      const num = parseNumber(raw);
      if (num == null) continue;
      if (m.op === 'sum') {
        g.sums[m.as] += num;
        g.metrics[m.as] = g.sums[m.as];
      } else if (m.op === 'avg') {
        g.sums[m.as] += num;
        g.counts[m.as] += 1;
        g.metrics[m.as] = g.sums[m.as] / Math.max(1, g.counts[m.as]);
      } else if (m.op === 'max') {
        g.metrics[m.as] = g.metrics[m.as] == null ? num : Math.max(g.metrics[m.as] as number, num);
      } else if (m.op === 'min') {
        g.metrics[m.as] = g.metrics[m.as] == null ? num : Math.min(g.metrics[m.as] as number, num);
      }
    }
  }

  const usedRowIdsByGroup: Record<string, string[]> = {};
  const out = Array.from(groups.entries()).map(([k, g]) => {
    usedRowIdsByGroup[k] = g.evidence;
    for (const id of g.evidence) takeEvidence(id);
    return g.metrics;
  });

  const orderBy = spec.order_by ?? [];
  if (orderBy.length > 0) {
    out.sort((a, b) => {
      for (const ob of orderBy) {
        const dir = ob.direction === 'desc' ? -1 : 1;
        const av = comparable(a[ob.field]);
        const bv = comparable(b[ob.field]);
        if (av == null && bv == null) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
      }
      return 0;
    });
  }

  return {
    rows: out.slice(0, limit),
    stats: { input_rows: inputRows, matched_rows: matched.length, grouped_rows: out.length },
    evidence: { used_row_ids: usedRowIds, used_row_ids_by_group: usedRowIdsByGroup },
  };
}

