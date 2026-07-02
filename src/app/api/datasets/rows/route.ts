import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, authErrorResponse } from '@/lib/auth';

export const runtime = 'nodejs';

// POST /api/datasets/rows - Fetch dataset rows by IDs (for evidence/audit trail)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const body = (await req.json()) as { ids?: string[] };
    const ids = body?.ids ?? [];

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ data: [], error: null });
    }

    const limited = ids.slice(0, 50);
    // Join up to the dataset to enforce tenancy on evidence rows
    const { data, error } = await ctx.supabase
      .from('dataset_rows')
      .select('id,dataset_table_id,row_index,data,source_json,created_at,dataset_tables!inner(dataset_id,datasets!inner(organization_id))')
      .eq('dataset_tables.datasets.organization_id', ctx.org.id)
      .in('id', limited);
    if (error) throw error;

    const byId = new Map(
      (data ?? []).map((r: any) => {
        const { dataset_tables, ...row } = r;
        return [row.id, row];
      })
    );
    const ordered = limited.map((id) => byId.get(id)).filter(Boolean);

    return NextResponse.json({ data: ordered, error: null });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json({ data: null, error: authErr.message }, { status: authErr.status });
    }
    console.error('Error fetching dataset rows:', err);
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
    return NextResponse.json({ data: null, error: 'Failed to fetch dataset rows' }, { status: 500 });
  }
}
