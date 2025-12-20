import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const runtime = 'nodejs';

function isoDate(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function isoMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function pick<T>(arr: T[], idx: number): T {
  return arr[idx % arr.length];
}

async function insertInChunks<T extends Record<string, any>>(
  supabase: ReturnType<typeof createServerClient>,
  table: string,
  rows: T[],
  chunkSize: number
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

// POST /api/datasets/demo - Create a demo dataset/table with sample project data
export async function POST(_req: NextRequest) {
  try {
    const supabase = createServerClient();

    const { data: dataset, error: datasetError } = await supabase
      .from('datasets')
      .insert({
        asset_id: null,
        title: 'Demo: Project Operations',
        description: 'Seeded demo data for testing grounded analytics chat (projects, trades, invoices, approval delays).',
      })
      .select()
      .single();
    if (datasetError) throw datasetError;

    const tableName = 'invoices';
    const { data: table, error: tableError } = await supabase
      .from('dataset_tables')
      .insert({
        dataset_id: dataset.id,
        name: tableName,
        row_count: 240,
        column_count: 12,
        meta_json: { seeded: true, table_kind: 'invoice_fact' },
      })
      .select()
      .single();
    if (tableError) throw tableError;

    const columns = [
      { name: 'Project', normalized_name: 'project', data_type: 'text', sample_values: ['Riverside Tower', 'Central Plaza'] },
      { name: 'Trade', normalized_name: 'trade', data_type: 'text', sample_values: ['Electrical', 'Plumbing', 'HVAC', 'Drywall'] },
      { name: 'Supplier', normalized_name: 'supplier', data_type: 'text', sample_values: ['Volt GmbH', 'PipeWorks AG', 'CoolAir KG'] },
      { name: 'Invoice Number', normalized_name: 'invoice_number', data_type: 'text', sample_values: ['INV-10021', 'INV-10022'] },
      { name: 'Invoice Date', normalized_name: 'invoice_date', data_type: 'date', sample_values: ['2025-10-14T00:00:00.000Z'] },
      { name: 'Invoice Month', normalized_name: 'invoice_month', data_type: 'text', sample_values: ['2025-10', '2025-11'] },
      { name: 'Amount', normalized_name: 'amount', data_type: 'number', sample_values: ['1250', '9800'] },
      { name: 'Currency', normalized_name: 'currency', data_type: 'text', sample_values: ['EUR'] },
      { name: 'Status', normalized_name: 'status', data_type: 'text', sample_values: ['paid', 'unpaid'] },
      { name: 'Submitted At', normalized_name: 'submitted_at', data_type: 'date', sample_values: ['2025-10-15T00:00:00.000Z'] },
      { name: 'Approved At', normalized_name: 'approved_at', data_type: 'date', sample_values: ['2025-10-18T00:00:00.000Z'] },
      { name: 'Approval Time Hours', normalized_name: 'approval_time_hours', data_type: 'number', sample_values: ['24', '72'] },
    ];

    await insertInChunks(
      supabase,
      'dataset_columns',
      columns.map((c) => ({ ...c, dataset_table_id: table.id })),
      500
    );

    const projects = ['Riverside Tower', 'Central Plaza'];
    const trades = ['Electrical', 'Plumbing', 'HVAC', 'Drywall'];
    const suppliers = ['Volt GmbH', 'PipeWorks AG', 'CoolAir KG', 'WallCraft GmbH', 'BuildPro AG'];
    const currency = 'EUR';

    const start = new Date(Date.UTC(2025, 7, 1)); // 2025-08-01
    const rows: Array<{ dataset_table_id: string; row_index: number; data: any; source_json: any }> = [];

    for (let i = 0; i < 240; i++) {
      const project = pick(projects, i);
      const trade = pick(trades, i + (project === 'Riverside Tower' ? 0 : 1));
      const supplier = pick(suppliers, i + trade.length);

      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + i);

      const baseAmount = 800 + ((i * 137) % 9000);
      const tradeMultiplier = trade === 'HVAC' ? 1.4 : trade === 'Electrical' ? 1.2 : 1.0;
      const projectMultiplier = project === 'Riverside Tower' ? 1.15 : 1.0;
      const amount = Math.round(baseAmount * tradeMultiplier * projectMultiplier);

      const approvalHoursBase = 12 + ((i * 11) % 160);
      const delayPenalty = supplier.includes('BuildPro') ? 24 : 0;
      const approval_time_hours = Math.round(approvalHoursBase + delayPenalty);

      const submitted = new Date(date);
      submitted.setUTCDate(submitted.getUTCDate() + 1);
      const approved = new Date(submitted);
      approved.setUTCHours(approved.getUTCHours() + approval_time_hours);

      const status = i % 5 === 0 ? 'unpaid' : 'paid';

      rows.push({
        dataset_table_id: table.id,
        row_index: i + 1,
        data: {
          project,
          trade,
          supplier,
          invoice_number: `INV-${10000 + i}`,
          invoice_date: isoDate(date),
          invoice_month: isoMonth(date),
          amount,
          currency,
          status,
          submitted_at: isoDate(submitted),
          approved_at: isoDate(approved),
          approval_time_hours,
        },
        source_json: {
          seeded: true,
          generator: 'datasets/demo',
          logical_source: 'demo',
        },
      });
    }

    await insertInChunks(supabase, 'dataset_rows', rows, 500);

    return NextResponse.json({ data: { dataset, table_id: table.id }, error: null });
  } catch (err) {
    console.error('Error creating demo dataset:', err);
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
    return NextResponse.json({ data: null, error: 'Failed to create demo dataset' }, { status: 500 });
  }
}
