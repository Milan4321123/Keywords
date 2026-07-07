import { OrgContext, accessibleLevels } from '@/lib/auth';
import { createEmbedding } from '@/lib/openai';
import { extractPotentialKeywords, rankChunks } from '@/lib/ai-context';
import { getDependencyContext, DependencyContext } from '@/lib/ontology/graph';
import { Intent, traversalIntentFor } from './router';
import { Keyword } from '@/types';

export interface DatasetTableSchema {
  table_id: string;
  dataset_title: string;
  table_name: string;
  row_count: number;
  keyword_id: string | null;
  columns: Array<{ field: string; name: string; type: string; semantic: string | null; samples: string[] }>;
}

export interface ChunkResult {
  id: string;
  asset_id: string | null;
  chunk_index: number;
  chunk_text: string;
  similarity: number;
}

/** The grounded context envelope (docs/05-ai-system.md), persisted to ai_context_logs. */
export interface MetricContext {
  id: string;
  name: string;
  description: string | null;
  formula: string | null;
  aggregation: string | null;
  source_table_id: string | null;
  value_column: string | null;
  date_column: string | null;
  time_grain: string;
  caveats: string | null;
  keyword_id: string | null;
}

export interface WorkflowTaskContext {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  keyword_id: string | null;
  blocked_by: string[];
}

export interface ContextEnvelope {
  organization: { id: string; name: string };
  user: { id: string; email: string };
  question: string;
  intent: Intent;
  selected_keyword: { id: string; title: string } | null;
  relevant_keywords: Array<{ id: string; title: string; relevance: number; via: string }>;
  dependency_keywords: Array<{ id: string; title: string; relevance: number; via: string }>;
  business_rules: Array<{ keyword: string; rule: string }>;
  metric_definitions: MetricContext[];
  dataset_schemas: DatasetTableSchema[];
  workflow_context: WorkflowTaskContext[];
  chunks_used: Array<{ id: string; asset_id: string | null; similarity: number }>;
  missing_data: string[];
  system_instructions: string;
}

export interface BuiltContext {
  envelope: ContextEnvelope;
  keywords: Keyword[];
  dependency: DependencyContext;
  chunks: ChunkResult[];
  datasetSchemas: DatasetTableSchema[];
  metrics: MetricContext[];
  contextText: string;
}

export const SYSTEM_INSTRUCTIONS = `You are a company organizational intelligence AI.
You answer ONLY from: keyword definitions, keyword relations, company documents, structured dataset results, metric definitions, workflow data, and user-approved business rules provided in context.
You must not invent company facts. When data is missing, say exactly what is missing.
All numbers must come from tool computations included in context — never calculate or estimate figures yourself.
Structure every answer with these sections where applicable: Answer, Data used, Keywords used, Calculations performed, Missing data, Recommended next action.
Provide concise reasoning summaries only.`;

const CONTEXT_BUDGET = {
  maxKeywords: 14,
  maxChunks: 8,
  maxChunkChars: 1200,
  maxFieldChars: 600,
};

function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Assemble the grounded context for one question:
 * keyword match → intent-filtered graph expansion → business rules
 * → dataset schemas (keyword-linked first) → document chunks.
 */
