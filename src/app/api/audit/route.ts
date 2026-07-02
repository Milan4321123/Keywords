import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, authErrorResponse } from '@/lib/auth';

// GET /api/audit?limit=&before= - paged audit log (admins/owners)
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('view_audit');
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
    const before = searchParams.get('before');

    let query = ctx.supabase
      .from('audit_logs')
      .select('id, action, entity_type, entity_id, details, created_at, profiles:actor_id(email, full_name)')
      .eq('organization_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ data, error: null });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) {
      return NextResponse.json({ data: null, error: authErr.message }, { status: authErr.status });
    }
    console.error('Failed to fetch audit log:', error);
    return NextResponse.json({ data: null, error: 'Failed to fetch audit log' }, { status: 500 });
  }
}
