import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, authErrorResponse } from '@/lib/auth';

// GET /api/datasets - List datasets with tables/columns
export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_datasets');

    const { data, error } = await ctx.supabase
      .from('datasets')
      .select(`
        *,
        asset:assets(*),
        tables:dataset_tables(
          *,
          columns:dataset_columns(*)
        )
      `)
      .eq('organization_id', ctx.org.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ data: data ?? [], error: null });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json({ data: null, error: authErr.message }, { status: authErr.status });
    }
    console.error('Error listing datasets:', err);
    const anyErr = err as any;
    if (anyErr?.code === 'PGRST205') {
      return NextResponse.json(
        {
          data: null,
          error:
            "Missing analytics tables in Supabase. Run the updated `supabase/schema.sql` (the 'DATASETS' section) in Supabase SQL Editor, then refresh the API schema.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ data: null, error: 'Failed to list datasets' }, { status: 500 });
  }
}
