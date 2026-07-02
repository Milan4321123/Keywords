import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient, createServiceClient } from '@/lib/supabase/server';
import { claimPendingInvites, getMemberships, ACTIVE_ORG_COOKIE } from '@/lib/auth';

function slugify(name: string): string {
  return (
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') ||
    `org-${Date.now()}`
  );
}

async function requireUser() {
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user || !user.email) return null;
  return user;
}

// GET /api/orgs - list my organizations (claims pending invites first)
export async function GET() {
  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ data: null, error: 'Sign in required' }, { status: 401 });
    }

    const supabase = createServiceClient();
    await claimPendingInvites(supabase, user.id, user.email!);
    const memberships = await getMemberships(supabase, user.id);

    return NextResponse.json({
      data: {
        organizations: memberships.map((m) => ({
          id: m.organizations.id,
          name: m.organizations.name,
          slug: m.organizations.slug,
          role: m.role,
        })),
      },
      error: null,
    });
  } catch (error: any) {
    console.error('Error listing organizations:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to list organizations' },
      { status: 500 }
    );
  }
}

// POST /api/orgs - create an organization (creator becomes owner).
// If the migration produced an unclaimed "Default Organization" holding
// pre-existing single-tenant data, the first creator claims it instead.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ data: null, error: 'Sign in required' }, { status: 401 });
    }

    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ data: null, error: 'Name is required' }, { status: 400 });
    }
    const industry = typeof body.industry === 'string' ? body.industry.trim() || null : null;

    const supabase = createServiceClient();

    // Claim the backfilled default org if it has no members yet.
    const { data: defaultOrg } = await supabase
      .from('organizations')
      .select('id, organization_members(id)')
      .eq('slug', 'default')
      .maybeSingle();

    let orgId: string;

    if (defaultOrg && (defaultOrg.organization_members ?? []).length === 0) {
      orgId = defaultOrg.id;
      const { error: updateError } = await supabase
        .from('organizations')
        .update({ name, industry, slug: slugify(name) })
        .eq('id', orgId);
      if (updateError) throw updateError;
    } else {
      let slug = slugify(name);
      const { data: existing } = await supabase
        .from('organizations')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (existing) slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;

      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({ name, slug, industry })
        .select('id')
        .single();
      if (orgError) throw orgError;
      orgId = org.id;
    }

    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({ organization_id: orgId, user_id: user.id, role: 'owner' });
    if (memberError) throw memberError;

    await supabase.from('audit_logs').insert({
      organization_id: orgId,
      actor_id: user.id,
      action: 'organization.create',
      entity_type: 'organization',
      entity_id: orgId,
      details: { name },
    });

    const response = NextResponse.json({ data: { id: orgId, name }, error: null });
    response.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error: any) {
    console.error('Error creating organization:', error);
    return NextResponse.json(
      { data: null, error: 'Failed to create organization' },
      { status: 500 }
    );
  }
}
