import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit, OrgContext } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api';
import { getProvider } from '@/lib/ai/provider';
import { computeMetric, MetricDefinition } from '@/lib/metrics/compute';

export const maxDuration = 120;

const AGGREGATIONS = ['sum', 'count', 'avg', 'min', 'max'];
const GRAINS = ['day', 'month', 'quarter', 'year'];
const FILTER_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'between', 'is_null', 'not_null'];

interface TableSchema {
  id: string;
  dataset: string;
  name: string;
  row_count: number;
  columns: Array<{ field: string; type: string; semantic: string | null; samples: string[] }>;
}

interface MetricJoin {
  right_table_id: string;
  left_key: string;
  right_key: string;
  join_type: 'inner' | 'left';
}

interface MetricSpec {
  name: string;
  description: string | null;
  formula: string;
  source_table_id: string;
  aggregation: string;
  value_column: string | null;
  date_column: string | null;
  filters: Array<Record<string, unknown>>;
  time_grain: string;
  caveats: string | null;
  join: MetricJoin | null;
}

async function loadSchemas(ctx: OrgContext): Promise<TableSchema[]> {
  const { data: tables } = await ctx.supabase
    .from('dataset_tables')
    .select('id, name, row_count, dataset:datasets!inner(title, organization_id), columns:dataset_columns(normalized_name, data_type, semantic_name, sample_values)')
    .eq('dataset.organization_id', ctx.org.id)
    .limit(20);

  return ((tables ?? []) as any[]).map((t) => ({
    id: t.id,
    dataset: t.dataset?.title ?? '',
    name: t.name,
    row_count: t.row_count ?? 0,
    columns: (t.columns ?? []).map((c: any) => ({
      field: c.normalized_name,
      type: c.data_type,
      semantic: c.semantic_name ?? null,
      samples: (c.sample_values ?? []).slice(0, 3),
    })),
  }));
}

/** Hard server-side validation: the LLM proposes, the schema decides. */
function validateSpec(spec: any, schemas: TableSchema[]): { ok: true; spec: MetricSpec } | { ok: false; error: string } {
  const table = schemas.find((t) => t.id === spec?.source_table_id);
  if (!table) return { ok: false, error: `Unknown source_table_id "${spec?.source_table_id}"` };

  const fields = new Set(table.columns.map((c) => c.field));

  // Optional cross-table join: right table must exist, keys must exist on
  // each side, and joined right-side fields become referenceable as r_<field>.
  let join: MetricJoin | null = null;
  if (spec?.join && typeof spec.join === 'object' && spec.join.right_table_id) {
    const rightTable = schemas.find((t) => t.id === spec.join.right_table_id);
    if (!rightTable) return { ok: false, error: `Unknown join table "${spec.join.right_table_id}"` };
    const leftKey = String(spec.join.left_key ?? '');
    const rightKey = String(spec.join.right_key ?? '');
    if (!fields.has(leftKey)) {
      return { ok: false, error: `Join left_key "${leftKey}" not found in table "${table.name}"` };
    }
    const rightFields = new Set(rightTable.columns.map((c) => c.field));
    if (!rightFields.has(rightKey)) {
      return { ok: false, error: `Join right_key "${rightKey}" not found in table "${rightTable.name}"` };
    }
    for (const field of rightFields) fields.add(`r_${field}`);
    join = {
      right_table_id: rightTable.id,
      left_key: leftKey,
      right_key: rightKey,
      join_type: spec.join.join_type === 'left' ? 'left' : 'inner',
    };
  }

  const name = typeof spec.name === 'string' ? spec.name.trim().slice(0, 120) : '';
  if (!name) return { ok: false, error: 'Metric name missing' };

  const aggregation = String(spec.aggregation ?? '').toLowerCase();
  if (!AGGREGATIONS.includes(aggregation)) return { ok: false, error: `Invalid aggregation "${spec.aggregation}"` };

  const valueColumn = spec.value_column ?? null;
  if (aggregation !== 'count') {
    if (!valueColumn || !fields.has(valueColumn)) {
      return { ok: false, error: `value_column "${valueColumn}" not found in table "${table.name}"` };
    }
  } else if (valueColumn && !fields.has(valueColumn)) {
    return { ok: false, error: `value_column "${valueColumn}" not found in table "${table.name}"` };
  }

  const dateColumn = spec.date_column ?? null;
  if (dateColumn && !fields.has(dateColumn)) {
    return { ok: false, error: `date_column "${dateColumn}" not found in table "${table.name}"` };
  }

  const filters: Array<Record<string, unknown>> = [];
  for (const filter of Array.isArray(spec.filters) ? spec.filters : []) {
    if (!filter || typeof filter.field !== 'string' || !fields.has(filter.field)) {
      return { ok: false, error: `Filter references unknown column "${filter?.field}"` };
    }
    if (!FILTER_OPS.includes(String(filter.op))) {
      return { ok: false, error: `Invalid filter operator "${filter?.op}"` };
    }
    filters.push({ field: filter.field, op: filter.op, value: filter.value, values: filter.values, min: filter.min, max: filter.max });
  }

  return {
    ok: true,
    spec: {
      name,
      description: typeof spec.description === 'string' ? spec.description.slice(0, 500) : null,
      formula: typeof spec.formula === 'string' ? spec.formula.slice(0, 300) : `${aggregation}(${valueColumn ?? 'rows'})`,
      source_table_id: table.id,
      aggregation,
      value_column: aggregation === 'count' ? valueColumn : valueColumn,
      date_column: dateColumn,
      filters,
      time_grain: GRAINS.includes(spec.time_grain) ? spec.time_grain : 'day',
      caveats: typeof spec.caveats === 'string' ? spec.caveats.slice(0, 400) : null,
      join,
    },
  };
}

