import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';

// POST /api/datasets/rows - Fetch dataset rows by IDs (for evidence/audit trail)
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = (await req.json()) as { ids?: string[] };
    const ids = body?.ids ?? [];

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ data: [], error: null });
    }

    const limited = ids.slice(0, 50);
    const { data, error } = await supabase
      .from('dataset_rows')
      .select('id,dataset_table_id,row_index,data,source_json,created_at')
      .in('id', limited);
    if (error) throw error;

    const byId = new Map((data ?? []).map((r: any) => [r.id, r]));
    const ordered = limited.map((id) => byId.get(id)).filter(Boolean);

    return NextResponse.json({ data: ordered, error: null });
  } catch (err) {
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
