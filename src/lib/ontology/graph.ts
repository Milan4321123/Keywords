import { SupabaseClient } from '@supabase/supabase-js';
import { Keyword, KeywordRelation, RelationType } from '@/types';

export type TraversalIntent = 'analysis' | 'workflow' | 'definition' | 'general';

/**
 * Per-intent relation-type allowlists (docs/05-ai-system.md).
 * null = all relation types allowed.
 */
export const INTENT_RELATION_FILTERS: Record<TraversalIntent, RelationType[] | null> = {
  analysis: [
    'calculated-from', 'measured-by', 'depends-on', 'part-of',
    'derived-from', 'affects', 'produces', 'generated-by',
  ] as RelationType[],
  workflow: [
    'requires', 'blocks', 'precedes', 'succeeds', 'depends-on',
    'triggers', 'approves', 'enables', 'validated-by',
  ] as RelationType[],
  definition: ['is-a', 'part-of', 'related-to', 'contains', 'belongs-to'] as RelationType[],
  general: null,
};

export interface DependencyNode {
  keyword: Keyword;
  depth: number;
  /** 0–1; seeds are 1, decays with depth, relation strength, and target completeness */
  relevance: number;
  /** how this node was reached: 'seed' | 'hierarchy' | relation type */
  via: string;
}

export interface DependencyEdge {
  id: string;
  from_keyword_id: string;
  to_keyword_id: string;
  relation_type: RelationType;
  strength: number;
  note: string | null;
  depth: number;
  from_keyword?: { id: string; title: string };
  to_keyword?: { id: string; title: string };
}

export interface DependencyContext {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  truncated: boolean;
}

export interface TraversalOptions {
  maxDepth?: number;
  maxNodes?: number;
  relationTypes?: RelationType[] | null;
  intent?: TraversalIntent;
  includeHierarchy?: boolean;
  minRelevance?: number;
  /** Restrict loaded keywords to these access levels (Worker/Bauleiter/Admin). */
  accessLevels?: string[];
}

const DEPTH_DECAY = 0.65;
const HIERARCHY_WEIGHT = 0.8;

/**
 * Depth-limited, relevance-scored traversal of the keyword graph.
 * This is the `get_dependency_context` primitive the AI router uses to load
 * dependencies without exploding the context window: relation-type filters,
 * depth limits, per-node relevance scoring, and a hard node cap.
 */
