import { NextRequest, NextResponse } from 'next/server';
import { audit, requireOrgContext } from '@/lib/auth';
import { apiError } from '@/lib/api';

const MAX_PAGE_SIZE = 200;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result ? result.slice(0, max) : null;
}

async function keywordBelongsToOrg(supabase: any, organizationId: string, keywordId: string | null) {
  if (!keywordId) return true;
  const { data } = await supabase
    .from('keywords')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('id', keywordId)
    .maybeSingle();
  return Boolean(data);
}

// GET /api/business-objects?type=project&status=active&q=atlas&id=
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const params = new URL(req.url).searchParams;
    const id = params.get('id');
    const objectType = cleanText(params.get('type'), 80);
    const status = cleanText(params.get('status'), 80);
    const q = cleanText(params.get('q'), 120);
    const requestedLimit = Number(params.get('limit') ?? 100);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(requestedLimit)))
      : 100;

    let query = ctx.supabase
      .from('business_objects')
      .select('*')
      .eq('organization_id', ctx.org.id)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (id) query = query.eq('id', id);
    if (objectType) query = query.eq('object_type', objectType);
    if (status) query = query.eq('status', status);
    if (q) query = query.ilike('display_name', `%${q.replace(/[%_]/g, '')}%`);

    const { data: objects, error } = await query;
    if (error) throw error;
    const objectIds = (objects ?? []).map((object: any) => object.id);
    let facts: any[] = [];
    if (objectIds.length > 0) {
      const factsResult = await ctx.supabase
        .from('current_business_facts')
        .select('*')
        .eq('organization_id', ctx.org.id)
        .in('object_id', objectIds)
        .order('fact_key');
      if (factsResult.error) throw factsResult.error;
      facts = factsResult.data ?? [];
    }
    const factsByObject = new Map<string, any[]>();
    for (const fact of facts) {
      const current = factsByObject.get(fact.object_id) ?? [];
      current.push(fact);
      factsByObject.set(fact.object_id, current);
    }
    const enriched = (objects ?? []).map((object: any) => ({
      ...object,
      facts: factsByObject.get(object.id) ?? [],
    }));
    return NextResponse.json({ data: id ? enriched[0] ?? null : enriched, error: null });
  } catch (error) {
    return apiError(error, 'Failed to list business objects');
  }
}

// POST /api/business-objects
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const body = await req.json();
    const displayName = cleanText(body.display_name, 240);
    const objectType = cleanText(body.object_type, 80)?.toLowerCase().replace(/\s+/g, '_');
    if (!displayName || !objectType) {
      return NextResponse.json(
        { data: null, error: 'display_name and object_type are required' },
        { status: 400 }
      );
    }
    const keywordId = cleanText(body.canonical_keyword_id, 80);
    if (!(await keywordBelongsToOrg(ctx.supabase, ctx.org.id, keywordId))) {
      return NextResponse.json({ data: null, error: 'canonical_keyword_id not found' }, { status: 400 });
    }
    const attributes = body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)
      ? body.attributes
      : {};
    const { data, error } = await ctx.supabase
      .from('business_objects')
      .insert({
        organization_id: ctx.org.id,
        object_type: objectType,
        external_key: cleanText(body.external_key, 160),
        display_name: displayName,
        description: cleanText(body.description, 4000),
        status: cleanText(body.status, 80) ?? 'active',
        canonical_keyword_id: keywordId,
        attributes,
        created_by: ctx.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    await audit(ctx, 'business_object.create', { type: 'business_object', id: data.id }, {
      object_type: objectType,
      display_name: displayName,
    });
    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (error) {
    return apiError(error, 'Failed to create business object');
  }
}

// PATCH /api/business-objects  { object_id, ...fields }
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const body = await req.json();
    const objectId = cleanText(body.object_id, 80);
    if (!objectId) {
      return NextResponse.json({ data: null, error: 'object_id is required' }, { status: 400 });
    }
    const updates: Record<string, unknown> = {};
    if ('display_name' in body) {
      const value = cleanText(body.display_name, 240);
      if (!value) return NextResponse.json({ data: null, error: 'display_name cannot be empty' }, { status: 400 });
      updates.display_name = value;
    }
    if ('description' in body) updates.description = cleanText(body.description, 4000);
    if ('external_key' in body) updates.external_key = cleanText(body.external_key, 160);
    if ('status' in body) updates.status = cleanText(body.status, 80) ?? 'active';
    if ('attributes' in body && body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)) {
      updates.attributes = body.attributes;
    }
    if ('canonical_keyword_id' in body) {
      const keywordId = cleanText(body.canonical_keyword_id, 80);
      if (!(await keywordBelongsToOrg(ctx.supabase, ctx.org.id, keywordId))) {
        return NextResponse.json({ data: null, error: 'canonical_keyword_id not found' }, { status: 400 });
      }
      updates.canonical_keyword_id = keywordId;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ data: null, error: 'No updatable fields' }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from('business_objects')
      .update(updates)
      .eq('id', objectId)
      .eq('organization_id', ctx.org.id)
      .select()
      .single();
    if (error) throw error;
    await audit(ctx, 'business_object.update', { type: 'business_object', id: objectId }, {
      fields: Object.keys(updates),
    });
    return NextResponse.json({ data, error: null });
  } catch (error) {
    return apiError(error, 'Failed to update business object');
  }
}

