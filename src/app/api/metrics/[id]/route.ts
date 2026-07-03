import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

type RouteParams = { params: Promise<{ id: string }> };

const UPDATABLE = [
  'keyword_id', 'name', 'description', 'formula', 'aggregation', 'source_table_id',
  'value_column', 'date_column', 'dimensions', 'filters', 'time_grain', 'caveats',
] as const;

// GET /api/metrics/[id]
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('metrics')
      .select('*, keyword:keywords(id, title), source_table:dataset_tables(id, name, columns:dataset_columns(name, normalized_name, data_type, semantic_name))')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ data: null, error: 'Metric not found' }, { status: 404 });
    return NextResponse.json({ data, error: null });
  } catch (error) {
    return apiError(error, 'Failed to fetch metric');
  }
}

// PATCH /api/metrics/[id] - Update with version snapshot
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('generate_reports');
    const { id } = await params;
    const body = await req.json();

    const { data: existing, error: exErr } = await ctx.supabase
      .from('metrics')
      .select('*')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) return NextResponse.json({ data: null, error: 'Metric not found' }, { status: 404 });

    const updates: Record<string, any> = {};
    for (const field of UPDATABLE) {
      if (field in body) updates[field] = body[field];
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ data: null, error: 'No updatable fields' }, { status: 400 });
    }

    // Version snapshot before the change — metric meaning changes over time
    const { data: lastVersion } = await ctx.supabase
      .from('metric_versions')
      .select('version_no')
      .eq('metric_id', id)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    await ctx.supabase.from('metric_versions').insert({
      metric_id: id,
      organization_id: ctx.org.id,
      version_no: (lastVersion?.version_no ?? 0) + 1,
      snapshot: existing,
      changed_by: ctx.user.id,
    });

    const { data: updated, error } = await ctx.supabase
      .from('metrics')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .select()
      .single();
    if (error) throw error;

    await audit(ctx, 'metric.update', { type: 'metric', id }, { fields: Object.keys(updates) });
    return NextResponse.json({ data: updated, error: null });
  } catch (error) {
    return apiError(error, 'Failed to update metric');
  }
}

// DELETE /api/metrics/[id]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('generate_reports');
    const { id } = await params;
    const { error } = await ctx.supabase
      .from('metrics')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.org.id);
    if (error) throw error;
    await audit(ctx, 'metric.delete', { type: 'metric', id });
    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to delete metric');
  }
}