async function testCompute(ctx: OrgContext, spec: MetricSpec) {
  const fake: MetricDefinition = {
    id: '00000000-0000-0000-0000-000000000000',
    organization_id: ctx.org.id,
    name: spec.name,
    description: spec.description,
    formula: spec.formula,
    aggregation: spec.aggregation,
    source_table_id: spec.source_table_id,
    value_column: spec.value_column,
    date_column: spec.date_column,
    dimensions: [],
    filters: spec.filters as any,
    time_grain: spec.time_grain,
    caveats: spec.caveats,
    join_spec: spec.join
      ? {
          right_table_id: spec.join.right_table_id,
          left_key: spec.join.left_key,
          right_key: spec.join.right_key,
          join_type: spec.join.join_type,
        }
      : null,
  };
  const value = await computeMetric(ctx.supabase, ctx.org.id, fake, { mode: 'value' });
  return { value: value.value, matched_rows: value.matched_rows, missing: value.missing };
}

const SYSTEM_PROMPT = `You translate a business owner's plain-language description into metric definitions for a deterministic computation engine — like writing the Excel/SQL formula for them.

The engine supports: one aggregation (sum|count|avg|min|max) over ONE numeric column, with optional row filters, an optional date column for time series, and OPTIONALLY a JOIN of a second table before aggregating.

JOIN (cross-table metrics): add "join": {"right_table_id":"...","left_key":"<field in source table>","right_key":"<field in right table>","join_type":"inner"|"left"}.
After the join, every column of the right table is referenceable with the prefix "r_" — in value_column, date_column, and filters. Example: source item_sales joined to menu_economics on item_code → value_column "r_contribution_margin_eur" sums the margin of each sold line. Join on identifier/entity columns that clearly hold the same values.

Rules:
- Use ONLY table ids and column field names from the provided schemas. Never invent columns.
- If the requested math is a RATIO of two aggregations (e.g. "waste as % of revenue"), decompose it into the component metrics (numerator and denominator as separate metrics) and explain the division in the caveats. A per-row combination across tables is NOT a ratio — use a join for that.
- Prefer semantic hints (amount, business_date, status, identifier, person …) to choose columns and join keys.
- Filters express conditions like status = 'paid'.
- German or English input is fine; write metric names in the language the user used.
- Return ONLY JSON:
{"metrics":[{"name":"...","description":"...","formula":"human-readable formula","source_table_id":"...","aggregation":"sum","value_column":"..."|null,"date_column":"..."|null,"filters":[{"field":"...","op":"eq","value":"..."}],"time_grain":"day","caveats":"..."|null,"join":{...}|null}], "note":"one sentence for the user, same language as their request"}
Maximum 4 metrics.`;

