import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, accessibleLevels } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { getDependencyContext, TraversalIntent } from '@/lib/ontology/graph';
import { RelationType } from '@/types';

const INTENTS: TraversalIntent[] = ['analysis', 'workflow', 'definition', 'general'];

// POST /api/graph/context - Dependency context for a set of keywords
// (the get_dependency_context tool: depth limits, relation-type filters, relevance scoring)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const body = await req.json();

    const seedIds: string[] = Array.isArray(body.keyword_ids)
      ? body.keyword_ids.filter((id: unknown) => typeof id === 'string')
      : [];
    if (seedIds.length === 0) {
      return NextResponse.json({ data: null, error: 'keyword_ids[] required' }, { status: 400 });
    }

    const result = await getDependencyContext(ctx.supabase, ctx.org.id, seedIds, {
      maxDepth: Math.min(Math.max(parseInt(body.depth, 10) || 2, 1), 4),
      maxNodes: Math.min(Math.max(parseInt(body.max_nodes, 10) || 20, 1), 60),
      intent: INTENTS.includes(body.intent) ? body.intent : 'general',
      relationTypes: Array.isArray(body.relation_types)
        ? (body.relation_types as RelationType[])
        : undefined,
      includeHierarchy: body.include_hierarchy !== false,
      accessLevels: accessibleLevels(ctx.role),
    });

    return NextResponse.json({
      data: {
        nodes: result.nodes.map((n) => ({
          keyword: n.keyword,
          depth: n.depth,
          relevance: n.relevance,
          via: n.via,
        })),
        edges: result.edges,
        truncated: result.truncated,
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to build dependency context');
  }
}
