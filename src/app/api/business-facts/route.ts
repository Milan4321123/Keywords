import { NextRequest, NextResponse } from 'next/server';
import { audit, requireOrgContext } from '@/lib/auth';
import { apiError } from '@/lib/api';

const DATA_TYPES = ['text','number','date','datetime','boolean','currency','percentage','json'];
const TRUTH_STATUSES = ['verified','approved','derived','asserted','disputed'];
const SOURCE_TYPES = ['manual','dataset','document','metric','integration','ai_extraction','calculation'];

function textValue(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

async function ownedObject(ctx: any, objectId: string) {
  const { data } = await ctx.supabase
    .from('business_objects')
    .select('id')
    .eq('organization_id', ctx.org.id)
    .eq('id', objectId)
    .maybeSingle();
  return Boolean(data);
}

// GET /api/business-facts?object_id=&history=true
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const params = new URL(req.url).searchParams;
    const objectId = params.get('object_id');
    if (!objectId || !(await ownedObject(ctx, objectId))) {
      return NextResponse.json({ data: null, error: 'object_id not found' }, { status: 404 });
    }
    const history = params.get('history') === 'true';
    const table = history ? 'business_facts' : 'current_business_facts';
    const { data, error } = await ctx.supabase
      .from(table)
      .select('*')
      .eq('organization_id', ctx.org.id)
      .eq('object_id', objectId)
      .order(history ? 'valid_from' : 'fact_key', { ascending: history ? false : true })
      .limit(500);
    if (error) throw error;
    return NextResponse.json({ data: data ?? [], error: null });
  } catch (error) {
    return apiError(error, 'Failed to list business facts');
  }
}

// POST replaces the current value by closing its validity window and appending
// a new sourced fact. History is never overwritten.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const body = await req.json();
    const objectId = textValue(body.object_id, 80);
    const factKey = textValue(body.fact_key, 120)?.toLowerCase().replace(/[^a-z0-9_\-.]/g, '_');
    if (!objectId || !factKey || !('value' in body)) {
      return NextResponse.json({ data: null, error: 'object_id, fact_key, and value are required' }, { status: 400 });
    }
    if (!(await ownedObject(ctx, objectId))) {
      return NextResponse.json({ data: null, error: 'object_id not found' }, { status: 404 });
    }
    const dataType = DATA_TYPES.includes(body.data_type) ? body.data_type : 'text';
    const truthStatus = TRUTH_STATUSES.includes(body.truth_status) ? body.truth_status : 'asserted';
    const sourceType = SOURCE_TYPES.includes(body.source_type) ? body.source_type : 'manual';
    const derivation = textValue(body.derivation, 2000);
    if (truthStatus === 'derived' && !derivation) {
      return NextResponse.json({ data: null, error: 'Derived facts require a derivation' }, { status: 400 });
    }
    const validFrom = body.valid_from ? new Date(body.valid_from) : new Date();
    if (Number.isNaN(validFrom.getTime())) {
      return NextResponse.json({ data: null, error: 'valid_from must be a valid date' }, { status: 400 });
    }
    const timestamp = validFrom.toISOString();

    // Supabase REST has no multi-statement transaction here. Closing and insert
    // are ordered; if insert fails the full history still preserves the old fact.
    const closeResult = await ctx.supabase
      .from('business_facts')
      .update({ valid_to: timestamp })
      .eq('organization_id', ctx.org.id)
      .eq('object_id', objectId)
      .eq('fact_key', factKey)
      .is('valid_to', null)
      .neq('truth_status', 'disputed')
      .lt('valid_from', timestamp);
    if (closeResult.error) throw closeResult.error;

    const confidence = typeof body.confidence === 'number'
      ? Math.min(1, Math.max(0, body.confidence))
      : null;
    const { data, error } = await ctx.supabase
      .from('business_facts')
      .insert({
        organization_id: ctx.org.id,
        object_id: objectId,
        fact_key: factKey,
        value: body.value,
        data_type: dataType,
        unit: textValue(body.unit, 40),
        valid_from: timestamp,
        truth_status: truthStatus,
        confidence,
        source_type: sourceType,
        source_asset_id: textValue(body.source_asset_id, 80),
        source_table_id: textValue(body.source_table_id, 80),
        source_row_id: textValue(body.source_row_id, 80),
        source_metric_id: textValue(body.source_metric_id, 80),
        derivation,
        note: textValue(body.note, 2000),
        created_by: ctx.user.id,
      })
      .select()
      .single();
    if (error) throw error;
    await audit(ctx, 'business_fact.append', { type: 'business_object', id: objectId }, {
      fact_key: factKey,
      truth_status: truthStatus,
      source_type: sourceType,
    });
    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (error) {
    return apiError(error, 'Failed to append business fact');
  }
}

