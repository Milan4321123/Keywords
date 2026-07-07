import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createAuthClient, createServiceClient } from '@/lib/supabase/server';
import { claimPendingInvites, getMemberships, roleHasPermission, isWorkerRole, ACTIVE_ORG_COOKIE, OrgRole } from '@/lib/auth';
import AppShell, { ShellOrg } from '@/components/AppShell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user || !user.email) {
    redirect('/login');
  }

  const supabase = createServiceClient();
  await claimPendingInvites(supabase, user.id, user.email);
  const memberships = await getMemberships(supabase, user.id);

  if (memberships.length === 0) {
    redirect('/onboarding');
  }

  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.organization_id === activeOrgId) ?? memberships[0];

  const orgs: ShellOrg[] = memberships.map((m) => ({
    id: m.organizations.id,
    name: m.organizations.name,
    slug: m.organizations.slug,
    role: m.role,
  }));

  return (
    <AppShell
      orgs={orgs}
      activeOrgId={active.organization_id}
      userEmail={user.email}
      canManage={roleHasPermission(active.role as OrgRole, 'manage_members')}
      isWorker={isWorkerRole(active.role as OrgRole)}
    >
      {children}
    </AppShell>
  );
}
