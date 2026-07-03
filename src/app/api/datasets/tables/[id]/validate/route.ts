import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { validateTable, QualityRow } from '@/lib/datasets/quality';

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/datasets/tables/[id]/validate - Run data quality checks,
// persist findings to data_quality_issues, and return the report.
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const { id } = await params;

    const { data: table, error: tableError } = await ctx.supabase
      .from('dataset_tables')
      .select('id, name, datasets!inner(organization_id), columns:dataset_columns(*)')
      .eq('id', id)
      .eq('datasets.organization_id', ctx.org.id)
      .maybeSingle();
    if (tableError) throw tableError;
    if (!table) {
      return NextResponse.json({ data: null, error: 'Table not found' }, { status: 404 });
    }

    // Load rows (paged, capped)
    const rows: QualityRow[] = [];
    const pageSize = 2000;
    for (let offset = 0; offset < 50_000; offset += pageSize) {
      const { data, error } = await ctx.supabase
        .from('dataset_rows')
        .select('id, row_index, data')
        .eq('dataset_table_id', id)
        .order('row_index')
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as QualityRow[]));
      if ((data ?? []).length < pageSize) break;
    }

    const issues = validateTable(table.columns ?? [], rows);

    // Replace previously auto-detected open issues for this table
    await ctx.supabase
      .from('data_quality_issues')
      .delete()
      .eq('organization_id', ctx.org.id)
      .eq('entity_type', 'dataset_table')
      .eq('entity_id', id)
      .eq('status', 'open');

    if (issues.length > 0) {
      await ctx.supabase.from('data_quality_issues').insert(
        issues.map((issue) => ({
          organization_id: ctx.org.id,
          entity_type: 'dataset_table',
          entity_id: id,
          issue_type: issue.issue_type,
          severity: issue.severity,
          description: issue.description,
          status: 'open',
          details: {
            column: issue.column,
            affected_count: issue.affected_count,
            sample_row_ids: issue.sample_row_ids,
          },
        }))
      );
    }

    await audit(ctx, 'dataset.validate', { type: 'dataset_table', id }, {
      rows: rows.length,
      issues: issues.length,
    });

    return NextResponse.json({
      data: {
        table: { id: table.id, name: table.name },
        checked_rows: rows.length,
        issues,
      },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to validate table');
  }
}
