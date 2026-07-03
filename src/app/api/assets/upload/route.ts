import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api';
import { processAsset } from '@/lib/ingestion/process';
import { recomputeKeywordCompleteness } from '@/lib/ontology/completeness';

// POST /api/assets/upload - Upload files and link to keyword
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    enforceRateLimit('upload', ctx.user.id);
    const formData = await req.formData();

    const file = formData.get('file') as File;
    const keywordId = formData.get('keyword_id') as string;

    if (!file) {
      return NextResponse.json(
        { data: null, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Keyword link must belong to the active organization
    if (keywordId) {
      const { data: keyword } = await ctx.supabase
        .from('keywords')
        .select('id')
        .eq('id', keywordId)
        .eq('organization_id', ctx.org.id)
        .maybeSingle();
      if (!keyword) {
        return NextResponse.json({ data: null, error: 'Keyword not found' }, { status: 400 });
      }
    }

    // Determine file type
    const mimeType = file.type;
    let fileType = 'other';
    if (mimeType.startsWith('image/')) fileType = 'image';
    else if (mimeType === 'application/pdf') fileType = 'pdf';
    else if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) fileType = 'excel';
    else if (mimeType.includes('word') || mimeType.includes('document')) fileType = 'word';
    else if (mimeType.startsWith('text/')) fileType = 'text';

    // Upload to Supabase Storage under an org-scoped path
    const fileBuffer = await file.arrayBuffer();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const storagePath = `${ctx.org.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await ctx.supabase.storage
      .from('assets')
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = ctx.supabase.storage
      .from('assets')
      .getPublicUrl(storagePath);

    // Create asset record (file access should go through /api/assets/[id]/url)
    const { data: asset, error: assetError } = await ctx.supabase
      .from('assets')
      .insert({
        organization_id: ctx.org.id,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: fileType,
        mime_type: mimeType,
        file_size: file.size,
        processed: false,
        processing_status: 'pending',
        meta_json: { storage_path: storagePath, source: 'upload' },
        created_by: ctx.user.id,
      })
      .select()
      .single();

    if (assetError) throw assetError;

    // Link to keyword if provided
    if (keywordId && asset) {
      await ctx.supabase.from('keyword_assets').insert({
        keyword_id: keywordId,
        asset_id: asset.id,
      });
      await recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, keywordId);
    }

    await audit(ctx, 'asset.upload', { type: 'asset', id: asset.id }, {
      file_name: file.name,
      file_type: fileType,
      keyword_id: keywordId || null,
    });

    // Run the ingestion pipeline. Inline for now; becomes a queued job at M11.
    processAsset({
      assetId: asset.id,
      organizationId: ctx.org.id,
      fileBuffer,
      keywordId: keywordId || null,
    }).catch((error) => console.error('processAsset failed:', error));

    return NextResponse.json({ data: asset, error: null });
  } catch (error) {
    return apiError(error, 'Failed to upload file');
  }
}

// GET /api/assets/upload - Get assets (optionally filtered by keyword)
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const { searchParams } = new URL(req.url);
    const keywordId = searchParams.get('keyword_id');

    if (keywordId) {
      const { data, error } = await ctx.supabase
        .from('keyword_assets')
        .select('*, asset:assets!inner(*)')
        .eq('keyword_id', keywordId)
        .eq('asset.organization_id', ctx.org.id);

      if (error) throw error;

      return NextResponse.json({
        data: data?.map((ka) => ka.asset) || [],
        error: null,
      });
    }

    const { data: assets, error } = await ctx.supabase
      .from('assets')
      .select('*')
      .eq('organization_id', ctx.org.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ data: assets, error: null });
  } catch (error) {
    return apiError(error, 'Failed to fetch assets');
  }
}
