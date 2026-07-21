-- =====================================================
-- Migration 0008: Grounded business object layer
-- Stable identities, time-valid facts, event history, and provenance.
-- This sits between the keyword ontology and operational tables.
-- =====================================================

-- A business object is a real thing the company operates on: a project,
-- customer, employee, supplier, invoice, product, asset, or work order.
create table if not exists business_objects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  object_type text not null check (char_length(trim(object_type)) > 0),
  external_key text,
  display_name text not null check (char_length(trim(display_name)) > 0),
  description text,
  status text not null default 'active',
  canonical_keyword_id uuid references keywords(id) on delete set null,
  attributes jsonb not null default '{}',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_business_objects_external_key
  on business_objects(organization_id, object_type, external_key)
  where external_key is not null;
create index if not exists idx_business_objects_org_type
  on business_objects(organization_id, object_type, status);
create index if not exists idx_business_objects_keyword
  on business_objects(canonical_keyword_id);
create index if not exists idx_business_objects_attributes
  on business_objects using gin(attributes jsonb_path_ops);

-- Explicit object-to-object connections such as project has-customer,
-- invoice belongs-to-customer, or employee works-on-project.
create table if not exists business_object_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  from_object_id uuid not null references business_objects(id) on delete cascade,
  relation_type text not null check (char_length(trim(relation_type)) > 0),
  to_object_id uuid not null references business_objects(id) on delete cascade,
  valid_from timestamptz,
  valid_to timestamptz,
  truth_status text not null default 'verified'
    check (truth_status in ('verified','approved','derived','asserted','disputed')),
  source_asset_id uuid references assets(id) on delete set null,
  source_row_id uuid references dataset_rows(id) on delete set null,
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_object_id <> to_object_id),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);

create unique index if not exists idx_business_object_relations_unique
  on business_object_relations(from_object_id, relation_type, to_object_id)
  where valid_to is null;
create index if not exists idx_business_object_relations_from
  on business_object_relations(organization_id, from_object_id);
create index if not exists idx_business_object_relations_to
  on business_object_relations(organization_id, to_object_id);

-- Atomic facts are append-only observations. A corrected value closes the old
-- validity window and inserts a new row; the source remains auditable.
create table if not exists business_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  object_id uuid not null references business_objects(id) on delete cascade,
  fact_key text not null check (char_length(trim(fact_key)) > 0),
  value jsonb not null,
  data_type text not null default 'text'
    check (data_type in ('text','number','date','datetime','boolean','currency','percentage','json')),
  unit text,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  recorded_at timestamptz not null default now(),
  truth_status text not null default 'asserted'
    check (truth_status in ('verified','approved','derived','asserted','disputed')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_type text not null default 'manual'
    check (source_type in ('manual','dataset','document','metric','integration','ai_extraction','calculation')),
  source_asset_id uuid references assets(id) on delete set null,
  source_table_id uuid references dataset_tables(id) on delete set null,
  source_row_id uuid references dataset_rows(id) on delete set null,
  source_metric_id uuid references metrics(id) on delete set null,
  derivation text,
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  check (truth_status <> 'derived' or derivation is not null)
);

create index if not exists idx_business_facts_object_key
  on business_facts(organization_id, object_id, fact_key, valid_from desc);
create index if not exists idx_business_facts_current
  on business_facts(organization_id, object_id, fact_key)
  where valid_to is null and truth_status <> 'disputed';
create index if not exists idx_business_facts_value
  on business_facts using gin(value jsonb_path_ops);

