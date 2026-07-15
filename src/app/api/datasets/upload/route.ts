import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { requireOrgContext, audit, authErrorResponse } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseWorkbookToDatasetTables } from '@/lib/datasets';
import { fileSizeError } from '@/lib/validation';

export const runtime = 'nodejs';

function guessTitleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(xlsx|xls|csv)$/i, '');
  return base.trim() || 'Dataset';
}

async function insertInChunks(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, any>[],
  chunkSize: number
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

// POST /api/datasets/upload - Upload Excel/CSV as structured tables for analytics
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    enforceRateLimit('upload', ctx.user.id);
    const supabase = ctx.supabase;
    const formData = await req.formData();

    const file = formData.get('file') as File | null;
    const providedTitle = (formData.get('title') as string | null) ?? null;
    const description = (formData.get('description') as string | null) ?? null;

    if (!file) {
      return NextResponse.json({ data: null, error: 'No file provided' }, { status: 400 });
    }

    // Bound memory and parse time before reading the workbook
    const sizeError = fileSizeError(file);
    if (sizeError) {
      return NextResponse.json({ data: null, error: sizeError }, { status: 413 });
    }

    const mimeType = file.type;
    const fileBuffer = await file.arrayBuffer();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const fileNameOnStorage = `${ctx.org.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('assets')
      .upload(fileNameOnStorage, fileBuffer, { contentType: mimeType || 'application/octet-stream' });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('assets').getPublicUrl(fileNameOnStorage);

    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        organization_id: ctx.org.id,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: 'excel',
        mime_type: mimeType || null,
        file_size: file.size,
        processed: true,
        extracted_text: null,
        meta_json: { structured: true },
        created_by: ctx.user.id,
      })
      .select()
      .single();
    if (assetError) throw assetError;

    const tables = parseWorkbookToDatasetTables({
      fileBuffer,
      fileName: file.name,
      assetId: asset.id,
    });
    if (tables.length === 0) {
      return NextResponse.json(
        { data: null, error: 'No usable sheets/tables found in file' },
        { status: 400 }
      );
    }

    const { data: dataset, error: datasetError } = await supabase
      .from('datasets')
      .insert({
        organization_id: ctx.org.id,
        asset_id: asset.id,
        title: providedTitle ?? guessTitleFromFileName(file.name),
        description,
        created_by: ctx.user.id,
      })
      .select()
      .single();
    if (datasetError) throw datasetError;

    for (const t of tables) {
      const { data: table, error: tableError } = await supabase
        .from('dataset_tables')
        .insert({
          dataset_id: dataset.id,
          name: t.name,
          row_count: t.rows.length,
          column_count: t.columns.length,
          meta_json: t.meta_json,
        })
        .select()
        .single();
      if (tableError) throw tableError;

      const columnRows = t.columns.map((c) => ({
        dataset_table_id: table.id,
        name: c.name,
        normalized_name: c.normalized_name,
        data_type: c.data_type,
        sample_values: c.sample_values,
        semantic_name: c.semantic_name,
      }));
      await insertInChunks(supabase, 'dataset_columns', columnRows, 500);

      const rowRows = t.rows.map((r) => ({
        dataset_table_id: table.id,
        row_index: r.row_index,
        data: r.data,
        source_json: r.source_json,
      }));
      await insertInChunks(supabase, 'dataset_rows', rowRows, 500);
    }

    await audit(ctx, 'dataset.import', { type: 'dataset', id: dataset.id }, {
      file_name: file.name,
      tables: tables.length,
      rows: tables.reduce((sum, t) => sum + t.rows.length, 0),
    });

    return NextResponse.json({ data: { dataset, asset }, error: null });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) {
      return NextResponse.json({ data: null, error: authErr.message }, { status: authErr.status });
    }
    console.error('Error uploading dataset:', err);
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
    return NextResponse.json({ data: null, error: 'Failed to upload dataset' }, { status: 500 });
  }
}
