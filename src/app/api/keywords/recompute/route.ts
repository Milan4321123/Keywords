import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { recomputeKeywordCompleteness } from '@/lib/ontology/completeness';

// POST /api/keywords/recompute - Recompute completeness scores for all keywords
export async function POST(_req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');

    const { data: keywords, error } = await ctx.supabase
      .from('keywords')
      .select('id')
      .eq('organization_id', ctx.org.id);
    if (error) throw error;

    const ids = (keywords ?? []).map((k) => k.id);
    let updated = 0;

    // Small batches to keep DB load sane on large ontologies
    const batchSize = 10;
    for (let i = 0; i < ids.length; i += batchSize) {
      const results = await Promise.all(
        ids
          .slice(i, i + batchSize)
          .map((id) => recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, id))
      );
      updated += results.filter((r) => r !== null).length;
    }

    await audit(ctx, 'keyword.recompute_completeness', { type: 'keyword' }, { count: updated });

    return NextResponse.json({ data: { recomputed: updated }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to recompute completeness');
  }
}
