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
