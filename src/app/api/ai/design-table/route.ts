import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit, accessibleLevels } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api';
import { getProvider } from '@/lib/ai/provider';

export const maxDuration = 120;

const COLUMN_TYPES = ['text', 'number', 'date', 'boolean'];
const KNOWN_SEMANTICS = [
  'business_date', 'event_timestamp', 'measurement_timestamp', 'weekday',
  'amount', 'quantity', 'unit', 'currency', 'status', 'identifier',
  'entity', 'dimension', 'period', 'employee_id', 'evidence_reference', 'person',
];

interface ColumnSpec {
  name: string;
  normalized_name: string;
  data_type: string;
  semantic_name: string | null;
  is_required: boolean;
  validation_rules: Record<string, unknown>;
  description: string | null;
}

interface TableSpec {
  dataset_title: string;
  table_name: string;
  description: string | null;
  keyword_id: string | null;
  columns: ColumnSpec[];
}

function slugifyField(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c] as string))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function validateSpec(
  raw: any,
  keywordIds: Set<string>
): { ok: true; spec: TableSpec } | { ok: false; error: string } {
  const tableName = slugifyField(raw?.table_name ?? '');
  if (!tableName) return { ok: false, error: 'table_name missing' };

  const datasetTitle = typeof raw?.dataset_title === 'string' && raw.dataset_title.trim()
    ? raw.dataset_title.trim().slice(0, 120)
    : tableName;

  const rawColumns = Array.isArray(raw?.columns) ? raw.columns.slice(0, 20) : [];
  if (rawColumns.length === 0) return { ok: false, error: 'No columns proposed' };

  const used = new Set<string>();
  const columns: ColumnSpec[] = [];
  for (const col of rawColumns) {
    const name = typeof col?.name === 'string' && col.name.trim() ? col.name.trim().slice(0, 80) : null;
    if (!name) continue;
    let normalized = slugifyField(col.normalized_name || name);
    if (!normalized) continue;
    let suffix = 2;
    while (used.has(normalized)) normalized = `${slugifyField(col.normalized_name || name)}_${suffix++}`;
    used.add(normalized);

    const dataType = COLUMN_TYPES.includes(col.data_type) ? col.data_type : 'text';
    const rawSemantic = typeof col.semantic_name === 'string' ? slugifyField(col.semantic_name) : '';
    const rules: Record<string, unknown> = {};
    if (typeof col?.validation_rules?.min === 'number') rules.min = col.validation_rules.min;
    if (typeof col?.validation_rules?.max === 'number') rules.max = col.validation_rules.max;

    columns.push({
      name,
      normalized_name: normalized,
      data_type: dataType,
      semantic_name: rawSemantic || null,
      is_required: Boolean(col.is_required),
      validation_rules: rules,
      description: typeof col.description === 'string' ? col.description.slice(0, 300) : null,
    });
  }
  if (columns.length === 0) return { ok: false, error: 'No usable columns' };

  const keywordId = typeof raw?.keyword_id === 'string' && keywordIds.has(raw.keyword_id) ? raw.keyword_id : null;

  return {
    ok: true,
    spec: {
      dataset_title: datasetTitle,
      table_name: tableName,
      description: typeof raw?.description === 'string' ? raw.description.slice(0, 400) : null,
      keyword_id: keywordId,
      columns,
    },
  };
}

const SYSTEM_PROMPT = `You design a structured data table ("placeholder") a business will fill in daily — like designing a well-structured spreadsheet, but with types and meaning.

Rules:
- Columns get German-friendly display names in the user's language; normalized_name is snake_case ASCII.
- data_type: text | number | date | boolean. Currency and money are ALWAYS number (the currency itself is a separate text column only if multiple currencies are plausible).
- semantic_name gives each column stable business meaning. Use these when they fit: ${KNOWN_SEMANTICS.join(', ')}. Amounts of money → "amount". The record's main date → "business_date" (enables daily tracking, auto-filled with today). Exact times → "event_timestamp". Who recorded it → "employee_id" (auto-filled). WHICH employee the record is ABOUT (whose shift, whose hours, whose tip) → "person" (rendered as a worker dropdown). Photo/receipt reference → "evidence_reference" (auto-filled).
- Time tracking / Zeiterfassung, tips per waiter, per-employee records → ALWAYS include a "person" column.
- ALWAYS include a business_date or event_timestamp column so records can be analyzed per day/month.
- Include an employee_id column and an evidence_reference column when workers will capture the data.
- Mark truly essential columns is_required=true. Add validation_rules {min,max} for numbers where obvious (e.g. amounts ≥ 0).
- If one of the provided keywords clearly matches the topic, set keyword_id to its id; else null.
- Maximum 15 columns; fewer is better.
Return ONLY JSON:
{"dataset_title":"...","table_name":"snake_case","description":"...","keyword_id":"..."|null,"columns":[{"name":"...","normalized_name":"...","data_type":"number","semantic_name":"amount"|null,"is_required":true,"validation_rules":{"min":0},"description":"..."}],"note":"one sentence for the user in their language"}`;

