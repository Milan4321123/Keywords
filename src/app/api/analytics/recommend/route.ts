import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { requireOrgContext, authErrorResponse } from '@/lib/auth';
import { getProvider } from '@/lib/ai/provider';
import { AnalyticsRecommendation, AnalyticsRecommendationRequest, RelationType } from '@/types';

export const runtime = 'nodejs';

type DatasetRow = {
  id: string;
  row_index: number;
  data: Record<string, unknown>;
};

type KeywordLite = {
  id: string;
  title: string;
  synonyms: string[] | null;
  definition: string | null;
};

type RelationLite = {
  id: string;
  from_keyword_id: string;
  to_keyword_id: string;
  relation_type: RelationType;
  strength: number;
  note: string | null;
};

const RELATION_WEIGHT: Record<RelationType, number> = {
  'is-a': 0.3,
  'part-of': 0.5,
  requires: 0.9,
  causes: 1.0,
  'leads-to': 0.8,
  'owned-by': 0.4,
  'depends-on': 1.0,
  'related-to': 0.35,
  approves: 0.7,
  contains: 0.4,
  triggers: 0.9,
  blocks: 1.0,
  succeeds: 0.7,
  precedes: 0.7,
  produces: 0.8,
  affects: 0.85,
  enables: 0.8,
  uses: 0.6,
  'generated-by': 0.6,
  'measured-by': 0.7,
  'reported-in': 0.4,
  'calculated-from': 0.9,
  'validated-by': 0.6,
  'conflicts-with': 0.75,
  replaces: 0.5,
  'derived-from': 0.7,
  'belongs-to': 0.4,
};

async function fetchRows(params: {
  supabase: SupabaseClient;
  datasetTableId: string;
  maxRows: number;
}) {
  const out: DatasetRow[] = [];
  const pageSize = 2000;
  for (let offset = 0; offset < params.maxRows; offset += pageSize) {
    const { data, error } = await params.supabase
      .from('dataset_rows')
      .select('id,row_index,data')
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
      }))
    );
    if (chunk.length < pageSize) break;
  }
  return out;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textFromRow(row: DatasetRow): string {
  return Object.values(row.data)
    .filter((v) => v != null)
    .map((v) => String(v))
    .join(' ')
    .toLowerCase();
}

