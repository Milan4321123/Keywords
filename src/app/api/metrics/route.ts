import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

const VALID_AGGREGATIONS = ['count', 'sum', 'avg', 'min', 'max'];
const VALID_GRAINS = ['day', 'month', 'quarter', 'year'];

// GET /api/metrics - Metric catalog
export async function GET() {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const { data, error } = await ctx.supabase
      .from('metrics')
      .select('*, keyword:keywords(id, title), source_table:dataset_tables(id, name, dataset:datasets(title))')
      .eq('organization_id', ctx.org.id)
      .order('name');
    if (error) throw error;
    return NextResponse.json({ data: data ?? [], error: null });
  } catch (error) {
    return apiError(error, 'Failed to list metrics');
  }
}

// POST /api/metrics - Create a metric definition
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('generate_reports');
    const body = await req.json();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ data: null, error: 'name is required' }, { status: 400 });
    }

    if (body.source_table_id) {
      const { data: table } = await ctx.supabase
        .from('dataset_tables')
        .select('id, datasets!inner(organization_id)')
        .eq('id', body.source_table_id)
        .eq('datasets.organization_id', ctx.org.id)
        .maybeSingle();
      if (!table) {
        return NextResponse.json({ data: null, error: 'Source table not found' }, { status: 400 });
      }
    }
    if (body.keyword_id) {
      const { data: keyword } = await ctx.supabase
        .from('keywords')
        .select('id')
        .eq('id', body.keyword_id)
        .eq('organization_id', ctx.org.id)
        .maybeSingle();
      if (!keyword) {
        return NextResponse.json({ data: null, error: 'Keyword not found' }, { status: 400 });
      }
    }

    const { data: metric, error } = await ctx.supabase
      .from('metrics')
      .insert({
        organization_id: ctx.org.id,
        keyword_id: body.keyword_id || null,
        name,
        description: body.description || null,
        formula: body.formula || null,
        aggregation: VALID_AGGREGATIONS.includes(body.aggregation) ? body.aggregation : 'sum',
        source_table_id: body.source_table_id || null,
        value_column: body.value_column || null,
        date_column: body.date_column || null,
        dimensions: Array.isArray(body.dimensions) ? body.dimensions : [],
        filters: Array.isArray(body.filters) ? body.filters : [],
        time_grain: VALID_GRAINS.includes(body.time_grain) ? body.time_grain : 'month',
        caveats: body.caveats || null,
        owner_member_id: ctx.memberId,
      })
      .select()
      .single();
    if (error) throw error;

    await audit(ctx, 'metric.create', { type: 'metric', id: metric.id }, { name });
    return NextResponse.json({ data: metric, error: null });
  } catch (error) {
    return apiError(error, 'Failed to create metric');
  }
}
