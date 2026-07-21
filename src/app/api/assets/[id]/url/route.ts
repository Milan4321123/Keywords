import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { personalKeywordScope } from '@/lib/ontology/assignments';

type RouteParams = { params: Promise<{ id: string }> };

function storagePathFromAsset(asset: { file_url: string; meta_json: Record<string, any> | null }): string | null {
  const fromMeta = asset.meta_json?.storage_path;
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta;
  // Legacy assets: derive the path from the public URL
  const marker = '/object/public/assets/';
  const idx = asset.file_url.indexOf(marker);
  if (idx !== -1) return decodeURIComponent(asset.file_url.slice(idx + marker.length));
  return null;
}

// GET /api/assets/[id]/url - Short-lived signed URL after a permission check.
// Works with private buckets; the stored public URL is only a legacy fallback.
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const { id } = await params;

    const { data: asset, error } = await ctx.supabase
      .from('assets')
      .select('id, file_url, meta_json, created_by, links:keyword_assets(keyword_id)')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (error) throw error;
    if (!asset) {
      return NextResponse.json({ data: null, error: 'Asset not found' }, { status: 404 });
    }

    // Personal scope: a restricted worker may open a file only when it is
    // their own upload or linked to a keyword in their assigned branches.
    const scope = await personalKeywordScope(ctx);
    if (scope) {
      const own = asset.created_by === ctx.user.id;
      const linkedInScope = ((asset as any).links ?? []).some((l: any) => scope.has(l.keyword_id));
      if (!own && !linkedInScope) {
        return NextResponse.json({ data: null, error: 'Asset not found' }, { status: 404 });
      }
    }

    const path = storagePathFromAsset(asset);
    if (path) {
      const { data: signed, error: signError } = await ctx.supabase.storage
        .from('assets')
        .createSignedUrl(path, 300);
      if (!signError && signed?.signedUrl) {
        return NextResponse.json({ data: { url: signed.signedUrl, expires_in: 300 }, error: null });
      }
    }

    // Legacy fallback for assets uploaded before storage paths were recorded
    return NextResponse.json({ data: { url: asset.file_url, expires_in: null }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to create file URL');
  }
}