export async function buildContext(
  ctx: OrgContext,
  params: {
    question: string;
    intent: Intent;
    scopeKeywordIds?: string[];
    scopeTableId?: string | null;
  }
): Promise<BuiltContext> {
  const { question, intent } = params;
  const supabase = ctx.supabase;
  const missing: string[] = [];

  // 1. Keyword routing: explicit scope + exact/synonym matches.
  // Access-level filter ensures a Worker's AI answer never draws on
  // manager/admin-only keywords they cannot see.
  const { data: allKeywords } = await supabase
    .from('keywords')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .in('access_level', accessibleLevels(ctx.role))
    .neq('status', 'archived');

  const mentioned = extractPotentialKeywords(question, allKeywords ?? []);
  const seedIds = Array.from(
    new Set([...(params.scopeKeywordIds ?? []), ...mentioned.map((k) => k.id)])
  );

  // 2. Intent-filtered graph expansion
  const dependency = await getDependencyContext(supabase, ctx.org.id, seedIds, {
    maxDepth: 2,
    maxNodes: CONTEXT_BUDGET.maxKeywords,
    intent: traversalIntentFor(intent),
    accessLevels: accessibleLevels(ctx.role),
  });

  let keywords = dependency.nodes.map((n) => n.keyword);
  if (keywords.length === 0) {
    keywords = (allKeywords ?? []).filter((k) => !k.parent_id).slice(0, 8);
    if (seedIds.length === 0) {
      missing.push('No keywords matched the question; using top-level ontology as weak context.');
    }
  }
  const keywordIds = keywords.map((k) => k.id);

  // 3. Dataset schemas: explicit table, else datasets linked to routed keywords, else all
  let tableQuery = supabase
    .from('dataset_tables')
    .select('id, name, row_count, dataset:datasets!inner(id, title, keyword_id, organization_id), columns:dataset_columns(*)')
    .eq('dataset.organization_id', ctx.org.id)
    .limit(10);
  if (params.scopeTableId) {
    tableQuery = tableQuery.eq('id', params.scopeTableId);
  }
  const { data: tables } = await tableQuery;

  const schemas: DatasetTableSchema[] = (tables ?? []).map((t: any) => ({
    table_id: t.id,
    dataset_title: t.dataset?.title ?? '',
    table_name: t.name,
    row_count: t.row_count,
    keyword_id: t.dataset?.keyword_id ?? null,
    columns: (t.columns ?? []).map((c: any) => ({
      field: c.normalized_name,
      name: c.name,
      type: c.data_type,
      semantic: c.semantic_name ?? null,
      samples: (c.sample_values ?? []).slice(0, 3),
    })),
  }));
  // Keyword-linked tables rank first so the planner picks them
  schemas.sort((a, b) => {
    const aLinked = a.keyword_id && keywordIds.includes(a.keyword_id) ? 0 : 1;
    const bLinked = b.keyword_id && keywordIds.includes(b.keyword_id) ? 0 : 1;
    return aLinked - bLinked;
  });

  // 3b. Metric definitions: metrics linked to routed keywords first, then the rest
  const { data: metricRows } = await supabase
    .from('metrics')
    .select('id, name, description, formula, aggregation, source_table_id, value_column, date_column, time_grain, caveats, keyword_id')
    .eq('organization_id', ctx.org.id)
    .limit(30);
  const metrics: MetricContext[] = ((metricRows ?? []) as MetricContext[]).sort((a, b) => {
    const aLinked = a.keyword_id && keywordIds.includes(a.keyword_id) ? 0 : 1;
    const bLinked = b.keyword_id && keywordIds.includes(b.keyword_id) ? 0 : 1;
    return aLinked - bLinked;
  });

  // 3c. Workflow context: open tasks around the routed keywords
  let workflowContext: WorkflowTaskContext[] = [];
  if (intent === 'workflow' || intent === 'report') {
    let taskQuery = supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, keyword_id, task_dependencies!task_dependencies_task_id_fkey(depends_on_task_id)')
      .eq('organization_id', ctx.org.id)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .order('created_at', { ascending: false })
      .limit(30);
    if (keywordIds.length > 0) taskQuery = taskQuery.in('keyword_id', keywordIds);
    const { data: taskRows } = await taskQuery;
    workflowContext = ((taskRows ?? []) as any[]).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      keyword_id: t.keyword_id,
      blocked_by: (t.task_dependencies ?? []).map((d: any) => d.depends_on_task_id),
    }));
  }

  // 4. Document chunks (hybrid retrieval scoped to the dependency neighbourhood)
  let chunks: ChunkResult[] = [];
  try {
    const embedding = await createEmbedding(question);
    const { data } = await supabase.rpc('match_chunks_hybrid', {
      query_text: question,
      query_embedding: embedding,
      match_threshold: 0.62,
      match_count: 20,
      filter_keyword_ids: keywordIds.length > 0 ? keywordIds : null,
      filter_org_id: ctx.org.id,
      weight_vector: 0.7,
      weight_text: 0.3,
    });
    chunks = rankChunks((data ?? []) as any[], {
      minSimilarity: 0.55,
      maxChunks: CONTEXT_BUDGET.maxChunks,
    }) as unknown as ChunkResult[];
  } catch (error) {
    console.error('Chunk retrieval failed:', error);
    missing.push('Document retrieval unavailable for this question.');
  }

  // 5. Business rules from routed keywords
  const businessRules = keywords.flatMap((k) =>
    (k.rules ?? []).filter(Boolean).map((rule) => ({ keyword: k.title, rule }))
  );

  const relevanceByid = new Map(dependency.nodes.map((n) => [n.keyword.id, n]));

  const envelope: ContextEnvelope = {
    organization: { id: ctx.org.id, name: ctx.org.name },
    user: { id: ctx.user.id, email: ctx.user.email },
    question,
    intent,
    selected_keyword:
      params.scopeKeywordIds?.length === 1
        ? {
            id: params.scopeKeywordIds[0],
            title: keywords.find((k) => k.id === params.scopeKeywordIds![0])?.title ?? '',
          }
        : null,
    relevant_keywords: dependency.nodes
      .filter((n) => n.via === 'seed')
      .map((n) => ({ id: n.keyword.id, title: n.keyword.title, relevance: n.relevance, via: n.via })),
    dependency_keywords: dependency.nodes
      .filter((n) => n.via !== 'seed')
      .map((n) => ({ id: n.keyword.id, title: n.keyword.title, relevance: n.relevance, via: n.via })),
    business_rules: businessRules,
    metric_definitions: metrics,
    dataset_schemas: schemas,
    workflow_context: workflowContext,
    chunks_used: chunks.map((c) => ({ id: c.id, asset_id: c.asset_id, similarity: c.similarity })),
    missing_data: missing,
    system_instructions: 'Answer only from grounded company context and computed data.',
  };

  // 6. Render context text (priority: definitions → rules → relations → schemas → documents)
  const parts: string[] = [];
  if (keywords.length > 0) {
    parts.push('## Company Ontology');
    for (const k of keywords.slice(0, CONTEXT_BUDGET.maxKeywords)) {
      const node = relevanceByid.get(k.id);
      parts.push(`### ${k.title}${node && node.via !== 'seed' ? ` (dependency via ${node.via})` : ''}`);
      if (k.definition) parts.push(`Definition: ${truncate(k.definition, CONTEXT_BUDGET.maxFieldChars)}`);
      if (k.explanation) parts.push(`Explanation: ${truncate(k.explanation, CONTEXT_BUDGET.maxFieldChars)}`);
      if (k.examples?.length) parts.push(`Examples: ${truncate(k.examples.join('; '), 300)}`);
    }
  }
  if (businessRules.length > 0) {
    parts.push('\n## Business Rules');
    for (const r of businessRules.slice(0, 20)) parts.push(`- [${r.keyword}] ${r.rule}`);
  }
  if (dependency.edges.length > 0) {
    parts.push('\n## Relations');
    for (const e of dependency.edges.slice(0, 30)) {
      parts.push(`- ${e.from_keyword?.title} ${e.relation_type} ${e.to_keyword?.title}${e.note ? ` (${e.note})` : ''}`);
    }
  }
  if (metrics.length > 0) {
    parts.push('\n## Metric Catalog (compute these with the compute_metric tool — never estimate)');
    for (const m of metrics.slice(0, 15)) {
      parts.push(
        `- "${m.name}" (id ${m.id}): ${m.aggregation ?? 'sum'}(${m.value_column ?? 'rows'})` +
          `${m.date_column ? ` by ${m.time_grain} on ${m.date_column}` : ''}` +
          `${m.formula ? ` — formula: ${m.formula}` : ''}` +
          `${m.caveats ? ` — caveats: ${m.caveats}` : ''}`
      );
    }
  }
  if (workflowContext.length > 0) {
    parts.push('\n## Open Tasks');
    for (const t of workflowContext) {
      parts.push(
        `- [${t.status}] ${t.title} (priority ${t.priority}${t.due_date ? `, due ${t.due_date}` : ''}${t.blocked_by.length > 0 ? `, blocked by ${t.blocked_by.length} task(s)` : ''})`
      );
    }
  }
  if (schemas.length > 0) {
    parts.push('\n## Available Structured Data');
    for (const s of schemas) {
      parts.push(
        `- Table "${s.table_name}" (id ${s.table_id}) from dataset "${s.dataset_title}", ${s.row_count} rows. Columns: ${s.columns
          .map((c) => `${c.field}:${c.type}${c.semantic ? `[${c.semantic}]` : ''}`)
          .join(', ')}`
      );
    }
  }
  if (chunks.length > 0) {
    parts.push('\n## Company Documents (evidence)');
    for (const c of chunks) {
      parts.push(`[chunk ${c.id.slice(0, 8)} · relevance ${Math.round(c.similarity * 100)}%]`);
      parts.push(truncate(c.chunk_text, CONTEXT_BUDGET.maxChunkChars));
    }
  }

  return {
    envelope,
    keywords,
    dependency,
    chunks,
    datasetSchemas: schemas,
    metrics,
    contextText: parts.join('\n'),
  };
}
