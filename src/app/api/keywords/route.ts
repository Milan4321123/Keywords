import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

// GET /api/keywords - Get all keywords for the active organization
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');

    const { data: keywords, error } = await ctx.supabase
      .from('keywords')
      .select('*')
      .eq('organization_id', ctx.org.id)
      .order('sort_order')
      .order('title');

    if (error) throw error;

    return NextResponse.json({ data: keywords, error: null });
  } catch (error) {
    return apiError(error, 'Failed to fetch keywords');
  }
}

// POST /api/keywords - Create a new keyword
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const body = await req.json();

    if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
      return NextResponse.json(
        { data: null, error: 'Title is required' },
        { status: 400 }
      );
    }

    const slug = body.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `keyword-${Date.now()}`;

    // Parent must belong to the same organization
    if (body.parent_id) {
      const { data: parent } = await ctx.supabase
        .from('keywords')
        .select('id')
        .eq('id', body.parent_id)
        .eq('organization_id', ctx.org.id)
        .maybeSingle();
      if (!parent) {
        return NextResponse.json({ data: null, error: 'Parent keyword not found' }, { status: 400 });
      }
    }

    const { data: keyword, error } = await ctx.supabase
      .from('keywords')
      .insert({
        organization_id: ctx.org.id,
        title: body.title,
        slug: slug,
        parent_id: body.parent_id || null,
        definition: body.definition || null,
        explanation: body.explanation || null,
        examples: body.examples || [],
        synonyms: body.synonyms || [],
        labels_json: body.labels_json || {},
        rules: body.rules || [],
        icon: body.icon || null,
        color: body.color || null,
        sort_order: body.sort_order || 0,
        created_by: ctx.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    await audit(ctx, 'keyword.create', { type: 'keyword', id: keyword.id }, { title: keyword.title });

    return NextResponse.json({ data: keyword, error: null });
  } catch (error) {
    return apiError(error, 'Failed to create keyword');
  }
}
