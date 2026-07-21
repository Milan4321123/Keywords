import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, accessibleLevels, audit, roleHasPermission } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { validateAndCoerce } from '@/lib/capture';
import { CaptureField } from '@/lib/capture-types';

export const runtime = 'nodejs';

function fieldsFromColumns(columns: any[]): CaptureField[] {
  return columns.map((col) => {
    const rules = col.validation_rules ?? {};
    const semantic = col.semantic_name ?? null;
    return {
      field: col.normalized_name,
      column_id: col.id ?? null,
      label: col.name,
      data_type: col.data_type,
      semantic,
      required: Boolean(col.is_required),
      description: col.description ?? null,
      options: null,
      multiple: Boolean(rules.multiple),
      min: typeof rules.min === 'number' ? rules.min : null,
      max: typeof rules.max === 'number' ? rules.max : null,
      auto:
        semantic === 'business_date' ? 'today'
        : semantic === 'weekday' ? 'weekday'
        : semantic === 'employee_id' ? 'user'
        : semantic === 'evidence_reference' ? 'evidence'
        : semantic && /timestamp/.test(semantic) && semantic !== 'verification_timestamp' ? 'now'
        : null,
    } as CaptureField;
  });
}

async function loadVisibleTable(ctx: Awaited<ReturnType<typeof requireOrgContext>>, tableId: string) {
  const { data: table, error } = await ctx.supabase
    .from('dataset_tables')
    .select('id, name, dataset:datasets!inner(id, title, organization_id, keyword_id), columns:dataset_columns(*)')
    .eq('id', tableId)
    .eq('dataset.organization_id', ctx.org.id)
    .maybeSingle();
  if (error) throw error;
  if (!table) return null;

  const dataset = (table as any).dataset;
  if (dataset?.keyword_id) {
    const { data: keyword } = await ctx.supabase
      .from('keywords')
      .select('id')
      .eq('id', dataset.keyword_id)
      .eq('organization_id', ctx.org.id)
      .in('access_level', accessibleLevels(ctx.role))
      .maybeSingle();
    if (!keyword) return null;
  }
  return table as any;
}

// GET /api/datasets/rows?table_id=... - latest rows for manual spreadsheet editing
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const url = new URL(req.url);
    const tableId = url.searchParams.get('table_id');
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 250));
    if (!tableId) {
      return NextResponse.json({ data: null, error: 'table_id required' }, { status: 400 });
    }

    const table = await loadVisibleTable(ctx, tableId);
    if (!table) {
      return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('dataset_rows')
      .select('id,dataset_table_id,row_index,data,source_json,created_at')
      .eq('dataset_table_id', tableId)
      .order('row_index', { ascending: false })
      .limit(limit);
    if (error) throw error;

    return NextResponse.json({ data: data ?? [], error: null });
  } catch (error) {
    return apiError(error, 'Failed to list dataset rows');
  }
}

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
  } catch (error) {
    return apiError(error, 'Failed to fetch dataset rows');
  }
}

// PATCH /api/datasets/rows - edit one row after validating against its live schema
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const body = await req.json();
    const rowId = typeof body.row_id === 'string' ? body.row_id : '';
    const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? body.values as Record<string, unknown>
      : null;
    if (!rowId || !values) {
      return NextResponse.json({ data: null, error: 'row_id and values are required' }, { status: 400 });
    }

    const { data: row, error: rowError } = await ctx.supabase
      .from('dataset_rows')
      .select('id, dataset_table_id, row_index, data, source_json')
      .eq('id', rowId)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return NextResponse.json({ data: null, error: 'Row not found' }, { status: 404 });

    const table = await loadVisibleTable(ctx, row.dataset_table_id);
    if (!table) return NextResponse.json({ data: null, error: 'Row not found' }, { status: 404 });

    // Workers may only edit their own records; editors/managers may edit all
    const capturedBy = (row.source_json as any)?.captured_by ?? null;
    if (!roleHasPermission(ctx.role, 'edit_keywords') && capturedBy !== ctx.user.email) {
      return NextResponse.json(
        { data: null, error: 'Nur eigene Einträge bearbeitbar · You can only edit your own records' },
        { status: 403 }
      );
    }

    const fields = fieldsFromColumns(table.columns ?? []);
    const existing = (row.data ?? {}) as Record<string, unknown>;
    const merged = { ...existing, ...values };
    const userField = fields.find((field) => field.auto === 'user');
    const evidenceField = fields.find((field) => field.auto === 'evidence');
    const result = validateAndCoerce(fields, merged, {
      userEmail:
        userField && typeof existing[userField.field] === 'string'
          ? String(existing[userField.field])
          : ctx.user.email,
      evidenceReference:
        evidenceField && typeof existing[evidenceField.field] === 'string'
          ? String(existing[evidenceField.field])
          : null,
    });
    if (!result.ok) {
      return NextResponse.json({ data: null, error: result.errors.join(' · ') }, { status: 400 });
    }

    const { data: updated, error: updateError } = await ctx.supabase
      .from('dataset_rows')
      .update({
        data: result.data,
        source_json: {
          ...((row.source_json ?? {}) as Record<string, unknown>),
          edited_by: ctx.user.email,
          edited_at: new Date().toISOString(),
        },
      })
      .eq('id', rowId)
      .eq('dataset_table_id', table.id)
      .select('id,dataset_table_id,row_index,data,source_json,created_at')
      .single();
    if (updateError) throw updateError;

    await audit(ctx, 'dataset_row.update', { type: 'dataset_row', id: rowId }, {
      table: table.name,
      row_index: row.row_index,
      fields: Object.keys(values),
    });
    return NextResponse.json({ data: updated, error: null });
  } catch (error) {
    return apiError(error, 'Failed to update dataset row');
  }
}

// DELETE /api/datasets/rows?row_id= — remove one record.
// Workers may delete their own records; editors/managers any record.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const rowId = new URL(req.url).searchParams.get('row_id');
    if (!rowId) {
      return NextResponse.json({ data: null, error: 'row_id required' }, { status: 400 });
    }

    const { data: row, error: rowError } = await ctx.supabase
      .from('dataset_rows')
      .select('id, dataset_table_id, row_index, source_json')
      .eq('id', rowId)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return NextResponse.json({ data: null, error: 'Row not found' }, { status: 404 });

    const table = await loadVisibleTable(ctx, row.dataset_table_id);
    if (!table) return NextResponse.json({ data: null, error: 'Row not found' }, { status: 404 });

    const capturedBy = (row.source_json as any)?.captured_by ?? null;
    if (!roleHasPermission(ctx.role, 'edit_keywords') && capturedBy !== ctx.user.email) {
      return NextResponse.json(
        { data: null, error: 'Nur eigene Einträge löschbar · You can only delete your own records' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await ctx.supabase
      .from('dataset_rows')
      .delete()
      .eq('id', rowId)
      .eq('dataset_table_id', table.id);
    if (deleteError) throw deleteError;

    const { count } = await ctx.supabase
      .from('dataset_rows')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_table_id', table.id);
    if (typeof count === 'number') {
      await ctx.supabase.from('dataset_tables').update({ row_count: count }).eq('id', table.id);
    }

    await audit(ctx, 'dataset_row.delete', { type: 'dataset_row', id: rowId }, {
      table: table.name,
      row_index: row.row_index,
    });
    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to delete dataset row');
  }
}
