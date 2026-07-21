import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { getProvider, getToolRuntime } from '@/lib/ai/provider';
import { detectIntent, needsStructuredData, Intent } from '@/lib/ai/router';
import { buildContext, SYSTEM_INSTRUCTIONS } from '@/lib/ai/context-builder';
import { runTableQuery, comparePeriods, joinTables, DatasetRow } from '@/lib/analytics';
import { computeMetric, MetricDefinition } from '@/lib/metrics/compute';
import { compareMetricValues, MetricComparisonOperation } from '@/lib/metrics/compare';
import { forecastSeries } from '@/lib/forecasting/forecast';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * Numeric-provenance guard: flag answers containing sizeable numbers that
 * do not appear anywhere in the tool outputs they should derive from.
 */
function verifyNumericProvenance(answer: string, toolResults: ToolResult[]): string | null {
  if (toolResults.length === 0) return null;
  const toolText = JSON.stringify(toolResults.map((t) => t.output));
  const numbers = answer.match(/\d[\d,.]{2,}/g) ?? [];
  const unverified = numbers.filter((raw) => {
    const cleaned = raw.replace(/[.,]$/, '');
    const canonical = cleaned.replace(/,/g, '');
    if (toolText.includes(cleaned) || toolText.includes(canonical)) return false;
    // Rounded figures: check integer part
    const intPart = canonical.split('.')[0];
    if (intPart.length >= 3 && toolText.includes(intPart)) return false;
    // Years and dates are not computed figures
    if (/^(19|20)\d{2}$/.test(canonical)) return false;
    return true;
  });
  if (unverified.length === 0) return null;
  return `Provenance check: ${unverified.length} number(s) in this answer (${unverified.slice(0, 3).join(', ')}${unverified.length > 3 ? ', …' : ''}) could not be matched to a tool computation — verify before relying on them.`;
}

export const runtime = 'nodejs';
export const maxDuration = 120;

const VALID_INTENTS: Intent[] = ['definition', 'analysis', 'report', 'forecast', 'workflow', 'search'];
const MAX_ROWS_PER_TABLE = 20_000;

interface ToolResult {
  tool: string;
  input: Record<string, any>;
  output: Record<string, any>;
}

const QUERY_SPEC_PROPS = {
  filters: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        field: { type: 'string' },
        op: { type: 'string', enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'between', 'is_null', 'not_null'] },
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
};

