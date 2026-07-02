-- =====================================================
-- Migration 0004: Relation versioning (Milestone 3)
-- Snapshot keyword_relations on update/delete, mirroring
-- the keyword_versions pattern.
-- =====================================================

create table if not exists keyword_relation_versions (
  id uuid primary key default gen_random_uuid(),
  relation_id uuid not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  version_no integer not null,
  snapshot jsonb not null,
  change_type text not null check (change_type in ('UPDATE', 'DELETE')),
  changed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_relation_versions_relation
  on keyword_relation_versions(relation_id, version_no desc);
create index if not exists idx_relation_versions_org
  on keyword_relation_versions(organization_id);

create or replace function snapshot_relation_version()
returns trigger
language plpgsql
as $$
begin
  insert into keyword_relation_versions (relation_id, organization_id, version_no, snapshot, change_type)
  values (
    old.id,
    old.organization_id,
    coalesce((select max(version_no) from keyword_relation_versions where relation_id = old.id), 0) + 1,
    to_jsonb(old),
    tg_op
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists relations_version_snapshot on keyword_relations;
create trigger relations_version_snapshot
  before update or delete on keyword_relations
  for each row execute function snapshot_relation_version();

alter table keyword_relation_versions enable row level security;
drop policy if exists relation_versions_member_select on keyword_relation_versions;
create policy relation_versions_member_select on keyword_relation_versions for select
  using (public.current_member_role(organization_id) is not null);
