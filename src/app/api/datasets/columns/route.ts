import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit, roleHasPermission } from '@/lib/auth';
import { apiError } from '@/lib/api';

// PATCH /api/datasets/columns - Update semantic mapping for a column.
// Everyone with upload rights may APPEND a dropdown option (add_option);
// all other schema edits require keyword-edit rights.
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('upload_assets');
    const body = await req.json();
    const { column_id } = body;

    if (!column_id) {
      return NextResponse.json({ data: null, error: 'column_id required' }, { status: 400 });
    }

    // Tenancy check via table → dataset
    const { data: column } = await ctx.supabase
      .from('dataset_columns')
      .select('id, validation_rules, dataset_tables!inner(id, datasets!inner(organization_id))')
      .eq('id', column_id)
      .eq('dataset_tables.datasets.organization_id', ctx.org.id)
      .maybeSingle();
    if (!column) {
      return NextResponse.json({ data: null, error: 'Column not found' }, { status: 404 });
    }

    // Worker-safe path: extend the reusable dropdown list by one value
    if (typeof body.add_option === 'string' && body.add_option.trim()) {
      const option = body.add_option.trim().slice(0, 80);
      const rules = ((column as any).validation_rules ?? {}) as Record<string, any>;
      const existing: string[] = Array.isArray(rules.options)
        ? rules.options.map((o: unknown) => String(o))
        : [];
      if (!existing.some((o) => o.toLowerCase() === option.toLowerCase())) {
        const nextRules = { ...rules, options: [...existing, option].slice(0, 50) };
        const { error } = await ctx.supabase
          .from('dataset_columns')
          .update({ validation_rules: nextRules })
          .eq('id', column_id);
        if (error) throw error;
        await audit(ctx, 'dataset.column_option_add', { type: 'dataset_column', id: column_id }, { option });
      }
      return NextResponse.json({ data: { added: option }, error: null });
    }

    // Full schema edits are a manager/editor concern
    if (!roleHasPermission(ctx.role, 'edit_keywords')) {
      return NextResponse.json(
        { data: null, error: 'Schema-Änderungen erfordern Bearbeitungsrechte · Schema edits require edit rights' },
        { status: 403 }
      );
    }

    const updates: Record<string, any> = {};
    if ('semantic_name' in body) {
      updates.semantic_name =
        typeof body.semantic_name === 'string' && body.semantic_name.trim()
          ? body.semantic_name.trim().toLowerCase().slice(0, 64)
          : null;
    }
    if ('description' in body) {
      updates.description = typeof body.description === 'string' ? body.description.slice(0, 500) : null;
    }
    if ('is_required' in body) updates.is_required = Boolean(body.is_required);
    if ('validation_rules' in body && typeof body.validation_rules === 'object') {
      updates.validation_rules = body.validation_rules ?? {};
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ data: null, error: 'No updatable fields provided' }, { status: 400 });
    }

    const { data: updated, error } = await ctx.supabase
      .from('dataset_columns')
      .update(updates)
      .eq('id', column_id)
      .select()
      .single();
    if (error) throw error;

    await audit(ctx, 'dataset.column_update', { type: 'dataset_column', id: column_id }, {
      fields: Object.keys(updates),
    });

    return NextResponse.json({ data: updated, error: null });
  } catch (error) {
    return apiError(error, 'Failed to update column');
  }
}

function slugifyField(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c] as string))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

const COLUMN_TYPES = ['text', 'number', 'date', 'boolean'];

// POST /api/datasets/columns — add a column to an existing table (editor-only)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const body = await req.json();
    const tableId = typeof body.dataset_table_id === 'string' ? body.dataset_table_id : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!tableId || !name) {
      return NextResponse.json({ data: null, error: 'dataset_table_id and name required' }, { status: 400 });
    }

    const { data: table } = await ctx.supabase
      .from('dataset_tables')
      .select('id, name, datasets!inner(organization_id), columns:dataset_columns(normalized_name)')
      .eq('id', tableId)
      .eq('datasets.organization_id', ctx.org.id)
      .maybeSingle();
    if (!table) {
      return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 });
    }

    const used = new Set(((table as any).columns ?? []).map((c: any) => c.normalized_name));
    let normalized = slugifyField(name) || `col_${used.size + 1}`;
    let suffix = 2;
    while (used.has(normalized)) normalized = `${slugifyField(name)}_${suffix++}`;

    const dataType = COLUMN_TYPES.includes(body.data_type) ? body.data_type : 'text';
    const rules: Record<string, unknown> = {};
    if (typeof body.min === 'number') rules.min = body.min;
    if (typeof body.max === 'number') rules.max = body.max;
    if (Array.isArray(body.options)) {
      const options = body.options
        .map((o: unknown) => String(o ?? '').trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 50);
      if (options.length > 0) rules.options = options;
    }
    if (body.multiple === true && dataType === 'text') rules.multiple = true;

    const semantic =
      typeof body.semantic_name === 'string' && body.semantic_name.trim()
        ? slugifyField(body.semantic_name)
        : null;

    const { data: column, error } = await ctx.supabase
      .from('dataset_columns')
      .insert({
        dataset_table_id: tableId,
        name,
        normalized_name: normalized,
        data_type: dataType,
        semantic_name: semantic,
        is_required: Boolean(body.is_required),
        validation_rules: rules,
        sample_values: [],
      })
      .select()
      .single();
    if (error) throw error;

    const { count } = await ctx.supabase
      .from('dataset_columns')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_table_id', tableId);
    if (typeof count === 'number') {
      await ctx.supabase.from('dataset_tables').update({ column_count: count }).eq('id', tableId);
    }

    await audit(ctx, 'dataset.column_add', { type: 'dataset_column', id: column.id }, {
      table: (table as any).name,
      column: name,
      data_type: dataType,
    });
    return NextResponse.json({ data: column, error: null });
  } catch (error) {
    return apiError(error, 'Failed to add column');
  }
}

// DELETE /api/datasets/columns?column_id= — remove a column definition (editor-only).
// Existing row values keep their keys harmlessly; the column just disappears
// from forms, grids and schemas.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const columnId = new URL(req.url).searchParams.get('column_id');
    if (!columnId) {
      return NextResponse.json({ data: null, error: 'column_id required' }, { status: 400 });
    }

    const { data: column } = await ctx.supabase
      .from('dataset_columns')
      .select('id, name, dataset_table_id, dataset_tables!inner(datasets!inner(organization_id))')
      .eq('id', columnId)
      .eq('dataset_tables.datasets.organization_id', ctx.org.id)
      .maybeSingle();
    if (!column) {
      return NextResponse.json({ data: null, error: 'Column not found' }, { status: 404 });
    }

    const { error } = await ctx.supabase.from('dataset_columns').delete().eq('id', columnId);
    if (error) throw error;

    const { count } = await ctx.supabase
      .from('dataset_columns')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_table_id', (column as any).dataset_table_id);
    if (typeof count === 'number') {
      await ctx.supabase
        .from('dataset_tables')
        .update({ column_count: count })
        .eq('id', (column as any).dataset_table_id);
    }

    await audit(ctx, 'dataset.column_delete', { type: 'dataset_column', id: columnId }, {
      column: (column as any).name,
    });
    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to delete column');
  }
}
