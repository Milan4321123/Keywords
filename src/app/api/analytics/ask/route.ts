import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { requireOrgContext, audit, authErrorResponse } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { openai } from '@/lib/openai';
import { runTableQuery, comparePeriods, TableQuerySpec, ComparePeriodsSpec } from '@/lib/analytics';
import { AnalyticsAskRequest } from '@/types';

export const runtime = 'nodejs';

async function fetchRows(params: {
  supabase: SupabaseClient;
  datasetTableId: string;
  maxRows: number;
}) {
  const out: Array<{ id: string; row_index: number; data: Record<string, unknown>; source_json: Record<string, unknown> }> = [];
  const pageSize = 2000;
  for (let offset = 0; offset < params.maxRows; offset += pageSize) {
    const { data, error } = await params.supabase
      .from('dataset_rows')
      .select('id,row_index,data,source_json')
      .eq('dataset_table_id', params.datasetTableId)
      .order('row_index', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as any[];
    out.push(
      ...chunk.map((r) => ({
        id: r.id,
        row_index: r.row_index,
        data: r.data ?? {},
        source_json: r.source_json ?? {},
      }))
    );
    if (chunk.length < pageSize) break;
  }
  return out;
}

// POST /api/analytics/ask - Analytics chat grounded in dataset rows via tool calls
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('run_ai');
    enforceRateLimit('ai', ctx.user.id);
    const supabase = ctx.supabase;
    const body = (await req.json()) as AnalyticsAskRequest;

    if (!body?.question?.trim()) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }
    if (!body?.dataset_table_id) {
      return NextResponse.json({ error: 'dataset_table_id is required' }, { status: 400 });
    }

    const maxRows = 20_000;
    const { data: table, error: tableError } = await supabase
      .from('dataset_tables')
      .select(
        `
        *,
        dataset:datasets!inner(*, asset:assets(*)),
        columns:dataset_columns(*)
      `
      )
      .eq('id', body.dataset_table_id)
      .eq('dataset.organization_id', ctx.org.id)
      .maybeSingle();
    if (tableError) throw tableError;
    if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 });

    const rows = await fetchRows({ supabase, datasetTableId: body.dataset_table_id, maxRows });

    const columns: Array<{ name: string; field: string; type: string; samples: string[] }> = (table.columns ?? []).map((c: any) => ({
      name: c.name,
      field: c.normalized_name,
      type: c.data_type,
      samples: (c.sample_values ?? []).slice(0, 5),
    }));

    const toolResults: Array<{ tool: string; input: Record<string, any>; output: Record<string, any> }> = [];

    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'table_query',
          description:
            'Query the selected dataset table using filters/grouping/aggregations. Use this for all computations; do not do math in your head.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              filters: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    field: { type: 'string' },
                    op: {
                      type: 'string',
                      enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'between', 'is_null', 'not_null'],
                    },
                    value: {},
                    values: { type: 'array', items: {} },
                    min: {},
                    max: {},
                  },
                  required: ['field', 'op'],
                },
              },
              group_by: { type: 'array', items: { type: 'string' } },
              metrics: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    op: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
                    field: { type: 'string' },
                    as: { type: 'string' },
                  },
                  required: ['op', 'as'],
                },
              },
              order_by: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    field: { type: 'string' },
                    direction: { type: 'string', enum: ['asc', 'desc'] },
                  },
                  required: ['field'],
                },
              },
              limit: { type: 'integer', minimum: 1, maximum: 500 },
              evidence_limit: { type: 'integer', minimum: 0, maximum: 50 },
            },
            required: ['metrics'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'compare_periods',
          description:
            'Compare one metric across two date ranges (e.g. this month vs last month). Returns both values, the delta, percent change, and row-level evidence.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              date_field: { type: 'string', description: 'Date column field name' },
              metric: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  op: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
                  field: { type: 'string' },
                  as: { type: 'string' },
                },
                required: ['op', 'as'],
              },
              period_a: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' },
                },
                required: ['from', 'to'],
              },
              period_b: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' },
                },
                required: ['from', 'to'],
              },
              filters: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    field: { type: 'string' },
                    op: {
                      type: 'string',
                      enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'between', 'is_null', 'not_null'],
                    },
                    value: {},
                    values: { type: 'array', items: {} },
                    min: {},
                    max: {},
                  },
                  required: ['field', 'op'],
                },
              },
            },
            required: ['date_field', 'metric', 'period_a', 'period_b'],
          },
        },
      },
    ];

    const system = [
      `You are a company analytics assistant. You MUST ground all numeric answers in the dataset using the tool.`,
      `If you cannot compute due to missing columns, unclear definitions, or missing date ranges, say so explicitly and ask a follow-up question.`,
      `Always prefer: define metric → state scope → show computed numbers → describe drivers/root-cause suggestions.`,
      `You have one selected table: "${table.name}" (id: ${table.id}). Rows available in-memory: ${rows.length} (may be truncated at ${maxRows}).`,
      `Columns (use the "field" names exactly in queries):`,
      ...columns.map((c) => `- ${c.field} (${c.type}) aka "${c.name}" samples: ${c.samples.join(' | ')}`),
    ].join('\n');

    const messages: any[] = [
      { role: 'system', content: system },
      { role: 'user', content: body.question },
    ];

    const executeTableQuery = (args: any) => {
      const spec: TableQuerySpec = {
        filters: args.filters,
        group_by: args.group_by,
        metrics: args.metrics,
        order_by: args.order_by,
        limit: args.limit,
        evidence_limit: args.evidence_limit,
      };
      const result = runTableQuery(rows, spec);
      return {
        query: spec,
        result,
        note: {
          table_id: table.id,
          table_name: table.name,
          max_rows_loaded: rows.length,
        },
      };
    };

    for (let round = 0; round < 4; round++) {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1200,
      });

      const msg = resp.choices[0]?.message;
      if (!msg) break;

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const answer = msg.content || '';
        await audit(ctx, 'ai.analytics_ask', { type: 'dataset_table', id: table.id }, {
          question: body.question.slice(0, 500),
          tool_calls: toolResults.length,
        });
        return NextResponse.json({ answer, tool_results: toolResults });
      }

      messages.push(msg);

      for (const call of msg.tool_calls) {
        if (call.type !== 'function') continue;
        let args: any = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }

        let output: Record<string, any>;
        if (call.function.name === 'table_query') {
          output = executeTableQuery(args);
        } else if (call.function.name === 'compare_periods') {
          output = comparePeriods(rows, args as ComparePeriodsSpec);
        } else {
          output = { error: `Unknown tool: ${call.function.name}` };
        }

        toolResults.push({ tool: call.function.name, input: args, output });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(output),
        });
      }
    }

    return NextResponse.json({
      answer:
        "I couldn't complete the analysis within the tool-call budget. Try asking a narrower question (e.g., specify date range, metric, and grouping).",
      tool_results: toolResults,
    });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: authErr.status });
    }
    console.error('Error in analytics ask:', err);
    const anyErr = err as any;
    if (anyErr?.code === 'PGRST205') {
      return NextResponse.json(
        {
          error:
            "Missing analytics tables in Supabase. Run the updated `supabase/schema.sql` (the 'DATASETS' section) in Supabase SQL Editor, then refresh the API schema.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'Failed to process analytics question' }, { status: 500 });
  }
}
