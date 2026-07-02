import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth';
import { apiError } from '@/lib/api';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/keywords/[id]/versions - Version history for a keyword
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireOrgContext('view_keywords');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('keyword_versions')
      .select('id, version_no, snapshot, change_type, created_at, profiles:changed_by(email, full_name)')
      .eq('keyword_id', id)
      .eq('organization_id', ctx.org.id)
      .order('version_no', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ data: data ?? [], error: null });
  } catch (error) {
    return apiError(error, 'Failed to fetch version history');
  }
}
