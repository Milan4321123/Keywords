import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// GET /api/datasets - List datasets with tables/columns
export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('datasets')
      .select(`
        *,
        asset:assets(*),
        tables:dataset_tables(
          *,
          columns:dataset_columns(*)
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ data: data ?? [], error: null });
  } catch (err) {
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
