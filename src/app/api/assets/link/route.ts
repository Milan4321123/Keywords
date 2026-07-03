import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { recomputeKeywordCompleteness } from '@/lib/ontology/completeness';

async function verifyOwnership(ctx: any, assetId: string, keywordId: string) {
  const [{ data: asset }, { data: keyword }] = await Promise.all([
    ctx.supabase
      .from('assets')
      .select('id')
      .eq('id', assetId)
      .eq('organization_id', ctx.org.id)
      .maybeSingle(),
    ctx.supabase
      .from('keywords')
      .select('id')
      .eq('id', keywordId)
      .eq('organization_id', ctx.org.id)
      .maybeSingle(),
  ]);
  return Boolean(asset && keyword);
}

// POST /api/assets/link - Link an asset to a keyword (e.g. accepting an AI suggestion)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const { asset_id, keyword_id, note } = await req.json();

    if (!asset_id || !keyword_id) {
      return NextResponse.json({ data: null, error: 'asset_id and keyword_id required' }, { status: 400 });
    }
    if (!(await verifyOwnership(ctx, asset_id, keyword_id))) {
      return NextResponse.json({ data: null, error: 'Asset or keyword not found' }, { status: 404 });
    }

    const { error } = await ctx.supabase.from('keyword_assets').upsert(
      { asset_id, keyword_id, note: note ?? null },
      { onConflict: 'keyword_id,asset_id', ignoreDuplicates: true }
    );
    if (error) throw error;

    await audit(ctx, 'asset.link', { type: 'asset', id: asset_id }, { keyword_id });
    await recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, keyword_id);

    return NextResponse.json({ data: { linked: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to link asset');
  }
}

// DELETE /api/assets/link?asset_id=&keyword_id= - Unlink an asset from a keyword
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const { searchParams } = new URL(req.url);
    const assetId = searchParams.get('asset_id');
    const keywordId = searchParams.get('keyword_id');

    if (!assetId || !keywordId) {
      return NextResponse.json({ data: null, error: 'asset_id and keyword_id required' }, { status: 400 });
    }
    if (!(await verifyOwnership(ctx, assetId, keywordId))) {
      return NextResponse.json({ data: null, error: 'Asset or keyword not found' }, { status: 404 });
    }

    const { error } = await ctx.supabase
      .from('keyword_assets')
      .delete()
      .eq('asset_id', assetId)
      .eq('keyword_id', keywordId);
    if (error) throw error;

    await audit(ctx, 'asset.unlink', { type: 'asset', id: assetId }, { keyword_id: keywordId });
    await recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, keywordId);

    return NextResponse.json({ data: { unlinked: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to unlink asset');
  }
}
