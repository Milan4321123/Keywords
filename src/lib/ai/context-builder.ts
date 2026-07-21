import { OrgContext, accessibleLevels } from '@/lib/auth';
import { createEmbedding } from '@/lib/openai';
import { extractPotentialKeywords, rankChunks } from '@/lib/ai-context';
import { getDependencyContext, DependencyContext } from '@/lib/ontology/graph';
import { Intent, traversalIntentFor } from './router';
import { readCachedWorldModel, readGuidance } from './skills';
import { Keyword } from '@/types';
import { computeContextQuality, ContextQuality } from './context-quality';

export interface DatasetTableSchema {
  table_id: string;
  dataset_id: string;
  dataset_title: string;
  table_name: string;
  row_count: number;
  keyword_id: string | null;
  latest_recorded_at: string | null;
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
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  keyword_id: string | null;
  keyword: string | null;
  assignee: string | null;
  blocked_by: string[];
}

export interface BusinessObjectFactContext {
  key: string;
  value: unknown;
  data_type: string;
  unit: string | null;
  truth_status: string;
  source_type: string;
  valid_from: string;
  source_reference: string | null;
  derivation: string | null;
}

export interface BusinessObjectContext {
  id: string;
  object_type: string;
  external_key: string | null;
  display_name: string;
  status: string;
  canonical_keyword_id: string | null;
  facts: BusinessObjectFactContext[];
  conflicts: Array<{ key: string; values: unknown[]; truth_statuses: string[] }>;
}

export interface OperationalRecordContext {
  source_row_id: string;
  table_id: string;
  table_name: string;
  record_type: string;
  title: string;
  status: string | null;
  owner: string | null;
  due_date: string | null;
  next_action: string | null;
  evidence_reference: string | null;
  summary: string | null;
  recorded_at: string;
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
  business_objects: BusinessObjectContext[];
  operational_context: OperationalRecordContext[];
  context_quality: ContextQuality;
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
  businessObjects: BusinessObjectContext[];
  operationalRecords: OperationalRecordContext[];
  contextQuality: ContextQuality;
  contextText: string;
}

export const SYSTEM_INSTRUCTIONS = `You are the company's grounded AI project manager and organizational intelligence assistant.
You answer ONLY from: business objects and their sourced current facts, keyword definitions, keyword relations, company documents, structured dataset results, metric definitions, workflow data, and user-approved business rules provided in context.
You must not invent company facts. When data is missing, say exactly what is missing.
Treat approved/verified facts as source facts, derived facts as calculations, asserted facts as unverified input, and disputed facts as unusable. Always preserve that distinction in the answer.
All numbers must come from tool computations included in context — never calculate or estimate figures yourself. When comparing two metrics, use the compare_metrics tool for every difference, percentage, variance, or ratio.
For project questions, connect scope, deliverables, milestones, owners, deadlines, dependencies, budget, risks, decisions, and evidence. Separate verified facts from risks and recommendations. Identify blockers and the next responsible action.
Structure every answer with these sections where applicable: Answer, Data used, Keywords used, Calculations performed, Missing data, Recommended next action.
Provide concise reasoning summaries only.`;

const CONTEXT_BUDGET = {
  maxKeywords: 10,
  maxChunks: 4,
  maxChunkChars: 700,
  maxFieldChars: 320,
};

const CONTEXT_SECTION_LIMITS: Array<{ match: RegExp; limit: number }> = [
  { match: /Grounding Manifest/i, limit: 900 },
  { match: /Available Structured Data/i, limit: 1600 },
  { match: /Metric Catalog/i, limit: 1900 },
  { match: /Business Objects/i, limit: 1300 },
  { match: /Current Operational Records/i, limit: 2700 },
  { match: /Open Tasks/i, limit: 1400 },
  { match: /Business Rules/i, limit: 1000 },
  { match: /Company Ontology/i, limit: 1900 },
  { match: /Relations/i, limit: 700 },
  { match: /Company Documents/i, limit: 1500 },
  { match: /World Model/i, limit: 700 },
];

