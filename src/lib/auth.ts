import { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createAuthClient, createServiceClient } from '@/lib/supabase/server';

export type OrgRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'analyst'
  | 'editor'
  | 'viewer'
  | 'guest';

export type Permission =
  | 'view_keywords'
  | 'edit_keywords'
  | 'upload_assets'
  | 'view_datasets'
  | 'run_ai'
  | 'generate_reports'
  | 'edit_workflows'
  | 'export_data'
  | 'manage_members'
  | 'view_audit'
  | 'manage_org';

const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  owner: [
    'view_keywords', 'edit_keywords', 'upload_assets', 'view_datasets', 'run_ai',
    'generate_reports', 'edit_workflows', 'export_data', 'manage_members',
    'view_audit', 'manage_org',
  ],
  admin: [
    'view_keywords', 'edit_keywords', 'upload_assets', 'view_datasets', 'run_ai',
    'generate_reports', 'edit_workflows', 'export_data', 'manage_members',
    'view_audit', 'manage_org',
  ],
  manager: [
    'view_keywords', 'edit_keywords', 'upload_assets', 'view_datasets', 'run_ai',
    'generate_reports', 'edit_workflows', 'export_data',
  ],
  analyst: [
    'view_keywords', 'view_datasets', 'run_ai', 'generate_reports', 'export_data',
  ],
  editor: ['view_keywords', 'edit_keywords', 'upload_assets', 'view_datasets', 'run_ai'],
  viewer: ['view_keywords', 'view_datasets', 'run_ai'],
  guest: ['view_keywords', 'view_datasets'],
};

export function roleHasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export const ACTIVE_ORG_COOKIE = 'active_org';

export interface OrgContext {
  user: { id: string; email: string };
  org: { id: string; name: string; slug: string; settings: Record<string, any> };
  role: OrgRole;
  memberId: string;
  /** Service-role client. Every query MUST be scoped to org.id. */
  supabase: SupabaseClient;
}

export class ApiAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface MembershipRow {
  id: string;
  role: OrgRole;
  organization_id: string;
  organizations: { id: string; name: string; slug: string; settings: Record<string, any> };
}

/** Accept any pending invites for this email, creating memberships. */
export async function claimPendingInvites(
  supabase: SupabaseClient,
  userId: string,
  email: string
): Promise<void> {
  const { data: invites } = await supabase
    .from('organization_invites')
    .select('id, organization_id, role')
    .ilike('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString());

  if (!invites || invites.length === 0) return;

  for (const invite of invites) {
    const { error } = await supabase.from('organization_members').upsert(
      { organization_id: invite.organization_id, user_id: userId, role: invite.role },
      { onConflict: 'organization_id,user_id', ignoreDuplicates: true }
    );
    if (!error) {
      await supabase
        .from('organization_invites')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invite.id);
    }
  }
}

export async function getMemberships(
  supabase: SupabaseClient,
  userId: string
): Promise<MembershipRow[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, role, organization_id, organizations(id, name, slug, settings)')
    .eq('user_id', userId)
    .order('created_at');

  if (error) throw error;
  return (data as unknown as MembershipRow[]) ?? [];
}

/**
 * Resolve the authenticated user, their active organization, and role.
 * Throws ApiAuthError(401) without a session, 403 without membership
 * or when the role lacks the required permission.
 */
export async function requireOrgContext(permission?: Permission): Promise<OrgContext> {
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user || !user.email) {
    throw new ApiAuthError(401, 'unauthenticated', 'Sign in required');
  }

  const supabase = createServiceClient();
  await claimPendingInvites(supabase, user.id, user.email);

  const memberships = await getMemberships(supabase, user.id);
  if (memberships.length === 0) {
    throw new ApiAuthError(403, 'no_org', 'You are not a member of any organization');
  }

  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const membership =
    memberships.find((m) => m.organization_id === activeOrgId) ?? memberships[0];

  if (permission && !roleHasPermission(membership.role, permission)) {
    throw new ApiAuthError(
      403,
      'forbidden',
      `Your role (${membership.role}) does not allow this action`
    );
  }

  return {
    user: { id: user.id, email: user.email },
    org: membership.organizations,
    role: membership.role,
    memberId: membership.id,
    supabase,
  };
}

/**
 * Server-component variant: returns null instead of throwing so pages
 * can redirect. Does not claim invites (the layout already did).
 */
export async function getOrgContextForPage(): Promise<OrgContext | null> {
  try {
    return await requireOrgContext();
  } catch (error) {
    if (error instanceof ApiAuthError) return null;
    throw error;
  }
}

/** Fire-and-forget audit log write. Never throws. */
export async function audit(
  ctx: OrgContext,
  action: string,
  entity?: { type: string; id?: string | null },
  details: Record<string, any> = {}
): Promise<void> {
  try {
    await ctx.supabase.from('audit_logs').insert({
      organization_id: ctx.org.id,
      actor_id: ctx.user.id,
      action,
      entity_type: entity?.type ?? null,
      entity_id: entity?.id ?? null,
      details,
    });
  } catch (error) {
    console.error('audit log write failed:', action, error);
  }
}

/** Standard { data, error } mapping for ApiAuthError in route handlers. */
export function authErrorResponse(error: unknown): { status: number; message: string; code: string } | null {
  if (error instanceof ApiAuthError) {
    return { status: error.status, message: error.message, code: error.code };
  }
  return null;
}