// POST /api/ai/design-metric
// { description } → AI-drafted, validated, test-computed metric specs
// { suggest: true } → AI proposes useful metrics from the existing data
// { confirm: true, spec } → save an approved spec to the metric catalog
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('generate_reports');
    enforceRateLimit('ai', ctx.user.id);
    const body = await req.json();

    const schemas = await loadSchemas(ctx);
    if (schemas.length === 0) {
      return NextResponse.json(
        { data: null, error: 'Keine Datentabellen vorhanden — erst Daten anlegen oder importieren · No data tables yet' },
        { status: 400 }
      );
    }

    // ---- Save an approved spec ----
    if (body.confirm === true) {
      const validated = validateSpec(body.spec, schemas);
      if (!validated.ok) {
        return NextResponse.json({ data: null, error: validated.error }, { status: 400 });
      }
      // Unique name per org: suffix on collision
      let finalName = validated.spec.name;
      const { data: existing } = await ctx.supabase
        .from('metrics')
        .select('name')
        .eq('organization_id', ctx.org.id)
        .ilike('name', `${finalName}%`);
      const taken = new Set((existing ?? []).map((m) => m.name.toLowerCase()));
      for (let i = 2; taken.has(finalName.toLowerCase()); i++) {
        finalName = `${validated.spec.name} (${i})`;
      }

      const { data: metric, error } = await ctx.supabase
        .from('metrics')
        .insert({
          organization_id: ctx.org.id,
          keyword_id: body.keyword_id || null,
          name: finalName,
          description: validated.spec.description,
          formula: validated.spec.formula,
          aggregation: validated.spec.aggregation,
          source_table_id: validated.spec.source_table_id,
          value_column: validated.spec.value_column,
          date_column: validated.spec.date_column,
          dimensions: [],
          filters: validated.spec.filters,
          time_grain: validated.spec.time_grain,
          caveats: validated.spec.caveats,
          owner_member_id: ctx.memberId,
          join_spec: validated.spec.join
            ? {
                right_table_id: validated.spec.join.right_table_id,
                left_key: validated.spec.join.left_key,
                right_key: validated.spec.join.right_key,
                join_type: validated.spec.join.join_type,
              }
            : null,
        })
        .select()
        .single();
      if (error) throw error;

      await audit(ctx, 'metric.create', { type: 'metric', id: metric.id }, { name: finalName, source: 'ai_designer' });
      return NextResponse.json({ data: { metric }, error: null });
    }

    // ---- Draft specs with the LLM ----
    const suggest = body.suggest === true;
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!suggest && !description) {
      return NextResponse.json({ data: null, error: 'description required' }, { status: 400 });
    }

    const provider = getProvider();
    const userPrompt = suggest
      ? 'Propose the 3-4 most useful business metrics this company should track, based purely on the data that exists in the schemas.'
      : description;

    const raw = await provider.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({ request: userPrompt, available_tables: schemas }),
        },
      ],
      { tier: 'strong', json: true, temperature: 0.2, maxTokens: 1500 }
    );

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ data: null, error: 'AI returned an unparseable answer — try again' }, { status: 502 });
    }

    const proposals: Array<{ spec: MetricSpec; test: Awaited<ReturnType<typeof testCompute>> } | { rejected: string }> = [];
    for (const candidate of (Array.isArray(parsed.metrics) ? parsed.metrics : []).slice(0, 4)) {
      const validated = validateSpec(candidate, schemas);
      if (!validated.ok) {
        proposals.push({ rejected: `${candidate?.name ?? 'metric'}: ${validated.error}` });
        continue;
      }
      // The proof: run the AI's math on the real data before the user sees it
      const test = await testCompute(ctx, validated.spec);
      proposals.push({ spec: validated.spec, test });
    }

    const valid = proposals.filter((p): p is { spec: MetricSpec; test: any } => 'spec' in p);
    const rejected = proposals.filter((p): p is { rejected: string } => 'rejected' in p).map((p) => p.rejected);

    if (valid.length === 0) {
      return NextResponse.json(
        { data: null, error: `Kein gültiger Vorschlag · No valid proposal${rejected.length ? ` (${rejected[0]})` : ''}` },
        { status: 422 }
      );
    }

    await audit(ctx, 'ai.design_metric', { type: 'metric' }, {
      mode: suggest ? 'suggest' : 'describe',
      proposals: valid.length,
    });

    return NextResponse.json({
      data: {
        proposals: valid,
        note: typeof parsed.note === 'string' ? parsed.note : null,
        rejected,
        tables: schemas.map((s) => ({ id: s.id, label: `${s.dataset} — ${s.name}` })),
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to design metric');
  }
}
