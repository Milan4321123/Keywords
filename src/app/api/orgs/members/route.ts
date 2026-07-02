import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit, authErrorResponse, OrgRole } from '@/lib/auth';

const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'manager', 'analyst', 'editor', 'viewer', 'guest'];

function fail(error: unknown, fallback: string) {
  const authErr = authErrorResponse(error);
  if (authErr) {
    return NextResponse.json({ data: null, error: authErr.message }, { status: authErr.status });
  }
  console.error(fallback, error);
  return NextResponse.json({ data: null, error: fallback }, { status: 500 });
}

// GET /api/orgs/members - members + pending invites
export async function GET() {
  try {
    const ctx = await requireOrgContext('manage_members');

    const [{ data: members, error: mErr }, { data: invites, error: iErr }] = await Promise.all([
      ctx.supabase
        .from('organization_members')
        .select('id, role, created_at, profiles(id, email, full_name)')
        .eq('organization_id', ctx.org.id)
        .order('created_at'),
      ctx.supabase
        .from('organization_invites')
        .select('id, email, role, created_at, expires_at')
        .eq('organization_id', ctx.org.id)
        .is('accepted_at', null)
        .order('created_at'),
    ]);
    if (mErr) throw mErr;
    if (iErr) throw iErr;

    return NextResponse.json({ data: { members, invites }, error: null });
  } catch (error) {
    return fail(error, 'Failed to list members');
  }
}

// POST /api/orgs/members - invite by email
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('manage_members');
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = ASSIGNABLE_ROLES.includes(body.role) ? (body.role as OrgRole) : 'viewer';

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ data: null, error: 'Valid email required' }, { status: 400 });
    }

    // If the user already exists, add them directly; otherwise store an invite.
    const { data: profile } = await ctx.supabase
      .from('profiles')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    if (profile) {
      const { error } = await ctx.supabase.from('organization_members').upsert(
        { organization_id: ctx.org.id, user_id: profile.id, role },
        { onConflict: 'organization_id,user_id', ignoreDuplicates: true }
      );
      if (error) throw error;
      await audit(ctx, 'member.add', { type: 'member', id: profile.id }, { email, role });
      return NextResponse.json({ data: { added: true, email }, error: null });
    }

    const { data: invite, error } = await ctx.supabase
      .from('organization_invites')
      .upsert(
        {
          organization_id: ctx.org.id,
          email,
          role,
          invited_by: ctx.user.id,
          accepted_at: null,
          expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
        },
        { onConflict: 'organization_id,email' }
      )
      .select()
      .single();
    if (error) throw error;

    await audit(ctx, 'member.invite', { type: 'invite', id: invite.id }, { email, role });
    return NextResponse.json({ data: { invited: true, email }, error: null });
  } catch (error) {
    return fail(error, 'Failed to invite member');
  }
}

// PATCH /api/orgs/members - change a member's role
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('manage_members');
    const { member_id, role } = await req.json();

    if (!member_id || !ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json({ data: null, error: 'member_id and valid role required' }, { status: 400 });
    }

    const { data: target, error: tErr } = await ctx.supabase
      .from('organization_members')
      .select('id, role, user_id')
      .eq('id', member_id)
      .eq('organization_id', ctx.org.id)
      .single();
    if (tErr) throw tErr;

    if (target.role === 'owner') {
      return NextResponse.json({ data: null, error: 'Cannot change the owner role' }, { status: 400 });
    }

    const { error } = await ctx.supabase
      .from('organization_members')
      .update({ role })
      .eq('id', member_id)
      .eq('organization_id', ctx.org.id);
    if (error) throw error;

    await audit(ctx, 'member.role_change', { type: 'member', id: member_id }, { from: target.role, to: role });
    return NextResponse.json({ data: { updated: true }, error: null });
  } catch (error) {
    return fail(error, 'Failed to update member');
  }
}

// DELETE /api/orgs/members?member_id=... or ?invite_id=...
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('manage_members');
    const { searchParams } = new URL(req.url);
    const memberId = searchParams.get('member_id');
    const inviteId = searchParams.get('invite_id');

    if (inviteId) {
      const { error } = await ctx.supabase
        .from('organization_invites')
        .delete()
        .eq('id', inviteId)
        .eq('organization_id', ctx.org.id);
      if (error) throw error;
      await audit(ctx, 'member.invite_revoke', { type: 'invite', id: inviteId });
      return NextResponse.json({ data: { revoked: true }, error: null });
    }

    if (!memberId) {
      return NextResponse.json({ data: null, error: 'member_id or invite_id required' }, { status: 400 });
    }

    const { data: target, error: tErr } = await ctx.supabase
      .from('organization_members')
      .select('id, role')
      .eq('id', memberId)
      .eq('organization_id', ctx.org.id)
      .single();
    if (tErr) throw tErr;

    if (target.role === 'owner') {
      return NextResponse.json({ data: null, error: 'Cannot remove the owner' }, { status: 400 });
    }

    const { error } = await ctx.supabase
      .from('organization_members')
      .delete()
      .eq('id', memberId)
      .eq('organization_id', ctx.org.id);
    if (error) throw error;

    await audit(ctx, 'member.remove', { type: 'member', id: memberId }, { role: target.role });
    return NextResponse.json({ data: { removed: true }, error: null });
  } catch (error) {
    return fail(error, 'Failed to remove member');
  }
}
