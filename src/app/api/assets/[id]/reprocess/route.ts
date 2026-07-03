import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { processAsset } from '@/lib/ingestion/process';

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/assets/[id]/reprocess - Re-run the ingestion pipeline for an asset
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const { id } = await params;

    const { data: asset, error } = await ctx.supabase
      .from('assets')
      .select('id, file_url, meta_json')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (error) throw error;
    if (!asset) {
      return NextResponse.json({ data: null, error: 'Asset not found' }, { status: 404 });
    }

    const path =
      asset.meta_json?.storage_path ??
      (() => {
        const marker = '/object/public/assets/';
        const idx = asset.file_url.indexOf(marker);
        return idx !== -1 ? decodeURIComponent(asset.file_url.slice(idx + marker.length)) : null;
      })();

    if (!path) {
      return NextResponse.json({ data: null, error: 'No storage path recorded for this asset' }, { status: 400 });
    }

    const { data: blob, error: downloadError } = await ctx.supabase.storage
      .from('assets')
      .download(path);
    if (downloadError || !blob) {
      return NextResponse.json({ data: null, error: 'Failed to download source file' }, { status: 502 });
    }

    const result = await processAsset({
      assetId: id,
      organizationId: ctx.org.id,
      fileBuffer: await blob.arrayBuffer(),
    });

    await audit(ctx, 'asset.reprocess', { type: 'asset', id }, {
      status: result.status,
      chunks: result.chunks,
    });

    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    return apiError(error, 'Failed to reprocess asset');
  }
}
