import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { personalKeywordScope } from '@/lib/ontology/assignments';

const VALID_TYPES = ['pdf', 'image', 'excel', 'word', 'text', 'audio', 'video', 'other'];

// GET /api/assets — the file library.
// Filters: ?q= (name/summary search) &type= &keyword_id= &mine=1 &limit= &offset=
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.trim() ?? '';
    const type = url.searchParams.get('type') ?? '';
    const keywordId = url.searchParams.get('keyword_id') ?? '';
    const mine = url.searchParams.get('mine') === '1';
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 60) || 60, 120));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);

    let query = ctx.supabase
      .from('assets')
      .select(
        `id, file_name, file_type, mime_type, file_size, description, processing_status,
         created_at, created_by, meta_json,
         links:keyword_assets(keyword:keywords(id, title))`,
        { count: 'exact' }
      )
      .eq('organization_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (q) query = query.or(`file_name.ilike.%${q}%,description.ilike.%${q}%`);
    if (VALID_TYPES.includes(type)) query = query.eq('file_type', type);
    if (mine) query = query.eq('created_by', ctx.user.id);

    const { data, error, count } = await query;
    if (error) throw error;

    // assets.created_by has no FK to profiles — resolve uploader names separately
    const uploaderIds = Array.from(
      new Set((data ?? []).map((a: any) => a.created_by).filter(Boolean))
    ) as string[];
    const uploaderById = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const { data: profiles } = await ctx.supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', uploaderIds);
      for (const p of profiles ?? []) uploaderById.set(p.id, p.full_name || p.email);
    }

    let assets = (data ?? []).map((asset: any) => ({
      id: asset.id,
      file_name: asset.file_name,
      file_type: asset.file_type,
      mime_type: asset.mime_type,
      file_size: asset.file_size,
      description: asset.description,
      processing_status: asset.processing_status,
      created_at: asset.created_at,
      created_by: asset.created_by,
      language: asset.meta_json?.language ?? null,
      uploader: asset.created_by ? uploaderById.get(asset.created_by) ?? null : null,
      keywords: (asset.links ?? [])
        .map((l: any) => l.keyword)
        .filter(Boolean) as Array<{ id: string; title: string }>,
    }));

    if (keywordId) {
      assets = assets.filter((a) => a.keywords.some((k) => k.id === keywordId));
    }

    // Restricted workers: only own uploads or files in their assigned branches
    const scope = await personalKeywordScope(ctx);
    if (scope) {
      assets = assets.filter(
        (a) => a.created_by === ctx.user.id || a.keywords.some((k) => scope.has(k.id))
      );
    }

    return NextResponse.json({ data: { assets, total: count ?? assets.length }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to list files');
  }
}
