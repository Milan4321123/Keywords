import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { runTableQuery, TableQuerySpec } from '@/lib/analytics';
import { AnalyticsTableQueryRequest } from '@/types';

export const runtime = 'nodejs';

async function fetchRows(params: {
  supabase: ReturnType<typeof createServerClient>;
  datasetTableId: string;
  maxRows: number;
}) {
  const out: Array<{ id: string; row_index: number; data: Record<string, unknown>; source_json: Record<string, unknown> }> = [];
  const pageSize = 1000;
  for (let offset = 0; offset < params.maxRows; offset += pageSize) {
    const { data, error } = await params.supabase
      .from('dataset_rows')
      .select('id,row_index,data,source_json')
      .eq('dataset_table_id', params.datasetTableId)
      .order('row_index', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as any[];
    out.push(
      ...chunk.map((r) => ({
        id: r.id,
        row_index: r.row_index,
        data: r.data ?? {},
        source_json: r.source_json ?? {},
      }))
    );
    if (chunk.length < pageSize) break;
  }
  return out;
}

// POST /api/analytics/query - Compute aggregations over structured dataset rows (with evidence row IDs)
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = (await req.json()) as AnalyticsTableQueryRequest;

    if (!body?.dataset_table_id) {
      return NextResponse.json({ error: 'dataset_table_id is required' }, { status: 400 });
    }
    if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
      return NextResponse.json({ error: 'metrics[] is required' }, { status: 400 });
    }

    const maxRows = Math.min(Math.max(body.max_rows ?? 10_000, 1), 50_000);

    const { data: table, error: tableError } = await supabase
      .from('dataset_tables')
      .select(
        `
        *,
        dataset:datasets(*, asset:assets(*)),
        columns:dataset_columns(*)
      `
      )
      .eq('id', body.dataset_table_id)
      .single();
    if (tableError) throw tableError;
    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 });
    }

    const rows = await fetchRows({ supabase, datasetTableId: body.dataset_table_id, maxRows });
    const spec: TableQuerySpec = {
      filters: body.filters,
      group_by: body.group_by,
      metrics: body.metrics,
      order_by: body.order_by,
      limit: body.limit,
      evidence_limit: body.evidence_limit,
    };

    const result = runTableQuery(rows, spec);

    return NextResponse.json({
      table,
      query: {
        filters: spec.filters ?? [],
        group_by: spec.group_by ?? [],
        metrics: spec.metrics,
        order_by: spec.order_by ?? [],
        limit: spec.limit ?? 100,
        evidence_limit: spec.evidence_limit ?? 25,
        max_rows: maxRows,
      },
      result,
    });
  } catch (err) {
    console.error('Error running analytics query:', err);
    const anyErr = err as any;
    if (anyErr?.code === 'PGRST205') {
      return NextResponse.json(
        {
          error:
            "Missing analytics tables in Supabase. Run the updated `supabase/schema.sql` (the 'DATASETS' section) in Supabase SQL Editor, then refresh the API schema.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'Failed to run analytics query' }, { status: 500 });
  }
}
