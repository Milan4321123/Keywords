import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { recomputeKeywordCompleteness } from '@/lib/ontology/completeness';

type RouteParams = { params: Promise<{ id: string }> };

const UPDATABLE_FIELDS = [
  'title', 'definition', 'explanation', 'examples', 'synonyms', 'rules',
  'labels_json', 'parent_id', 'icon', 'color', 'sort_order',
  'keyword_type', 'status', 'owner_member_id',
] as const;

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
    const body = (await req.json()) as Record<string, any>;

    // Whitelist: tenancy, identity, and computed fields never come from the payload
    const updates: Record<string, any> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }

    if (updates.title) {
      updates.slug = updates.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // A keyword cannot be its own parent
    if (updates.parent_id === id) {
      return NextResponse.json({ data: null, error: 'A keyword cannot be its own parent' }, { status: 400 });
    }

    const { data: keyword, error } = await ctx.supabase
      .from('keywords')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .select()
      .single();

    if (error) throw error;

    // Attribute the version snapshot the trigger just created to this user
    const { data: latestVersion } = await ctx.supabase
      .from('keyword_versions')
      .select('id')
      .eq('keyword_id', id)
      .is('changed_by', null)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestVersion) {
      await ctx.supabase
        .from('keyword_versions')
        .update({ changed_by: ctx.user.id })
        .eq('id', latestVersion.id);
    }

    const newScore = await recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, id);
    if (newScore !== null) keyword.completeness_score = newScore;

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