// POST /api/ai/ask - Unified AI router: intent → context → grounded answer
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('run_ai');
    const body = await req.json();

    enforceRateLimit('ai', ctx.user.id);

    const question: string = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return NextResponse.json({ data: null, error: 'question is required' }, { status: 400 });
    }

    const scopeKeywordIds: string[] = Array.isArray(body.scope?.keyword_ids)
      ? body.scope.keyword_ids.filter((id: unknown) => typeof id === 'string')
      : [];
    const scopeTableId: string | null =
      typeof body.scope?.dataset_table_id === 'string' ? body.scope.dataset_table_id : null;
    const sessionId: string | null = typeof body.session_id === 'string' ? body.session_id : null;

    const provider = getProvider();

    // 1. Intent: explicit mode wins, else detect
    const intent: Intent = VALID_INTENTS.includes(body.mode)
      ? body.mode
      : await detectIntent(question, provider);

    // 2. Grounded context envelope
    const built = await buildContext(ctx, {
      question,
      intent,
      scopeKeywordIds,
      scopeTableId,
    });

    // 3. Conversation history
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (sessionId) {
      const { data: prior } = await ctx.supabase
        .from('chat_messages')
        .select('role, content, chat_sessions!inner(organization_id)')
        .eq('session_id', sessionId)
        .eq('chat_sessions.organization_id', ctx.org.id)
        .order('created_at', { ascending: false })
        .limit(6);
      history = ((prior ?? []) as any[])
        .reverse()
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
    }

    // 4. Answer generation
    const toolResults: ToolResult[] = [];
    let answer = '';

    const useDataTools =
      needsStructuredData(intent) && (built.datasetSchemas.length > 0 || built.metrics.length > 0);

    if (useDataTools) {
      // Tool loop: the LLM plans, our engine computes. Rows loaded per table on demand.
      // The fast model plans and explains deterministic tool results. The
      // expensive reasoning happens in our metric/query engine, not the LLM.
      const toolRuntime = getToolRuntime('fast');
      const rowCache = new Map<string, DatasetRow[]>();
      const validTableIds = new Set(built.datasetSchemas.map((s) => s.table_id));

      const loadRows = async (tableId: string): Promise<DatasetRow[]> => {
        if (rowCache.has(tableId)) return rowCache.get(tableId)!;
        const rows: DatasetRow[] = [];
        const pageSize = 2000;
        for (let offset = 0; offset < MAX_ROWS_PER_TABLE; offset += pageSize) {
          const { data, error } = await ctx.supabase
            .from('dataset_rows')
            .select('id, row_index, data, source_json')
            .eq('dataset_table_id', tableId)
            .order('row_index')
            .range(offset, offset + pageSize - 1);
          if (error) throw error;
          rows.push(...((data ?? []) as DatasetRow[]));
          if ((data ?? []).length < pageSize) break;
        }
        rowCache.set(tableId, rows);
        return rows;
      };

      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'query_table',
            description:
              'Query one dataset table with filters/grouping/aggregations. Use for ALL computations — never do math yourself. table_id must be one listed in the context.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: { table_id: { type: 'string' }, ...QUERY_SPEC_PROPS },
              required: ['table_id', 'metrics'],
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'compare_metrics',
            description:
              'Perform arithmetic between two registered metrics after computing both from their source rows. REQUIRED for variance, difference, percentage difference, or ratio between metrics. Never calculate these in prose. metric_a minus metric_b; percent_difference uses metric_b as the baseline.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                metric_a_id: { type: 'string' },
                metric_b_id: { type: 'string' },
                operations: {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'string', enum: ['difference', 'percent_difference', 'ratio'] },
                },
              },
              required: ['metric_a_id', 'metric_b_id', 'operations'],
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'compare_periods',
            description: 'Compare one metric across two date ranges in a table. Returns values, delta, percent change, and evidence rows.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                table_id: { type: 'string' },
                date_field: { type: 'string' },
                metric: (QUERY_SPEC_PROPS.metrics as any).items,
                period_a: {
                  type: 'object', additionalProperties: false,
                  properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
                  required: ['from', 'to'],
                },
                period_b: {
                  type: 'object', additionalProperties: false,
                  properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
                  required: ['from', 'to'],
                },
                filters: QUERY_SPEC_PROPS.filters,
              },
              required: ['table_id', 'date_field', 'metric', 'period_a', 'period_b'],
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'join_query',
            description:
              'Cross-table analysis: join TWO tables on a key, then filter/group/aggregate the joined rows. Right-table columns are referenced with the prefix "r_". Use for math spanning tables (sold margin = item_sales ⋈ menu_economics on item_code) and for per-person experience/skill matrices (task log grouped by person × subtask) e.g. as ground truth for shift planning. Never estimate — compute.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                left_table_id: { type: 'string' },
                right_table_id: { type: 'string' },
                left_key: { type: 'string', description: 'join field in the left table' },
                right_key: { type: 'string', description: 'join field in the right table' },
                join_type: { type: 'string', enum: ['inner', 'left'] },
                ...QUERY_SPEC_PROPS,
              },
              required: ['left_table_id', 'right_table_id', 'left_key', 'right_key', 'metrics'],
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'compute_metric',
            description:
              'Compute a metric from the metric catalog by its id. The catalog definition decides table, column, filters, and aggregation — prefer this over query_table when a catalog metric matches the question. mode "series" returns a time series with anomaly flags.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                metric_id: { type: 'string' },
                mode: { type: 'string', enum: ['value', 'series'] },
                period: {
                  type: 'object', additionalProperties: false,
                  properties: { from: { type: 'string' }, to: { type: 'string' } },
                  required: ['from', 'to'],
                },
              },
              required: ['metric_id'],
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'forecast_metric',
            description:
              'Forecast a catalog metric N periods ahead. Refuses when history is too short. Returns projections with 95% intervals and explicit assumptions — always present these as projections, separate from facts.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                metric_id: { type: 'string' },
                horizon: { type: 'integer', minimum: 1, maximum: 12 },
              },
              required: ['metric_id'],
            },
          },
        },
      ];

      const messages: any[] = [
        { role: 'system', content: SYSTEM_INSTRUCTIONS },
        { role: 'system', content: `# Grounded company context\n\n${built.contextText}` },
        ...history,
        { role: 'user', content: question },
      ];

      for (let round = 0; round < 3; round++) {
        const response = await toolRuntime.client.chat.completions.create({
          model: toolRuntime.model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.2,
          max_tokens: 1600,
        });
        const msg = response.choices[0]?.message;
        if (!msg) break;

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          answer = msg.content ?? '';
          break;
        }
        messages.push(msg);

        for (const call of msg.tool_calls) {
          if (call.type !== 'function') continue;
          let args: any = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch { /* keep empty args */ }

          let output: Record<string, any>;
          try {
            if (call.function.name === 'compare_metrics') {
              const ids = [args.metric_a_id, args.metric_b_id].filter((id) => typeof id === 'string');
              const { data: metricRows } = await ctx.supabase
                .from('metrics')
                .select('*')
                .eq('organization_id', ctx.org.id)
                .in('id', ids);
              const metricById = new Map((metricRows ?? []).map((metric: any) => [metric.id, metric]));
              const metricA = metricById.get(args.metric_a_id) as MetricDefinition | undefined;
              const metricB = metricById.get(args.metric_b_id) as MetricDefinition | undefined;
              if (!metricA || !metricB) {
                output = { error: 'Unknown metric id — use ids from the Metric Catalog in context.' };
              } else {
                const [computedA, computedB] = await Promise.all([
                  computeMetric(ctx.supabase, ctx.org.id, metricA),
                  computeMetric(ctx.supabase, ctx.org.id, metricB),
                ]);
                const allowed = new Set<MetricComparisonOperation>(['difference', 'percent_difference', 'ratio']);
                const operations = (Array.isArray(args.operations) ? args.operations : [])
                  .filter((operation: unknown): operation is MetricComparisonOperation => allowed.has(operation as MetricComparisonOperation));
                output = {
                  metric_a: { id: metricA.id, name: metricA.name, value: computedA.value, evidence_row_ids: computedA.evidence_row_ids },
                  metric_b: { id: metricB.id, name: metricB.name, value: computedB.value, evidence_row_ids: computedB.evidence_row_ids },
                  formula: 'difference = metric_a - metric_b; percent_difference = (metric_a - metric_b) / abs(metric_b) * 100; ratio = metric_a / metric_b',
                  ...compareMetricValues(computedA.value, computedB.value, operations.length ? operations : ['difference']),
                };
              }
            } else if (call.function.name === 'compute_metric' || call.function.name === 'forecast_metric') {
              const { data: metricRow } = await ctx.supabase
                .from('metrics')
                .select('*')
                .eq('id', args.metric_id)
                .eq('organization_id', ctx.org.id)
                .maybeSingle();
              if (!metricRow) {
                output = { error: 'Unknown metric_id — use ids from the Metric Catalog in context.' };
              } else if (call.function.name === 'compute_metric') {
                output = await computeMetric(ctx.supabase, ctx.org.id, metricRow as MetricDefinition, {
                  mode: args.mode === 'series' ? 'series' : 'value',
                  period: args.period?.from && args.period?.to ? args.period : undefined,
                });
              } else {
                const computation = await computeMetric(ctx.supabase, ctx.org.id, metricRow as MetricDefinition, {
                  mode: 'series',
                });
                const history = computation.series
                  .filter((p) => p.value != null)
                  .map((p) => ({ period: p.period, value: p.value as number }));
                output = {
                  metric: metricRow.name,
                  ...forecastSeries(history, Math.max(1, Math.min(args.horizon ?? 3, 12))),
                  history_used: history,
                };
              }
            } else if (call.function.name === 'join_query') {
              if (!validTableIds.has(args.left_table_id) || !validTableIds.has(args.right_table_id)) {
                output = { error: `Unknown table id. Use ids from: ${Array.from(validTableIds).join(', ')}` };
              } else {
                const [leftRows, rightRows] = await Promise.all([
                  loadRows(args.left_table_id),
                  loadRows(args.right_table_id),
                ]);
                const joined = joinTables(leftRows, rightRows, {
                  left_key: args.left_key,
                  right_key: args.right_key,
                  join_type: args.join_type === 'left' ? 'left' : 'inner',
                });
                output = {
                  join_stats: joined.stats,
                  result: runTableQuery(joined.rows, args),
                  note: 'right-table columns are prefixed with r_',
                };
              }
            } else if (!validTableIds.has(args.table_id)) {
              output = { error: `Unknown table_id. Use one of: ${Array.from(validTableIds).join(', ')}` };
            } else if (call.function.name === 'query_table') {
              const rows = await loadRows(args.table_id);
              output = { result: runTableQuery(rows, args), rows_loaded: rows.length };
            } else if (call.function.name === 'compare_periods') {
              const rows = await loadRows(args.table_id);
              output = comparePeriods(rows, args);
            } else {
              output = { error: `Unknown tool ${call.function.name}` };
            }
          } catch (toolError: any) {
            output = { error: toolError?.message ?? 'tool failed' };
          }

          toolResults.push({ tool: call.function.name, input: args, output });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
        }
      }

      if (!answer) {
        answer =
          'I could not complete the analysis within the tool budget. Try narrowing the question (specific metric, table, and date range).';
      }

      const provenanceWarning = verifyNumericProvenance(answer, toolResults);
      if (provenanceWarning) {
        built.envelope.missing_data.push(provenanceWarning);
      }
    } else {
      // Definitional / search / workflow answers: grounded synthesis, no invented numbers
      if (needsStructuredData(intent) && built.datasetSchemas.length === 0) {
        built.envelope.missing_data.push(
          'No structured datasets are connected — numeric answers are not possible until data is imported.'
        );
      }
      answer = await provider.chat(
        [
          { role: 'system', content: SYSTEM_INSTRUCTIONS },
          { role: 'system', content: `# Grounded company context\n\n${built.contextText}` },
          ...history,
          { role: 'user', content: question },
        ],
        { tier: 'strong', temperature: 0.3, maxTokens: 1600 }
      );
    }

    // 5. Sources (asset names for cited chunks)
    const assetIds = Array.from(new Set(built.chunks.map((c) => c.asset_id).filter(Boolean))) as string[];
    const assetNames = new Map<string, string>();
    if (assetIds.length > 0) {
      const { data: assets } = await ctx.supabase
        .from('assets')
        .select('id, file_name')
        .eq('organization_id', ctx.org.id)
        .in('id', assetIds);
      for (const a of assets ?? []) assetNames.set(a.id, a.file_name);
    }

    const sources = {
      keywords: [...built.envelope.relevant_keywords, ...built.envelope.dependency_keywords],
      business_objects: built.businessObjects.map((object) => ({
        id: object.id,
        type: object.object_type,
        name: object.display_name,
        fact_count: object.facts.length,
      })),
      documents: built.chunks.map((c) => ({
        chunk_id: c.id,
        asset_id: c.asset_id,
        file_name: c.asset_id ? assetNames.get(c.asset_id) ?? null : null,
        similarity: Math.round(c.similarity * 100) / 100,
      })),
      tables: built.datasetSchemas
        .filter((s) => toolResults.some((t) => t.input.table_id === s.table_id))
        .map((s) => ({ table_id: s.table_id, name: s.table_name, dataset: s.dataset_title })),
    };

    // 6. Persist conversation + context log
    let persistedSessionId = sessionId;
    try {
      if (!persistedSessionId) {
        const { data: session } = await ctx.supabase
          .from('chat_sessions')
          .insert({
            organization_id: ctx.org.id,
            title: question.slice(0, 120),
            context_keywords: scopeKeywordIds,
            created_by: ctx.user.id,
          })
          .select('id')
          .single();
        persistedSessionId = session?.id ?? null;
      }
      if (persistedSessionId) {
        await ctx.supabase.from('chat_messages').insert([
          { session_id: persistedSessionId, role: 'user', content: question, sources_json: [] },
          {
            session_id: persistedSessionId,
            role: 'assistant',
            content: answer,
            sources_json: sources as any,
          },
        ]);
        await ctx.supabase.from('ai_context_logs').insert({
          organization_id: ctx.org.id,
          session_id: persistedSessionId,
          user_id: ctx.user.id,
          question,
          intent,
          context: {
            envelope: built.envelope,
            tool_results: toolResults.map((t) => ({ tool: t.tool, input: t.input })),
            provider: provider.name,
          },
        });
      }
    } catch (persistError) {
      console.error('Failed to persist conversation:', persistError);
    }

    await audit(ctx, 'ai.ask', { type: 'ai_question' }, {
      question: question.slice(0, 500),
      intent,
      tool_calls: toolResults.length,
      keywords_used: sources.keywords.length,
    });

    return NextResponse.json({
      data: {
        answer,
        intent,
        session_id: persistedSessionId,
        sources,
        calculations: toolResults,
        missing_data: built.envelope.missing_data,
        context_quality: built.contextQuality,
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to answer question');
  }
}
