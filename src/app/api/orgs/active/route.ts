import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient, createServiceClient } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE } from '@/lib/auth';

// POST /api/orgs/active - switch the active organization
export async function POST(req: NextRequest) {
  try {
    const authClient = await createAuthClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ data: null, error: 'Sign in required' }, { status: 401 });
    }

    const { organization_id } = await req.json();
    if (!organization_id || typeof organization_id !== 'string') {
      return NextResponse.json({ data: null, error: 'organization_id required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { data: null, error: 'Not a member of that organization' },
        { status: 403 }
      );
    }

    const response = NextResponse.json({ data: { active: organization_id }, error: null });
    response.cookies.set(ACTIVE_ORG_COOKIE, organization_id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    console.error('Error switching organization:', error);
    return NextResponse.json({ data: null, error: 'Failed to switch organization' }, { status: 500 });
  }
}