/** Keep the free Groq tier below its 8k TPM request ceiling, including tool
 * schemas and output tokens. Sections are reordered by operational value and
 * capped independently so a long ontology can never push out table schemas. */
export function compactContextSections(parts: string[], maxChars = 15_000): string {
  const raw = parts.join('\n').trim();
  const sections = raw.split(/\n(?=## )/g).filter(Boolean);
  const ranked = sections.map((section, originalIndex) => {
    const configuredIndex = CONTEXT_SECTION_LIMITS.findIndex((item) => item.match.test(section.slice(0, 120)));
    return {
      section,
      originalIndex,
      rank: configuredIndex >= 0 ? configuredIndex : CONTEXT_SECTION_LIMITS.length + originalIndex,
      limit: configuredIndex >= 0 ? CONTEXT_SECTION_LIMITS[configuredIndex].limit : 600,
    };
  }).sort((a, b) => a.rank - b.rank || a.originalIndex - b.originalIndex);
  const selected: string[] = [];
  let used = 0;
  for (const item of ranked) {
    if (used >= maxChars) break;
    const allowance = Math.min(item.limit, maxChars - used);
    if (allowance < 80) break;
    const section = truncate(item.section, allowance);
    selected.push(section);
    used += section.length + 2;
  }
  return selected.join('\n\n');
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase().normalize('NFKD');
}

function mentionedBusinessObject(question: string, object: { display_name?: string; external_key?: string | null }): boolean {
  const haystack = normalized(question);
  const name = normalized(object.display_name);
  const externalKey = normalized(object.external_key);
  if (externalKey && haystack.includes(externalKey)) return true;
  if (name && haystack.includes(name)) return true;
  const significant = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4);
  return significant.length > 0 && significant.every((word) => haystack.includes(word));
}

function firstRecordValue(data: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = data[field];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function operationalPriority(record: OperationalRecordContext): number {
  const status = normalized(record.status);
  let score = ['blocked', 'open', 'pending', 'concerned', 'high'].includes(status) ? 100 : 20;
  if (record.next_action) score += 10;
  if (record.due_date) score += 10;
  if (record.evidence_reference) score += 5;
  return score;
}

function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

const LEXICAL_STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'with', 'from', 'that', 'this', 'have', 'does', 'about',
  'was', 'wie', 'wer', 'was', 'wann', 'welche', 'welcher', 'wird', 'sind', 'haben', 'über',
  'und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'unser',
]);

function lexicalTerms(question: string): string[] {
  return Array.from(new Set(
    question
      .toLocaleLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !LEXICAL_STOP_WORDS.has(term))
  )).slice(0, 10);
}

