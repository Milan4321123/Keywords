-- =====================================================
-- Migration 0007: Per-worker keyword assignments
-- Admins assign keywords (branches) to members. A worker
-- (tier-1 role) WITH assignments sees only those branches;
-- workers without assignments keep the default worker-level
-- visibility. Managers/admins are never restricted.
-- =====================================================

create table if not exists keyword_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  keyword_id uuid not null references keywords(id) on delete cascade,
  member_id uuid not null references organization_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (keyword_id, member_id)
);

create index if not exists idx_keyword_assignments_member on keyword_assignments(member_id);
create index if not exists idx_keyword_assignments_keyword on keyword_assignments(keyword_id);
create index if not exists idx_keyword_assignments_org on keyword_assignments(organization_id);

alter table keyword_assignments enable row level security;

drop policy if exists keyword_assignments_member_select on keyword_assignments;
create policy keyword_assignments_member_select on keyword_assignments for select
  using (public.current_member_role(organization_id) is not null);

drop policy if exists keyword_assignments_admin_write on keyword_assignments;
create policy keyword_assignments_admin_write on keyword_assignments for all
  using (public.current_member_role(organization_id) in ('owner','admin'));
