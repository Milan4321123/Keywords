import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { recomputeKeywordCompleteness } from '@/lib/ontology/completeness';

// GET /api/relations - Get all relations (optionally filtered)
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const { searchParams } = new URL(req.url);
    const keywordId = searchParams.get('keyword_id');

    let query = ctx.supabase
      .from('keyword_relations')
      .select(`
        *,
        from_keyword:keywords!from_keyword_id(id, title, slug),
        to_keyword:keywords!to_keyword_id(id, title, slug)
      `)
      .eq('organization_id', ctx.org.id);

    if (keywordId) {
      query = query.or(`from_keyword_id.eq.${keywordId},to_keyword_id.eq.${keywordId}`);
    }

    const { data: relations, error } = await query;

    if (error) throw error;

    return NextResponse.json({ data: relations, error: null });
  } catch (error) {
    return apiError(error, 'Failed to fetch relations');
  }
}

// POST /api/relations - Create a new relation
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const body = await req.json();

    if (!body.from_keyword_id || !body.to_keyword_id || !body.relation_type) {
      return NextResponse.json(
        { data: null, error: 'from_keyword_id, to_keyword_id and relation_type are required' },
        { status: 400 }
      );
    }

    // Both endpoints must belong to the active organization
    const { data: endpoints, error: endpointError } = await ctx.supabase
      .from('keywords')
      .select('id')
      .eq('organization_id', ctx.org.id)
      .in('id', [body.from_keyword_id, body.to_keyword_id]);
    if (endpointError) throw endpointError;
    if ((endpoints ?? []).length !== 2) {
      return NextResponse.json(
        { data: null, error: 'Both keywords must exist in your organization' },
        { status: 400 }
      );
    }

    const { data: relation, error } = await ctx.supabase
      .from('keyword_relations')
      .insert({
        organization_id: ctx.org.id,
        from_keyword_id: body.from_keyword_id,
        relation_type: body.relation_type,
        to_keyword_id: body.to_keyword_id,
        note: body.note || null,
        strength: body.strength || 5,
        bidirectional: body.bidirectional || false,
      })
      .select(`
        *,
        from_keyword:keywords!from_keyword_id(id, title),
        to_keyword:keywords!to_keyword_id(id, title)
      `)
      .single();

    if (error) throw error;

    // If bidirectional, create the reverse relation too
    if (body.bidirectional) {
      await ctx.supabase.from('keyword_relations').insert({
        organization_id: ctx.org.id,
        from_keyword_id: body.to_keyword_id,
        relation_type: body.relation_type,
        to_keyword_id: body.from_keyword_id,
        note: body.note || null,
        strength: body.strength || 5,
        bidirectional: true,
      });
    }

    await audit(ctx, 'relation.create', { type: 'relation', id: relation.id }, {
      relation_type: body.relation_type,
    });

    await Promise.all([
      recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, body.from_keyword_id),
      recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, body.to_keyword_id),
    ]);

    return NextResponse.json({ data: relation, error: null });
  } catch (error) {
    return apiError(error, 'Failed to create relation');
  }
}

// DELETE /api/relations - Delete a relation by ID
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { data: null, error: 'Relation ID required' },
        { status: 400 }
      );
    }

    const { data: existing } = await ctx.supabase
      .from('keyword_relations')
      .select('from_keyword_id, to_keyword_id')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();

    const { error } = await ctx.supabase
      .from('keyword_relations')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.org.id);

    if (error) throw error;

    // Attribute the deletion snapshot the trigger just created to this user.
    // Non-fatal: tolerates databases where migration 0004 isn't applied yet.
    try {
      const { data: latestVersion } = await ctx.supabase
        .from('keyword_relation_versions')
        .select('id')
        .eq('relation_id', id)
        .is('changed_by', null)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestVersion) {
        await ctx.supabase
          .from('keyword_relation_versions')
          .update({ changed_by: ctx.user.id })
          .eq('id', latestVersion.id);
      }
    } catch {
      // versioning table missing — snapshot attribution skipped
    }

    await audit(ctx, 'relation.delete', { type: 'relation', id });

    if (existing) {
      await Promise.all([
        recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, existing.from_keyword_id),
        recomputeKeywordCompleteness(ctx.supabase, ctx.org.id, existing.to_keyword_id),
      ]);
    }

    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to delete relation');
  }
}
