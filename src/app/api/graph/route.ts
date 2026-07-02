import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth';
import { apiError } from '@/lib/api';

// GET /api/graph - Full org keyword graph for the visual graph view
export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');

    const [keywordsRes, relationsRes] = await Promise.all([
      ctx.supabase
        .from('keywords')
        .select('id, title, slug, parent_id, keyword_type, status, completeness_score, definition, color')
        .eq('organization_id', ctx.org.id)
        .order('title')
        .limit(500),
      ctx.supabase
        .from('keyword_relations')
        .select('id, from_keyword_id, to_keyword_id, relation_type, strength, note')
        .eq('organization_id', ctx.org.id)
        .limit(1000),
    ]);
    if (keywordsRes.error) throw keywordsRes.error;
    if (relationsRes.error) throw relationsRes.error;

    return NextResponse.json({
      data: {
        nodes: keywordsRes.data ?? [],
        edges: relationsRes.data ?? [],
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to load graph');
  }
}