-- Immutable event ledger: what happened, when, to which object, and based on
-- which record. Facts describe state; events describe change.
create table if not exists business_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  object_id uuid references business_objects(id) on delete set null,
  event_type text not null check (char_length(trim(event_type)) > 0),
  occurred_at timestamptz not null,
  payload jsonb not null default '{}',
  truth_status text not null default 'verified'
    check (truth_status in ('verified','approved','derived','asserted','disputed')),
  source_type text not null default 'manual',
  source_asset_id uuid references assets(id) on delete set null,
  source_table_id uuid references dataset_tables(id) on delete set null,
  source_row_id uuid references dataset_rows(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_business_events_org_time
  on business_events(organization_id, occurred_at desc);
create index if not exists idx_business_events_object_time
  on business_events(object_id, occurred_at desc);

-- Multi-context links let one object participate in several keywords, tasks,
-- datasets, assets, and metrics without duplicating the object.
create table if not exists business_object_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  object_id uuid not null references business_objects(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  dataset_id uuid references datasets(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  metric_id uuid references metrics(id) on delete cascade,
  link_role text not null default 'related-to',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(keyword_id, task_id, dataset_id, asset_id, metric_id) = 1)
);

create unique index if not exists idx_business_object_links_keyword
  on business_object_links(object_id, keyword_id, link_role) where keyword_id is not null;
create unique index if not exists idx_business_object_links_task
  on business_object_links(object_id, task_id, link_role) where task_id is not null;
create unique index if not exists idx_business_object_links_dataset
  on business_object_links(object_id, dataset_id, link_role) where dataset_id is not null;
create unique index if not exists idx_business_object_links_asset
  on business_object_links(object_id, asset_id, link_role) where asset_id is not null;
create unique index if not exists idx_business_object_links_metric
  on business_object_links(object_id, metric_id, link_role) where metric_id is not null;
create index if not exists idx_business_object_links_org_object
  on business_object_links(organization_id, object_id);

-- One deterministic row per current fact. This is the safe AI/read model;
-- history remains available in business_facts.
create or replace view current_business_facts with (security_invoker = true) as
select distinct on (organization_id, object_id, fact_key)
  id, organization_id, object_id, fact_key, value, data_type, unit,
  valid_from, valid_to, recorded_at, truth_status, confidence, source_type,
  source_asset_id, source_table_id, source_row_id, source_metric_id,
  derivation, note, created_by, created_at
from business_facts
where valid_to is null and truth_status <> 'disputed'
order by organization_id, object_id, fact_key,
  case truth_status
    when 'approved' then 5
    when 'verified' then 4
    when 'derived' then 3
    when 'asserted' then 2
    else 1
  end desc,
  valid_from desc,
  recorded_at desc;

drop trigger if exists business_objects_updated_at on business_objects;
create trigger business_objects_updated_at before update on business_objects
  for each row execute function update_updated_at();

-- Service-role routes bypass RLS, so enforce cross-table tenant integrity at
-- the database boundary as well. A source or link can never point into a
-- different organization, even if an application bug supplies a valid UUID.
create or replace function enforce_business_layer_org()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'business_objects' then
    if new.canonical_keyword_id is not null and not exists (
      select 1 from keywords k where k.id = new.canonical_keyword_id and k.organization_id = new.organization_id
    ) then raise exception 'canonical keyword belongs to a different organization'; end if;
    return new;
  end if;

  if tg_table_name = 'business_object_relations' then
    if not exists (select 1 from business_objects o where o.id = new.from_object_id and o.organization_id = new.organization_id)
       or not exists (select 1 from business_objects o where o.id = new.to_object_id and o.organization_id = new.organization_id)
    then raise exception 'related object belongs to a different organization'; end if;
  elsif new.object_id is not null and not exists (
    select 1 from business_objects o where o.id = new.object_id and o.organization_id = new.organization_id
  ) then raise exception 'business object belongs to a different organization';
  end if;

  if tg_table_name in ('business_object_relations','business_facts','business_events') then
    if new.source_asset_id is not null and not exists (
      select 1 from assets a where a.id = new.source_asset_id and a.organization_id = new.organization_id
    ) then raise exception 'source asset belongs to a different organization'; end if;
    if new.source_row_id is not null and not exists (
      select 1 from dataset_rows r
      join dataset_tables t on t.id = r.dataset_table_id
      join datasets d on d.id = t.dataset_id
      where r.id = new.source_row_id and d.organization_id = new.organization_id
    ) then raise exception 'source row belongs to a different organization'; end if;
  end if;

  if tg_table_name in ('business_facts','business_events') then
    if new.source_table_id is not null and not exists (
      select 1 from dataset_tables t join datasets d on d.id = t.dataset_id
      where t.id = new.source_table_id and d.organization_id = new.organization_id
    ) then raise exception 'source table belongs to a different organization'; end if;
  end if;

  if tg_table_name = 'business_facts' and new.source_metric_id is not null and not exists (
    select 1 from metrics m where m.id = new.source_metric_id and m.organization_id = new.organization_id
  ) then raise exception 'source metric belongs to a different organization';
  end if;

  if tg_table_name = 'business_object_links' then
    if new.keyword_id is not null and not exists (select 1 from keywords k where k.id = new.keyword_id and k.organization_id = new.organization_id)
      then raise exception 'linked keyword belongs to a different organization'; end if;
    if new.task_id is not null and not exists (select 1 from tasks t where t.id = new.task_id and t.organization_id = new.organization_id)
      then raise exception 'linked task belongs to a different organization'; end if;
    if new.dataset_id is not null and not exists (select 1 from datasets d where d.id = new.dataset_id and d.organization_id = new.organization_id)
      then raise exception 'linked dataset belongs to a different organization'; end if;
    if new.asset_id is not null and not exists (select 1 from assets a where a.id = new.asset_id and a.organization_id = new.organization_id)
      then raise exception 'linked asset belongs to a different organization'; end if;
    if new.metric_id is not null and not exists (select 1 from metrics m where m.id = new.metric_id and m.organization_id = new.organization_id)
      then raise exception 'linked metric belongs to a different organization'; end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'business_objects','business_object_relations','business_facts',
    'business_events','business_object_links'
  ]
  loop
    execute format('drop trigger if exists %I_tenant_guard on %I', t, t);
    execute format('create trigger %I_tenant_guard before insert or update on %I
                    for each row execute function enforce_business_layer_org()', t, t);
  end loop;
end $$;

-- Tenant isolation. Server routes additionally scope every query by org id.
do $$
declare t text;
begin
  foreach t in array array[
    'business_objects','business_object_relations','business_facts',
    'business_events','business_object_links'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_member_select on %I', t, t);
    execute format('create policy %I_member_select on %I for select
                    using (public.current_member_role(organization_id) is not null)', t, t);
    execute format('drop policy if exists %I_editor_write on %I', t, t);
    execute format('create policy %I_editor_write on %I for all
                    using (public.current_member_role(organization_id) in (''owner'',''admin'',''manager'',''editor''))
                    with check (public.current_member_role(organization_id) in (''owner'',''admin'',''manager'',''editor''))', t, t);
  end loop;
end $$;

grant select on current_business_facts to authenticated;
