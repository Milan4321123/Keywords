import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/keywords/[id] - Get a single keyword with relations and assets
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const { id } = await params;

    const { data: keyword, error: keywordError } = await ctx.supabase
      .from('keywords')
      .select('*')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .single();

    if (keywordError) throw keywordError;

    const [{ data: outgoingRelations }, { data: incomingRelations }, { data: keywordAssets }] =
      await Promise.all([
        ctx.supabase
          .from('keyword_relations')
          .select('*, to_keyword:keywords!to_keyword_id(id, title)')
          .eq('from_keyword_id', id)
          .eq('organization_id', ctx.org.id),
        ctx.supabase
          .from('keyword_relations')
          .select('*, from_keyword:keywords!from_keyword_id(id, title)')
          .eq('to_keyword_id', id)
          .eq('organization_id', ctx.org.id),
        ctx.supabase
          .from('keyword_assets')
          .select('*, asset:assets(*)')
          .eq('keyword_id', id),
      ]);

    return NextResponse.json({
      data: {
        ...keyword,
        relations: [...(outgoingRelations || []), ...(incomingRelations || [])],
        assets: keywordAssets?.map((ka) => ka.asset) || [],
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to fetch keyword');
  }
}

// PUT /api/keywords/[id] - Update a keyword
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const { id } = await params;
    const body = await req.json();

    // Never allow tenancy or identity fields through the update payload
    const { organization_id, created_by, id: _id, ...updates } = body as Record<string, any>;

    if (updates.title) {
      updates.slug = updates.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    const { data: keyword, error } = await ctx.supabase
      .from('keywords')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .select()
      .single();

    if (error) throw error;

    await audit(ctx, 'keyword.update', { type: 'keyword', id }, { fields: Object.keys(updates) });

    return NextResponse.json({ data: keyword, error: null });
  } catch (error) {
    return apiError(error, 'Failed to update keyword');
  }
}

// DELETE /api/keywords/[id] - Delete a keyword
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const { id } = await params;

    const { data: existing } = await ctx.supabase
      .from('keywords')
      .select('id, title')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ data: null, error: 'Keyword not found' }, { status: 404 });
    }

    const { error } = await ctx.supabase
      .from('keywords')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.org.id);

    if (error) throw error;

    await audit(ctx, 'keyword.delete', { type: 'keyword', id }, { title: existing.title });

    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to delete keyword');
  }
}
