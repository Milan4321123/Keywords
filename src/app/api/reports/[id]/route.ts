import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/reports/[id]
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('view_datasets');
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .eq('organization_id', ctx.org.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ data: null, error: 'Report not found' }, { status: 404 });
    return NextResponse.json({ data, error: null });
  } catch (error) {
    return apiError(error, 'Failed to fetch report');
  }
}

// DELETE /api/reports/[id]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('generate_reports');
    const { id } = await params;
    const { error } = await ctx.supabase
      .from('reports')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.org.id);
    if (error) throw error;
    await audit(ctx, 'report.delete', { type: 'report', id });
    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (error) {
    return apiError(error, 'Failed to delete report');
  }
}