export async function getDependencyContext(
  supabase: SupabaseClient,
  organizationId: string,
  seedKeywordIds: string[],
  options: TraversalOptions = {}
): Promise<DependencyContext> {
  const {
    maxDepth = 2,
    maxNodes = 20,
    intent = 'general',
    includeHierarchy = true,
    minRelevance = 0.12,
  } = options;
  const relationTypes =
    options.relationTypes !== undefined ? options.relationTypes : INTENT_RELATION_FILTERS[intent];

  const seeds = Array.from(new Set(seedKeywordIds)).slice(0, 25);
  if (seeds.length === 0) return { nodes: [], edges: [], truncated: false };

  // best relevance per keyword id
  const best = new Map<string, { depth: number; relevance: number; via: string }>();
  for (const id of seeds) best.set(id, { depth: 0, relevance: 1, via: 'seed' });

  const edges = new Map<string, DependencyEdge>();
  let frontier = seeds;
  let truncated = false;

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const idList = `(${frontier.join(',')})`;

    let relationQuery = supabase
      .from('keyword_relations')
      .select('id, from_keyword_id, to_keyword_id, relation_type, strength, note')
      .eq('organization_id', organizationId)
      .or(`from_keyword_id.in.${idList},to_keyword_id.in.${idList}`)
      .limit(300);
    if (relationTypes && relationTypes.length > 0) {
      relationQuery = relationQuery.in('relation_type', relationTypes);
    }

    const [{ data: relations }, hierarchyRes] = await Promise.all([
      relationQuery,
      includeHierarchy
        ? supabase
            .from('keywords')
            .select('id, parent_id')
            .eq('organization_id', organizationId)
            .or(`id.in.${idList},parent_id.in.${idList}`)
            .limit(300)
        : Promise.resolve({ data: [] as Array<{ id: string; parent_id: string | null }> }),
    ]);

    const nextFrontier = new Set<string>();

    const visit = (
      sourceId: string,
      targetId: string,
      weight: number,
      via: string
    ) => {
      const source = best.get(sourceId);
      if (!source) return;
      const relevance = source.relevance * weight * DEPTH_DECAY;
      if (relevance < minRelevance) return;
      const existing = best.get(targetId);
      if (!existing || existing.relevance < relevance) {
        best.set(targetId, { depth, relevance, via });
        if (!existing) nextFrontier.add(targetId);
      }
    };

    for (const rel of relations ?? []) {
      const weight = Math.max(1, Math.min(10, rel.strength ?? 5)) / 10;
      const fromKnown = best.has(rel.from_keyword_id);
      const toKnown = best.has(rel.to_keyword_id);
      if (fromKnown) visit(rel.from_keyword_id, rel.to_keyword_id, weight, rel.relation_type);
      if (toKnown) visit(rel.to_keyword_id, rel.from_keyword_id, weight, rel.relation_type);
      if (fromKnown || toKnown) {
        edges.set(rel.id, { ...rel, depth } as DependencyEdge);
      }
    }

    for (const row of hierarchyRes.data ?? []) {
      if (!row.parent_id) continue;
      if (best.has(row.id)) visit(row.id, row.parent_id, HIERARCHY_WEIGHT, 'hierarchy');
      if (best.has(row.parent_id)) visit(row.parent_id, row.id, HIERARCHY_WEIGHT, 'hierarchy');
    }

    frontier = Array.from(nextFrontier);
  }

  // Rank, cap, and load full keyword rows
  const ranked = Array.from(best.entries()).sort((a, b) => b[1].relevance - a[1].relevance);
  if (ranked.length > maxNodes) truncated = true;
  const kept = ranked.slice(0, maxNodes);
  const keptIds = new Set(kept.map(([id]) => id));

  let keywordQuery = supabase
    .from('keywords')
    .select('*')
    .eq('organization_id', organizationId)
    .in('id', Array.from(keptIds));
  if (options.accessLevels && options.accessLevels.length > 0) {
    keywordQuery = keywordQuery.in('access_level', options.accessLevels);
  }
  const { data: keywords } = await keywordQuery;

  const keywordById = new Map((keywords ?? []).map((k) => [k.id, k as Keyword]));

  const nodes: DependencyNode[] = kept
    .filter(([id]) => keywordById.has(id))
    .map(([id, meta]) => {
      const keyword = keywordById.get(id)!;
      // Well-defined keywords are more useful context than empty stubs
      const completenessWeight = 0.5 + 0.5 * ((keyword.completeness_score ?? 0) / 100);
      return {
        keyword,
        depth: meta.depth,
        relevance:
          meta.via === 'seed' ? 1 : Math.round(meta.relevance * completenessWeight * 1000) / 1000,
        via: meta.via,
      };
    })
    .sort((a, b) => b.relevance - a.relevance);

  const finalEdges = Array.from(edges.values())
    .filter((e) => keptIds.has(e.from_keyword_id) && keptIds.has(e.to_keyword_id))
    .map((e) => ({
      ...e,
      from_keyword: { id: e.from_keyword_id, title: keywordById.get(e.from_keyword_id)?.title ?? '' },
      to_keyword: { id: e.to_keyword_id, title: keywordById.get(e.to_keyword_id)?.title ?? '' },
    }));

  return { nodes, edges: finalEdges, truncated };
}

/** Convert dependency edges to the KeywordRelation shape buildAIContext expects. */
export function edgesToRelations(edges: DependencyEdge[]): KeywordRelation[] {
  return edges.map((e) => ({
    id: e.id,
    from_keyword_id: e.from_keyword_id,
    to_keyword_id: e.to_keyword_id,
    relation_type: e.relation_type,
    note: e.note,
    strength: e.strength,
    bidirectional: false,
    created_at: '',
    from_keyword: e.from_keyword as any,
    to_keyword: e.to_keyword as any,
  }));
}