async function loadLexicalChunks(
  supabase: OrgContext['supabase'],
  organizationId: string,
  keywordIds: string[],
  question: string
): Promise<ChunkResult[]> {
  let query = supabase
    .from('chunks')
    .select('id,asset_id,chunk_index,chunk_text')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(120);
  if (keywordIds.length > 0) query = query.in('keyword_id', keywordIds);
  const { data, error } = await query;
  if (error) throw error;
  const terms = lexicalTerms(question);
  if (terms.length === 0) return [];
  return ((data ?? []) as any[])
    .map((chunk) => {
      const haystack = String(chunk.chunk_text ?? '').toLocaleLowerCase();
      const matches = terms.filter((term) => haystack.includes(term)).length;
      return {
        ...chunk,
        similarity: matches === 0 ? 0 : Math.min(0.95, 0.45 + matches / Math.max(terms.length, 3)),
      } as ChunkResult;
    })
    .filter((chunk) => chunk.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, CONTEXT_BUDGET.maxChunks);
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
  let mentionedObjectRows: any[] = [];
  try {
    const { data, error } = await supabase
      .from('business_objects')
      .select('id,display_name,external_key,canonical_keyword_id')
      .eq('organization_id', ctx.org.id)
      .neq('status', 'archived')
      .limit(250);
    if (error) throw error;
    mentionedObjectRows = (data ?? []).filter((object: any) => mentionedBusinessObject(question, object));
  } catch (error: any) {
    if (!['PGRST205', '42P01'].includes(String(error?.code ?? ''))) {
      console.error('Business object routing unavailable:', error);
    }
  }
  const seedIds = Array.from(new Set([
    ...(params.scopeKeywordIds ?? []),
    ...mentioned.map((k) => k.id),
    ...mentionedObjectRows.map((object) => object.canonical_keyword_id).filter(Boolean),
  ]));

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

  // 2b. Stable business identities and their current sourced facts. This is
  // optional during migration rollout; older databases continue to work.
  let businessObjects: BusinessObjectContext[] = [];
  try {
    const linkedObjectIds = new Set<string>();
    if (keywordIds.length > 0) {
      const { data: objectLinks, error: linkError } = await supabase
        .from('business_object_links')
        .select('object_id')
        .eq('organization_id', ctx.org.id)
        .in('keyword_id', keywordIds)
        .limit(100);
      if (linkError) throw linkError;
      for (const link of objectLinks ?? []) linkedObjectIds.add(link.object_id);
    }
    let objectQuery = supabase
      .from('business_objects')
      .select('id,object_type,external_key,display_name,status,canonical_keyword_id')
      .eq('organization_id', ctx.org.id)
      .limit(30);
    for (const object of mentionedObjectRows) linkedObjectIds.add(object.id);
    const objectScopeIds = Array.from(linkedObjectIds);
    if (objectScopeIds.length > 0) objectQuery = objectQuery.in('id', objectScopeIds);
    else if (keywordIds.length > 0) objectQuery = objectQuery.in('canonical_keyword_id', keywordIds);
    const { data: objectRows, error: objectError } = await objectQuery;
    if (objectError) throw objectError;
    const objects = objectRows ?? [];
    const ids = objects.map((object: any) => object.id);
    let factRows: any[] = [];
    let activeFactRows: any[] = [];
    if (ids.length > 0) {
      const [currentResult, activeResult] = await Promise.all([
        supabase
          .from('current_business_facts')
          .select('object_id,fact_key,value,data_type,unit,truth_status,source_type,valid_from,source_asset_id,source_table_id,source_row_id,source_metric_id,derivation')
          .eq('organization_id', ctx.org.id)
          .in('object_id', ids)
          .limit(200),
        supabase
          .from('business_facts')
          .select('object_id,fact_key,value,truth_status')
          .eq('organization_id', ctx.org.id)
          .in('object_id', ids)
          .is('valid_to', null)
          .neq('truth_status', 'disputed')
          .limit(400),
      ]);
      if (currentResult.error) throw currentResult.error;
      if (activeResult.error) throw activeResult.error;
      factRows = currentResult.data ?? [];
      activeFactRows = activeResult.data ?? [];
    }
    businessObjects = objects.map((object: any) => {
      const activeGroups = new Map<string, any[]>();
      for (const fact of activeFactRows.filter((row) => row.object_id === object.id)) {
        const current = activeGroups.get(fact.fact_key) ?? [];
        current.push(fact);
        activeGroups.set(fact.fact_key, current);
      }
      const conflicts = Array.from(activeGroups.entries()).map(([key, rows]) => ({
        key,
        values: Array.from(new Map(rows.map((row: any) => [JSON.stringify(row.value), row.value])).values()),
        truth_statuses: Array.from(new Set(rows.map((row: any) => String(row.truth_status)))),
      })).filter((conflict) => conflict.values.length > 1);
      return {
        ...object,
        facts: factRows.filter((fact) => fact.object_id === object.id).map((fact) => ({
        key: fact.fact_key,
        value: fact.value,
        data_type: fact.data_type,
        unit: fact.unit,
        truth_status: fact.truth_status,
        source_type: fact.source_type,
        valid_from: fact.valid_from,
        source_reference: fact.source_metric_id ?? fact.source_row_id ?? fact.source_table_id ?? fact.source_asset_id ?? null,
        derivation: fact.derivation,
        })),
        conflicts,
      };
    });
  } catch (error: any) {
    // PGRST205/42P01 means migration 0008 has not been applied yet. This is a
    // rollout state, not a document-retrieval failure or a reason to block chat.
    if (!['PGRST205', '42P01'].includes(String(error?.code ?? ''))) {
      console.error('Business object context unavailable:', error);
      missing.push('Business object facts are temporarily unavailable.');
    }
  }

  // 3. Dataset schemas: filter to the routed scope before applying a limit.
  // Previously the code loaded an arbitrary first 10 tables and sorted later,
  // which could exclude the correct project/customer tables in larger orgs.
  const tableSelect = 'id, name, row_count, dataset:datasets!inner(id, title, keyword_id, organization_id), columns:dataset_columns(*)';
  const stronglyScoped = seedIds.length > 0 || Boolean(params.scopeTableId);
  let tableQuery = supabase
    .from('dataset_tables')
    .select(tableSelect)
    .eq('dataset.organization_id', ctx.org.id)
    .limit(12);
  if (params.scopeTableId) tableQuery = tableQuery.eq('id', params.scopeTableId);
  else if (stronglyScoped && keywordIds.length > 0) tableQuery = tableQuery.in('dataset.keyword_id', keywordIds);
  const { data: primaryTables, error: tableError } = await tableQuery;
  if (tableError) throw tableError;

  const tableRowsById = new Map<string, any>((primaryTables ?? []).map((table: any) => [table.id, table]));
  if (businessObjects.length > 0 && !params.scopeTableId) {
    const { data: datasetLinks } = await supabase
      .from('business_object_links')
      .select('dataset_id')
      .eq('organization_id', ctx.org.id)
      .in('object_id', businessObjects.map((object) => object.id))
      .not('dataset_id', 'is', null)
      .limit(30);
    const datasetIds = Array.from(new Set((datasetLinks ?? []).map((link: any) => link.dataset_id).filter(Boolean)));
    if (datasetIds.length > 0) {
      const { data: objectTables } = await supabase
        .from('dataset_tables')
        .select(tableSelect)
        .eq('dataset.organization_id', ctx.org.id)
        .in('dataset_id', datasetIds)
        .limit(12);
      for (const table of objectTables ?? []) tableRowsById.set((table as any).id, table);
    }
  }
  const tables = Array.from(tableRowsById.values()).slice(0, 12);
  const tableIds = tables.map((table: any) => table.id);
  const latestByTable = new Map<string, string>();
  if (tableIds.length > 0) {
    const { data: recentRows } = await supabase
      .from('dataset_rows')
      .select('dataset_table_id,created_at')
      .in('dataset_table_id', tableIds)
      .order('created_at', { ascending: false })
      .limit(1500);
    for (const row of recentRows ?? []) {
      if (!latestByTable.has(row.dataset_table_id)) latestByTable.set(row.dataset_table_id, row.created_at);
    }
  }

  const schemas: DatasetTableSchema[] = tables.map((t: any) => ({
    table_id: t.id,
    dataset_id: t.dataset?.id ?? '',
    dataset_title: t.dataset?.title ?? '',
    table_name: t.name,
    row_count: t.row_count,
    keyword_id: t.dataset?.keyword_id ?? null,
    latest_recorded_at: latestByTable.get(t.id) ?? null,
    columns: (t.columns ?? []).map((c: any) => ({
      field: c.normalized_name,
      name: c.name,
      type: c.data_type,
      semantic: c.semantic_name ?? null,
      samples: (c.sample_values ?? []).slice(0, 3),
    })),
  }));
  // 3b. Metric definitions: same scope-first rule, with source-table coverage.
  const metricSelect = 'id, name, description, formula, aggregation, source_table_id, value_column, date_column, time_grain, caveats, keyword_id';
  let metricQuery = supabase.from('metrics').select(metricSelect).eq('organization_id', ctx.org.id).limit(40);
  if (stronglyScoped && keywordIds.length > 0) metricQuery = metricQuery.in('keyword_id', keywordIds);
  const { data: scopedMetricRows, error: metricError } = await metricQuery;
  if (metricError) throw metricError;
  const metricById = new Map<string, MetricContext>(((scopedMetricRows ?? []) as MetricContext[]).map((metric) => [metric.id, metric]));
  if (stronglyScoped && tableIds.length > 0) {
    const { data: sourceMetrics } = await supabase
      .from('metrics')
      .select(metricSelect)
      .eq('organization_id', ctx.org.id)
      .in('source_table_id', tableIds)
      .limit(40);
    for (const metric of (sourceMetrics ?? []) as MetricContext[]) metricById.set(metric.id, metric);
  }
  const metrics = Array.from(metricById.values()).slice(0, 40);

  // 3c. Workflow context: open tasks around the routed keywords
  let workflowContext: WorkflowTaskContext[] = [];
  if (intent === 'workflow' || intent === 'report' || intent === 'analysis' || intent === 'forecast') {
    let taskQuery = supabase
      .from('tasks')
      .select('id, title, description, status, priority, due_date, keyword_id, keyword:keywords(title), assignee:organization_members(profiles(full_name,email)), task_dependencies!task_dependencies_task_id_fkey(depends_on_task_id)')
      .eq('organization_id', ctx.org.id)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .order('created_at', { ascending: false })
      .limit(30);
    if (keywordIds.length > 0) taskQuery = taskQuery.in('keyword_id', keywordIds);
    const { data: taskRows } = await taskQuery;
    workflowContext = ((taskRows ?? []) as any[]).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      keyword_id: t.keyword_id,
      keyword: t.keyword?.title ?? null,
      assignee: t.assignee?.profiles?.full_name ?? t.assignee?.profiles?.email ?? null,
      blocked_by: (t.task_dependencies ?? []).map((d: any) => d.depends_on_task_id),
    }));
  }

  // 3d. Compact operational snapshot. This carries the exact non-numeric
  // management details the model otherwise tends to miss (open decision,
  // blocker owner, due date, next action, evidence reference). Numeric totals
  // still have to come from registered metrics/tools.
  let operationalRecords: OperationalRecordContext[] = [];
  let operationalRowIds: string[] = [];
  if (['workflow', 'report', 'analysis', 'search'].includes(intent) && tableIds.length > 0) {
    const { data: recordRows } = await supabase
      .from('dataset_rows')
      .select('id,dataset_table_id,data,created_at')
      .in('dataset_table_id', tableIds.slice(0, 8))
      .order('created_at', { ascending: false })
      .limit(800);
    operationalRowIds = (recordRows ?? []).map((row: any) => row.id);
    const schemaByTable = new Map(schemas.map((schema) => [schema.table_id, schema]));
    operationalRecords = ((recordRows ?? []) as any[]).map((row) => {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const schema = schemaByTable.get(row.dataset_table_id);
      const title = firstRecordValue(data, [
        'title', 'deliverable', 'stakeholder', 'task', 'name', 'risk_id',
        'decision_id', 'work_package_id', 'invoice_number', 'customer_name', 'summary', 'decision',
      ]);
      if (!title) return null;
      return {
        source_row_id: row.id,
        table_id: row.dataset_table_id,
        table_name: schema?.table_name ?? 'table',
        record_type: schema?.dataset_title ?? 'operational record',
        title: truncate(title, 240),
        status: firstRecordValue(data, ['status', 'state', 'risk_level', 'sentiment']),
        owner: firstRecordValue(data, ['owner', 'assignee', 'responsible', 'employee_name']),
        due_date: firstRecordValue(data, ['due_date', 'review_date', 'planned_end', 'next_contact']),
        next_action: firstRecordValue(data, ['next_action', 'mitigation', 'commitments', 'action']),
        evidence_reference: firstRecordValue(data, ['evidence_reference', 'evidence', 'source_reference']),
        summary: firstRecordValue(data, ['impact', 'context', 'description', 'summary']),
        recorded_at: row.created_at,
      } satisfies OperationalRecordContext;
    }).filter(Boolean) as OperationalRecordContext[];
    operationalRecords = operationalRecords
      .sort((a, b) => operationalPriority(b) - operationalPriority(a))
      .slice(0, 24);
  }

  // 4. Document chunks (hybrid retrieval scoped to the dependency neighbourhood)
  let chunks: ChunkResult[] = [];
  try {
    if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) {
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
    } else {
      chunks = await loadLexicalChunks(supabase, ctx.org.id, keywordIds, question);
    }
  } catch (error) {
    console.error('Chunk retrieval failed:', error);
    missing.push('Document retrieval unavailable for this question.');
  }

  // 5. Business rules from routed keywords
  const businessRules = keywords.flatMap((k) =>
    (k.rules ?? []).filter(Boolean).map((rule) => ({ keyword: k.title, rule }))
  );

  let openQualityErrors = 0;
  let openQualityWarnings = 0;
  if (tableIds.length > 0) {
    const { data: qualityRows } = await supabase
      .from('data_quality_issues')
      .select('severity,entity_id')
      .eq('organization_id', ctx.org.id)
      .eq('status', 'open')
      .limit(500);
    const relevantIds = new Set([...tableIds, ...operationalRowIds]);
    const relevantIssues = (qualityRows ?? []).filter((issue) => relevantIds.has(issue.entity_id));
    openQualityErrors = relevantIssues.filter((issue) => issue.severity === 'error').length;
    openQualityWarnings = relevantIssues.filter((issue) => issue.severity === 'warning').length;
  }
  const facts = businessObjects.flatMap((object) => object.facts);
  const recordedDates = [
    ...Array.from(latestByTable.values()),
    ...facts.map((fact) => fact.valid_from),
    ...operationalRecords.map((record) => record.recorded_at),
  ].filter(Boolean).sort();
  const averageCompleteness = keywords.length > 0
    ? keywords.reduce((sum, keyword) => sum + (keyword.completeness_score ?? 0), 0) / keywords.length
    : 0;
  const contextQuality = computeContextQuality({
    matchedKeywordCount: dependency.nodes.length,
    averageKeywordCompleteness: averageCompleteness,
    businessRuleCount: businessRules.length,
    relationCount: dependency.edges.length,
    tableCount: schemas.length,
    metricCount: metrics.length,
    taskCount: workflowContext.length,
    documentCount: chunks.length,
    businessObjectCount: businessObjects.length,
    factCount: facts.length,
    sourcedFactCount: facts.filter((fact) => Boolean(fact.source_reference)).length,
    assertedFactCount: facts.filter((fact) => fact.truth_status === 'asserted').length,
    unresolvedFactConflicts: businessObjects.reduce((sum, object) => sum + object.conflicts.length, 0),
    operationalRecordCount: operationalRecords.length,
    openQualityErrors,
    openQualityWarnings,
    graphTruncated: dependency.truncated,
    latestRecordedAt: recordedDates.at(-1) ?? null,
  });
  if (contextQuality.grade === 'low') {
    missing.push(`Grounding confidence is low (${contextQuality.score}/100); review context warnings before relying on the answer.`);
  }

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
    business_objects: businessObjects,
    operational_context: operationalRecords,
    context_quality: contextQuality,
    chunks_used: chunks.map((c) => ({ id: c.id, asset_id: c.asset_id, similarity: c.similarity })),
    missing_data: missing,
    system_instructions: 'Answer only from grounded company context and computed data.',
  };

  // 6. Render context text (priority: world model → definitions → rules → relations → schemas → documents)
  const parts: string[] = [];
  try {
    const [worldModel, guidance] = await Promise.all([readCachedWorldModel(ctx), readGuidance(ctx)]);
    if (worldModel?.markdown) {
      parts.push('## Organization World Model (compiled from the company ontology)');
      parts.push(truncate(worldModel.markdown, 1600));
      parts.push('');
    }
    if (guidance) {
      parts.push(truncate(guidance, 900));
      parts.push('');
    }
  } catch (error) {
    console.error('World model unavailable:', error);
  }
  parts.push('## Grounding Manifest');
  parts.push(`Context quality: ${contextQuality.score}/100 (${contextQuality.grade}).`);
  parts.push(`Coverage: ${JSON.stringify(contextQuality.coverage)}.`);
  if (contextQuality.latest_recorded_at) parts.push(`Latest source record loaded: ${contextQuality.latest_recorded_at}.`);
  for (const warning of contextQuality.warnings) parts.push(`- Warning: ${warning}`);
  parts.push('Use the warnings to qualify the answer. A high score means evidence coverage is strong, not that every business conclusion is automatically correct.');
  parts.push('');
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
  if (businessObjects.length > 0) {
    parts.push('\n## Business Objects and Current Facts');
    parts.push('Truth status: approved/verified = source fact; derived = registered calculation; asserted = unverified input. Never present asserted data as verified.');
    for (const object of businessObjects.slice(0, 20)) {
      parts.push(`### ${object.display_name} [${object.object_type}]${object.external_key ? ` (${object.external_key})` : ''} — ${object.status}`);
      for (const fact of object.facts.slice(0, 25)) {
        parts.push(
          `- ${fact.key}: ${JSON.stringify(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}` +
          ` [${fact.truth_status}; source=${fact.source_type}${fact.source_reference ? `:${fact.source_reference}` : ''}; valid from ${fact.valid_from}]` +
          `${fact.derivation ? ` — derivation: ${truncate(fact.derivation, 240)}` : ''}`
        );
      }
      for (const conflict of object.conflicts) {
        parts.push(`- CONFLICT ${conflict.key}: ${JSON.stringify(conflict.values)} [statuses=${conflict.truth_statuses.join(',')}]. Do not choose a value; report that reconciliation is required.`);
      }
    }
  }
  if (operationalRecords.length > 0) {
    parts.push('\n## Current Operational Records');
    parts.push('These are exact source records for status, ownership, dates, actions, and evidence. Dates and identifiers are facts; calculate every business number through a tool.');
    for (const record of operationalRecords) {
      parts.push(
        `- [source row ${record.source_row_id}] ${record.title} — table=${record.table_name}` +
        `${record.status ? `; status=${record.status}` : ''}` +
        `${record.owner ? `; owner=${record.owner}` : ''}` +
        `${record.due_date ? `; due/review=${record.due_date}` : ''}` +
        `${record.next_action ? `; next action=${truncate(record.next_action, 220)}` : ''}` +
        `${record.summary ? `; context=${truncate(record.summary, 220)}` : ''}` +
        `${record.evidence_reference ? `; evidence=${record.evidence_reference}` : '; evidence=MISSING'}`
      );
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
        `- [${t.status}] ${t.title} (priority ${t.priority}${t.keyword ? `, area ${t.keyword}` : ''}${t.assignee ? `, owner ${t.assignee}` : ''}${t.due_date ? `, due ${t.due_date}` : ''}${t.blocked_by.length > 0 ? `, blocked by ${t.blocked_by.length} task(s)` : ''})${t.description ? ` — ${truncate(t.description, 260)}` : ''}`
      );
    }
  }
  if (schemas.length > 0) {
    parts.push('\n## Available Structured Data');
    for (const s of schemas) {
      parts.push(
        `- Table "${s.table_name}" (id ${s.table_id}) from dataset "${s.dataset_title}", ${s.row_count} rows. Columns: ${s.columns
          .map((c) => `${c.field}:${c.type}${c.semantic ? `[${c.semantic}]` : ''}`)
          .join(', ')}${s.latest_recorded_at ? `. Latest recorded row: ${s.latest_recorded_at}` : ''}`
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
    businessObjects,
    operationalRecords,
    contextQuality,
    contextText: compactContextSections(parts),
  };
}
