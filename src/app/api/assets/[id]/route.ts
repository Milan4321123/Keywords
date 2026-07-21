import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit, roleHasPermission } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { recomputeKeywordCompleteness } from '@/lib/ontology/completeness';

type RouteParams = { params: Promise<{ id: string }> };

// DELETE /api/assets/[id] — remove a file (storage object + record).
// Allowed for the uploader themselves or anyone who can edit keywords.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const { id } = await params;

    const { data: asset, error } = await ctx.supabase
      .from('assets')
      .select('id, file_name, file_url, created_by, meta_json, links:keyword_assets(keyword_id)')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (error) throw error;
    if (!asset) {
      return NextResponse.json({ data: null, error: 'Datei nicht gefunden · File not found' }, { status: 404 });
    }

    const isOwn = asset.created_by === ctx.user.id;
    if (!isOwn && !roleHasPermission(ctx.role, 'edit_keywords')) {
      return NextResponse.json(
        { data: null, error: 'Nur eigene Dateien löschbar · You can only delete your own files' },
        { status: 403 }
      );
    }

    // Remove the storage object (best effort; the record is the source of truth)
    const path =
      asset.meta_json?.storage_path ??
      (() => {
        const marker = '/object/public/assets/';
        const idx = asset.file_url.indexOf(marker);
        return idx !== -1 ? decodeURIComponent(asset.file_url.slice(idx + marker.length)) : null;
      })();
    if (path) {
      await ctx.supabase.storage.from('assets').remove([path]);
    }

    const linkedKeywordIds = ((asset as any).links ?? []).map((l: any) => l.keyword_id) as string[];

    // Chunks and keyword links cascade via FK
    const { error: deleteError } = await ctx.supabase
      .from('assets')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.org.id);
    if (deleteError) throw deleteError;

    await audit(ctx, 'asset.delete', { type: 'asset', id }, { file_name: asset.file_name });

    for (const keywordId of linkedKeywordIds) {
      await recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, keywordId);
    }

    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to delete file');
  }
}