function recommendationTemplate(params: {
  relationType: RelationType;
  fromTitle: string;
  toTitle: string;
  fromHits: number;
  toHits: number;
}): string {
  const { relationType, fromTitle, toTitle, fromHits, toHits } = params;
  const loadSignal = fromHits > toHits * 1.4;

  switch (relationType) {
    case 'depends-on':
    case 'requires':
      return loadSignal
        ? `Prioritize readiness for "${toTitle}" before scaling "${fromTitle}", because current activity around ${fromTitle} is ahead of ${toTitle}.`
        : `Keep "${fromTitle}" and "${toTitle}" synchronized to reduce dependency drift.`;
    case 'blocks':
      return `Create a blocker-clearing action for "${toTitle}" before progressing "${fromTitle}" tasks.`;
    case 'causes':
    case 'triggers':
    case 'leads-to':
      return `Set an early-warning monitor: when "${fromTitle}" rises, proactively inspect "${toTitle}" outcomes.`;
    case 'precedes':
    case 'succeeds':
      return `Enforce handoff checkpoints between "${fromTitle}" and "${toTitle}" to reduce sequencing delays.`;
    case 'approves':
      return `Improve approval SLA between "${fromTitle}" and "${toTitle}" to reduce waiting time.`;
    default:
      return `Review the relationship between "${fromTitle}" and "${toTitle}" and assign an owner for follow-up.`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('run_ai');
    const supabase = ctx.supabase;
    const body = (await req.json()) as AnalyticsRecommendationRequest;

    if (!body?.dataset_table_id) {
      return NextResponse.json({ error: 'dataset_table_id is required' }, { status: 400 });
    }

    const topN = Math.min(Math.max(body.top_n ?? 5, 1), 15);
    const maxRows = Math.min(Math.max(body.max_rows ?? 15000, 1000), 50000);

    const { data: table, error: tableError } = await supabase
      .from('dataset_tables')
      .select('id,name,row_count,datasets!inner(organization_id)')
      .eq('id', body.dataset_table_id)
      .eq('datasets.organization_id', ctx.org.id)
      .maybeSingle();
    if (tableError) throw tableError;
    if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 });

    const rows = await fetchRows({
      supabase,
      datasetTableId: body.dataset_table_id,
      maxRows,
    });

    let keywordQuery = supabase
      .from('keywords')
      .select('id,title,synonyms,definition')
      .eq('organization_id', ctx.org.id)
      .order('title', { ascending: true });
    if (body.context_keyword_ids?.length) {
      keywordQuery = keywordQuery.in('id', body.context_keyword_ids);
    }

    const { data: keywordsRaw, error: kwError } = await keywordQuery;
    if (kwError) throw kwError;
    const keywords = (keywordsRaw ?? []) as KeywordLite[];

    if (keywords.length === 0) {
      return NextResponse.json({
        table,
        recommendations: [],
        graph_summary: {
          considered_keywords: 0,
          considered_relations: 0,
          analyzed_rows: rows.length,
          note: 'No keywords matched the current scope.',
        },
      });
    }

    const keywordIds = keywords.map((k) => k.id);
    const { data: relRaw, error: relError } = await supabase
      .from('keyword_relations')
      .select('id,from_keyword_id,to_keyword_id,relation_type,strength,note')
      .eq('organization_id', ctx.org.id)
      .in('from_keyword_id', keywordIds)
      .in('to_keyword_id', keywordIds);
    if (relError) throw relError;

    const relations = (relRaw ?? []) as RelationLite[];
    const keywordById = new Map(keywords.map((k) => [k.id, k] as const));

    const rowText = rows.map((r) => ({ id: r.id, text: textFromRow(r) }));

    const hitsByKeyword = new Map<string, Set<string>>();
    for (const keyword of keywords) {
      const terms = [keyword.title, ...(keyword.synonyms ?? [])]
        .map((t) => (t ?? '').trim().toLowerCase())
        .filter((t) => t.length >= 3)
        .slice(0, 12);

      const hitIds = new Set<string>();
      if (terms.length > 0) {
        const regexes = terms.map((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, 'i'));
        for (const rt of rowText) {
          if (regexes.some((rgx) => rgx.test(rt.text))) hitIds.add(rt.id);
        }
      }
      hitsByKeyword.set(keyword.id, hitIds);
    }

    const scored: AnalyticsRecommendation[] = relations
      .map((relation) => {
        const fromKeyword = keywordById.get(relation.from_keyword_id);
        const toKeyword = keywordById.get(relation.to_keyword_id);
        if (!fromKeyword || !toKeyword) return null;

        const fromHits = hitsByKeyword.get(fromKeyword.id) ?? new Set<string>();
        const toHits = hitsByKeyword.get(toKeyword.id) ?? new Set<string>();

        const overlap = new Set<string>();
        for (const id of fromHits) {
          if (toHits.has(id)) overlap.add(id);
        }

        const support = (fromHits.size + toHits.size + overlap.size * 2) / Math.max(1, rows.length);
        const relationWeight = RELATION_WEIGHT[relation.relation_type] ?? 0.4;
        const strength = Math.max(1, Math.min(10, relation.strength ?? 5)) / 10;
        const impactScore = Math.min(1, support * relationWeight * (0.6 + 0.4 * strength));

        const evidenceRows = Array.from(new Set([...overlap, ...fromHits, ...toHits])).slice(0, 20);
        const recommendation = recommendationTemplate({
          relationType: relation.relation_type,
          fromTitle: fromKeyword.title,
          toTitle: toKeyword.title,
          fromHits: fromHits.size,
          toHits: toHits.size,
        });

        return {
          relation_id: relation.id,
          relation_type: relation.relation_type,
          from_keyword: { id: fromKeyword.id, title: fromKeyword.title },
          to_keyword: { id: toKeyword.id, title: toKeyword.title },
          impact_score: Number(impactScore.toFixed(4)),
          confidence: Number(Math.min(1, support + strength * 0.2).toFixed(4)),
          recommendation,
          rationale: relation.note || `Observed data mentions suggest this ${relation.relation_type} dependency is active.`,
          evidence_row_ids: evidenceRows,
          stats: {
            from_mentions: fromHits.size,
            to_mentions: toHits.size,
            overlap_mentions: overlap.size,
          },
        } as AnalyticsRecommendation;
      })
      .filter((x): x is AnalyticsRecommendation => Boolean(x))
      .sort((a, b) => b.impact_score - a.impact_score)
      .slice(0, topN);

    let executiveSummary: string | null = null;
    if (scored.length > 0) {
      try {
        const compact = scored.map((r) => ({
          relation_type: r.relation_type,
          from: r.from_keyword.title,
          to: r.to_keyword.title,
          impact: r.impact_score,
          confidence: r.confidence,
          recommendation: r.recommendation,
        }));

        executiveSummary = await getProvider().chat(
          [
            {
              role: 'system',
              content:
                'You are an operations advisor. Write a concise executive summary from dependency recommendations. ' +
                'Output plain text only. Keep to 4-6 short bullet points. Focus on actions, risk, and sequencing.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                table: { id: table.id, name: table.name, analyzed_rows: rows.length },
                question: body.question ?? null,
                recommendations: compact,
              }),
            },
          ],
          { tier: 'fast', temperature: 0.2, maxTokens: 450 }
        );
      } catch {
        executiveSummary = null;
      }
    }

    return NextResponse.json({
      table,
      recommendations: scored,
      executive_summary: executiveSummary,
      graph_summary: {
        considered_keywords: keywords.length,
        considered_relations: relations.length,
        analyzed_rows: rows.length,
        note:
          scored.length > 0
            ? 'Recommendations are ranked by dependency impact score and grounded in table row evidence.'
            : 'No strong dependency signal found for the selected scope. Try selecting more keywords or a different table.',
      },
    });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: authErr.status });
    }
    console.error('Error in analytics recommendations:', err);
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
    return NextResponse.json({ error: 'Failed to generate recommendations' }, { status: 500 });
  }
}