// POST /api/ai/design-table
// { description, keyword_id? } → AI-designed table spec (preview)
// { confirm: true, spec } → create the empty dataset table (ready for daily capture)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    enforceRateLimit('ai', ctx.user.id);
    const body = await req.json();

    const { data: keywords } = await ctx.supabase
      .from('keywords')
      .select('id, title, slug')
      .eq('organization_id', ctx.org.id)
      .in('access_level', accessibleLevels(ctx.role))
      .neq('status', 'archived')
      .limit(150);
    const keywordIds = new Set((keywords ?? []).map((k) => k.id));

    // ---- Create an approved spec ----
    if (body.confirm === true) {
      const validated = validateSpec(body.spec, keywordIds);
      if (!validated.ok) {
        return NextResponse.json({ data: null, error: validated.error }, { status: 400 });
      }
      const spec = validated.spec;
      // Manual keyword override from the preview UI wins
      if (typeof body.keyword_id === 'string' && keywordIds.has(body.keyword_id)) {
        spec.keyword_id = body.keyword_id;
      }

      const { data: dataset, error: datasetError } = await ctx.supabase
        .from('datasets')
        .insert({
          organization_id: ctx.org.id,
          keyword_id: spec.keyword_id,
          title: spec.dataset_title,
          description: spec.description,
          created_by: ctx.user.id,
        })
        .select('id')
        .single();
      if (datasetError) throw datasetError;

      const { data: table, error: tableError } = await ctx.supabase
        .from('dataset_tables')
        .insert({
          dataset_id: dataset.id,
          name: spec.table_name,
          row_count: 0,
          column_count: spec.columns.length,
          meta_json: { source: 'ai-table-designer', designed_at: new Date().toISOString() },
        })
        .select('id')
        .single();
      if (tableError) throw tableError;

      const { error: columnsError } = await ctx.supabase.from('dataset_columns').insert(
        spec.columns.map((col) => ({
          dataset_table_id: table.id,
          name: col.name,
          normalized_name: col.normalized_name,
          data_type: col.data_type,
          semantic_name: col.semantic_name,
          is_required: col.is_required,
          validation_rules: col.validation_rules,
          sample_values: [],
        }))
      );
      if (columnsError) throw columnsError;

      await audit(ctx, 'dataset.design', { type: 'dataset', id: dataset.id }, {
        table: spec.table_name,
        columns: spec.columns.length,
        keyword_id: spec.keyword_id,
      });

      return NextResponse.json({
        data: { dataset_id: dataset.id, table_id: table.id, keyword_id: spec.keyword_id },
        error: null,
      });
    }

    // ---- Draft the spec with the LLM ----
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description) {
      return NextResponse.json({ data: null, error: 'description required' }, { status: 400 });
    }

    const provider = getProvider();
    const raw = await provider.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            request: description,
            preselected_keyword_id: typeof body.keyword_id === 'string' ? body.keyword_id : null,
            available_keywords: (keywords ?? []).map((k) => ({ id: k.id, title: k.title })),
          }),
        },
      ],
      { tier: 'strong', json: true, temperature: 0.2, maxTokens: 1400 }
    );

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ data: null, error: 'AI returned an unparseable answer — try again' }, { status: 502 });
    }

    const validated = validateSpec(parsed, keywordIds);
    if (!validated.ok) {
      return NextResponse.json({ data: null, error: validated.error }, { status: 422 });
    }

    await audit(ctx, 'ai.design_table', { type: 'dataset' }, { table: validated.spec.table_name });

    return NextResponse.json({
      data: {
        spec: validated.spec,
        note: typeof parsed.note === 'string' ? parsed.note : null,
        keywords: (keywords ?? []).map((k) => ({ id: k.id, title: k.title })),
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to design table');
  }
}
