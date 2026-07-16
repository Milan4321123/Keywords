-- =====================================================================
-- COMPLETE SETUP — Company Brain platform (idempotent)
-- Safe to run on a fresh project OR re-run on a partial/existing one.
-- Paste this whole file into the Supabase SQL Editor and run.
-- (Demo/sample data lives separately in seed.sql.)
-- =====================================================================

-- =====================================================
-- Company Knowledge Base Schema for Supabase
-- =====================================================

-- Enable the pgvector extension for embeddings
create extension if not exists vector;

-- =====================================================
-- KEYWORDS TABLE (Ontology Nodes)
-- =====================================================
create table if not exists keywords (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references keywords(id) on delete cascade,
  title text not null,
  slug text unique not null,
  definition text, -- short 1-2 line definition
  explanation text, -- longer explanation (can be from voice)
  examples text[], -- array of example usages
  synonyms text[], -- alternative names
  labels_json jsonb default '{}', -- multilingual labels {"de": "Rechnung", "en": "Invoice"}
  rules text[], -- constraints/rules for this concept
  icon text, -- optional icon identifier
  color text, -- optional color for UI
  sort_order integer default 0,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (char_length(trim(title)) > 0),
  check (char_length(trim(slug)) > 0)
);

-- Index for parent-child queries
create index if not exists idx_keywords_parent on keywords(parent_id);
create index if not exists idx_keywords_slug on keywords(slug);

-- =====================================================
-- KEYWORD RELATIONS TABLE (Edges in the Knowledge Graph)
-- =====================================================
do $$ begin
  create type relation_type as enum (
  'is-a',           -- Invoice is-a Document
  'part-of',        -- Trade is part-of Project
  'requires',       -- Invoice requires Approval
  'causes',         -- Defect causes Rework
  'leads-to',       -- Defect leads-to Repair
  'owned-by',       -- Project owned-by Manager
  'depends-on',     -- Payment depends-on Approval
  'related-to',     -- Generic relation
  'approves',       -- Role approves Document
  'contains',       -- Project contains Invoices
  'triggers',       -- Event triggers Action
  'blocks',         -- Issue blocks Progress
  'succeeds',       -- Phase succeeds Phase
  'precedes'        -- Phase precedes Phase
);
exception when duplicate_object then null; end $$;

create table if not exists keyword_relations (
  id uuid primary key default gen_random_uuid(),
  from_keyword_id uuid not null references keywords(id) on delete cascade,
  relation_type relation_type not null,
  to_keyword_id uuid not null references keywords(id) on delete cascade,
  note text, -- optional explanation of the relation
  strength integer default 5 check (strength >= 1 and strength <= 10), -- relation strength 1-10
  bidirectional boolean default false,
  created_at timestamptz default now(),
  
  -- Prevent duplicate relations
  unique(from_keyword_id, relation_type, to_keyword_id),
  check (from_keyword_id <> to_keyword_id)
);

create index if not exists idx_relations_from on keyword_relations(from_keyword_id);
create index if not exists idx_relations_to on keyword_relations(to_keyword_id);
create index if not exists idx_relations_type on keyword_relations(relation_type);

-- =====================================================
-- ASSETS TABLE (Uploaded Files/Evidence)
-- =====================================================
do $$ begin
  create type asset_type as enum (
  'pdf',
  'image',
  'excel',
  'word',
  'text',
  'audio',
  'video',
  'other'
);
exception when duplicate_object then null; end $$;

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_url text not null,
  file_type asset_type not null,
  mime_type text,
  file_size integer, -- in bytes
  extracted_text text, -- full text extracted from document
  meta_json jsonb default '{}', -- metadata (pages, sheets, dimensions, etc.)
  thumbnail_url text, -- optional preview thumbnail
  processed boolean default false,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_assets_type on assets(file_type);
create index if not exists idx_assets_processed on assets(processed);

-- Optional scoping helpers (e.g. org_id stored in meta_json)
create index if not exists idx_assets_org_id on assets ((meta_json->>'org_id'));

-- =====================================================
-- KEYWORD_ASSETS TABLE (Many-to-Many Link)
-- =====================================================
create table if not exists keyword_assets (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references keywords(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  relevance_score integer default 5 check (relevance_score >= 1 and relevance_score <= 10),
  note text, -- why this asset is linked to this keyword
  created_at timestamptz default now(),
  
  unique(keyword_id, asset_id)
);

create index if not exists idx_ka_keyword on keyword_assets(keyword_id);
create index if not exists idx_ka_asset on keyword_assets(asset_id);

-- =====================================================
-- CHUNKS TABLE (For RAG - Document Chunks with Embeddings)
-- =====================================================
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete set null, -- optional direct keyword link
  chunk_index integer not null, -- order within the source
  chunk_text text not null,
  chunk_type text default 'text', -- 'text', 'table', 'heading', etc.
  embedding vector(1536), -- OpenAI ada-002 embedding dimension
  token_count integer,
  meta_json jsonb default '{}', -- page number, section, etc.
  created_at timestamptz default now(),
  unique(asset_id, chunk_index)
);

create index if not exists idx_chunks_asset on chunks(asset_id);
create index if not exists idx_chunks_keyword on chunks(keyword_id);
create index if not exists idx_chunks_asset_chunk_index on chunks(asset_id, chunk_index);

-- Full-text search support (hybrid retrieval)
alter table chunks
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(chunk_text, ''))) stored;

create index if not exists idx_chunks_search_vector on chunks using gin (search_vector);

-- Create a vector index for similarity search
create index if not exists idx_chunks_embedding on chunks 
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- =====================================================
-- VOICE RECORDINGS TABLE (Optional - Store Original Audio)
-- =====================================================
create table if not exists voice_recordings (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid references keywords(id) on delete cascade,
  audio_url text not null,
  transcription text,
  duration_seconds integer,
  field_updated text, -- 'definition', 'explanation', 'example'
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists idx_voice_keyword on voice_recordings(keyword_id);

-- =====================================================
-- CHAT HISTORY TABLE (For Context in Conversations)
-- =====================================================
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  title text,
  context_keywords uuid[], -- keywords used as context
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  sources_json jsonb default '[]', -- references to keywords/assets used
  token_count integer,
  created_at timestamptz default now()
);

create index if not exists idx_chat_messages_session on chat_messages(session_id);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to search chunks by embedding similarity
create or replace function match_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_keyword_ids uuid[] default null,
  filter_org_id text default null
)
returns table (
  id uuid,
  asset_id uuid,
  keyword_id uuid,
  chunk_index integer,
  chunk_text text,
  chunk_type text,
  meta_json jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.asset_id,
    c.keyword_id,
    c.chunk_index,
    c.chunk_text,
    c.chunk_type,
    c.meta_json,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  left join assets a on a.id = c.asset_id
  where 
    query_embedding is not null
    and c.embedding is not null
    and
    (
      filter_keyword_ids is null
      or c.keyword_id = any(filter_keyword_ids)
      or exists (
        select 1
        from keyword_assets ka
        where ka.asset_id = c.asset_id
          and ka.keyword_id = any(filter_keyword_ids)
      )
    )
    and (
      filter_org_id is null
      or a.meta_json->>'org_id' = filter_org_id
    )
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Hybrid retrieval (vector + full-text search)
create or replace function match_chunks_hybrid(
  query_text text,
  query_embedding vector(1536),
  match_threshold float default 0.65,
  match_count int default 20,
  filter_keyword_ids uuid[] default null,
  filter_org_id text default null,
  weight_vector float default 0.7,
  weight_text float default 0.3
)
returns table (
  id uuid,
  asset_id uuid,
  keyword_id uuid,
  chunk_index integer,
  chunk_text text,
  chunk_type text,
  meta_json jsonb,
  similarity float
)
language plpgsql
as $$
declare
  q tsquery;
begin
  if coalesce(trim(query_text), '') <> '' then
    q := websearch_to_tsquery('english', query_text);
  else
    q := null;
  end if;

  return query
  with scored as (
    select
      c.id,
      c.asset_id,
      c.keyword_id,
      c.chunk_index,
      c.chunk_text,
      c.chunk_type,
      c.meta_json,
      -- Vector similarity in [0, 1]
      coalesce(greatest(0, 1 - (c.embedding <=> query_embedding)), 0) as vec_sim,
      -- Text rank is typically small; clamp to [0, 1] for blending
      least(1, ts_rank_cd(c.search_vector, q)) as text_rank
    from chunks c
    left join assets a on a.id = c.asset_id
    where
      (
        filter_keyword_ids is null
        or c.keyword_id = any(filter_keyword_ids)
        or exists (
          select 1
          from keyword_assets ka
          where ka.asset_id = c.asset_id
            and ka.keyword_id = any(filter_keyword_ids)
        )
      )
      and (
        filter_org_id is null
        or a.meta_json->>'org_id' = filter_org_id
      )
      and (
        -- match on text OR on vectors above threshold
        (q is not null and c.search_vector @@ q)
        or coalesce(greatest(0, 1 - (c.embedding <=> query_embedding)), 0) > match_threshold
      )
  )
  select
    s.id,
    s.asset_id,
    s.keyword_id,
    s.chunk_index,
    s.chunk_text,
    s.chunk_type,
    s.meta_json,
    (weight_vector * s.vec_sim + weight_text * s.text_rank) as similarity
  from scored s
  order by similarity desc
  limit match_count;
end;
$$;

-- Function to get keyword with all its ancestors (path)
create or replace function get_keyword_path(keyword_id uuid)
returns table (
  id uuid,
  title text,
  depth int
)
language sql
as $$
  with recursive path as (
    select k.id, k.title, k.parent_id, 0 as depth
    from keywords k
    where k.id = keyword_id
    
    union all
    
    select k.id, k.title, k.parent_id, p.depth + 1
    from keywords k
    join path p on k.id = p.parent_id
  )
  select path.id, path.title, path.depth
  from path
  order by depth desc;
$$;

-- Function to get all descendants of a keyword
create or replace function get_keyword_descendants(root_id uuid)
returns table (
  id uuid,
  title text,
  parent_id uuid,
  depth int
)
language sql
as $$
  with recursive descendants as (
    select k.id, k.title, k.parent_id, 0 as depth
    from keywords k
    where k.id = root_id
    
    union all
    
    select k.id, k.title, k.parent_id, d.depth + 1
    from keywords k
    join descendants d on k.parent_id = d.id
  )
  select * from descendants
  order by depth, title;
$$;

-- Trigger to update updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists keywords_updated_at on keywords;
create trigger keywords_updated_at
  before update on keywords
  for each row execute function update_updated_at();

drop trigger if exists assets_updated_at on assets;
create trigger assets_updated_at
  before update on assets
  for each row execute function update_updated_at();

drop trigger if exists chat_sessions_updated_at on chat_sessions;
create trigger chat_sessions_updated_at
  before update on chat_sessions
  for each row execute function update_updated_at();

-- =====================================================
-- DATASETS (Structured uploads for grounded analytics)
-- =====================================================

create table if not exists datasets (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id) on delete set null,
  title text not null,
  description text,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists idx_datasets_asset on datasets(asset_id);

create table if not exists dataset_tables (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  name text not null,
  row_count integer default 0,
  column_count integer default 0,
  meta_json jsonb default '{}',
  created_at timestamptz default now(),
  unique(dataset_id, name)
);

create index if not exists idx_dataset_tables_dataset on dataset_tables(dataset_id);

do $$ begin
  create type dataset_column_type as enum ('text', 'number', 'date', 'boolean', 'json');
exception when duplicate_object then null; end $$;

create table if not exists dataset_columns (
  id uuid primary key default gen_random_uuid(),
  dataset_table_id uuid not null references dataset_tables(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  data_type dataset_column_type not null default 'text',
  sample_values text[] default '{}',
  created_at timestamptz default now(),
  unique(dataset_table_id, normalized_name)
);

create index if not exists idx_dataset_columns_table on dataset_columns(dataset_table_id);

create table if not exists dataset_rows (
  id uuid primary key default gen_random_uuid(),
  dataset_table_id uuid not null references dataset_tables(id) on delete cascade,
  row_index integer not null,
  data jsonb not null,
  source_json jsonb default '{}',
  created_at timestamptz default now(),
  unique(dataset_table_id, row_index)
);

create index if not exists idx_dataset_rows_table on dataset_rows(dataset_table_id);
create index if not exists idx_dataset_rows_data_gin on dataset_rows using gin (data jsonb_path_ops);

-- =====================================================
-- ROW LEVEL SECURITY (Optional - Enable as needed)
-- =====================================================

-- Enable RLS on all tables
-- alter table keywords enable row level security;
-- alter table keyword_relations enable row level security;
-- alter table assets enable row level security;
-- alter table keyword_assets enable row level security;
-- alter table chunks enable row level security;

-- ============ MIGRATION 0002 ============
-- =====================================================
-- Migration 0002: Platform Foundation (Milestone 1)
-- Multi-tenancy, auth profiles, RBAC, audit, versioning,
-- keyword typing, extended relations, intelligence tables.
-- Idempotent where possible; safe on both fresh installs
-- and databases created from schema.sql v1.
-- =====================================================

-- =====================================================
-- 1. ENUMS
-- =====================================================

do $$ begin
  create type org_role as enum ('owner', 'admin', 'manager', 'analyst', 'editor', 'viewer', 'guest');
exception when duplicate_object then null; end $$;

do $$ begin
  create type keyword_type as enum (
    'concept', 'process', 'metric', 'dataset', 'document_type', 'role',
    'task_type', 'workflow_step', 'department', 'entity', 'kpi',
    'report_type', 'risk', 'rule', 'skill'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type keyword_status as enum ('draft', 'active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type processing_status as enum ('pending', 'processing', 'processed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('todo', 'in_progress', 'blocked', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

-- relation_type is created by schema.sql. This migration only ALTERs it, so
-- guard against schema.sql not having run yet (or the type having been
-- dropped) by creating it here with the original v1 values if missing.
do $$ begin
  create type relation_type as enum (
    'is-a', 'part-of', 'requires', 'causes', 'leads-to', 'owned-by',
    'depends-on', 'related-to', 'approves', 'contains', 'triggers',
    'blocks', 'succeeds', 'precedes'
  );
exception when duplicate_object then null; end $$;

-- Extend relation types to the full spec vocabulary (hyphen style, v1 convention)
alter type relation_type add value if not exists 'produces';
alter type relation_type add value if not exists 'affects';
alter type relation_type add value if not exists 'enables';
alter type relation_type add value if not exists 'uses';
alter type relation_type add value if not exists 'generated-by';
alter type relation_type add value if not exists 'measured-by';
alter type relation_type add value if not exists 'reported-in';
alter type relation_type add value if not exists 'calculated-from';
alter type relation_type add value if not exists 'validated-by';
alter type relation_type add value if not exists 'conflicts-with';
alter type relation_type add value if not exists 'replaces';
alter type relation_type add value if not exists 'derived-from';
alter type relation_type add value if not exists 'belongs-to';

-- =====================================================
-- 2. TENANCY & IDENTITY
-- =====================================================

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  slug text unique not null check (char_length(trim(slug)) > 0),
  industry text,
  timezone text not null default 'UTC',
  default_language text not null default 'en',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mirror of auth.users for joinable profile data
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_org_members_org on organization_members(organization_id);
create index if not exists idx_org_members_user on organization_members(user_id);

create table if not exists organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role org_role not null default 'viewer',
  invited_by uuid references profiles(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create index if not exists idx_org_invites_email on organization_invites(lower(email));

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,           -- e.g. 'keyword.create', 'member.role_change', 'ai.ask'
  entity_type text,               -- 'keyword' | 'relation' | 'asset' | 'dataset' | ...
  entity_id uuid,
  details jsonb not null default '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_org_created on audit_logs(organization_id, created_at desc);
create index if not exists idx_audit_entity on audit_logs(entity_type, entity_id);

-- =====================================================
-- 3. ADD organization_id TO EXISTING TABLES
-- =====================================================

alter table keywords          add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table keyword_relations add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table assets            add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table chunks            add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table voice_recordings  add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table chat_sessions     add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table datasets          add column if not exists organization_id uuid references organizations(id) on delete cascade;

-- Backfill any pre-existing single-tenant data into a claimable default org
do $$
declare
  default_org uuid := '00000000-0000-0000-0000-000000000000';
  has_orphans boolean;
begin
  select exists (select 1 from keywords where organization_id is null)
      or exists (select 1 from assets where organization_id is null)
      or exists (select 1 from datasets where organization_id is null)
      or exists (select 1 from chat_sessions where organization_id is null)
    into has_orphans;

  if has_orphans then
    insert into organizations (id, name, slug)
    values (default_org, 'Default Organization', 'default')
    on conflict (id) do nothing;

    update keywords set organization_id = default_org where organization_id is null;
    update keyword_relations set organization_id = default_org where organization_id is null;
    update assets set organization_id = default_org where organization_id is null;
    update voice_recordings vr set organization_id = coalesce(
      (select k.organization_id from keywords k where k.id = vr.keyword_id), default_org)
      where vr.organization_id is null;
    update chunks c set organization_id = coalesce(
      (select a.organization_id from assets a where a.id = c.asset_id), default_org)
      where c.organization_id is null;
    update chat_sessions set organization_id = default_org where organization_id is null;
    update datasets set organization_id = default_org where organization_id is null;
  end if;
end $$;

alter table keywords          alter column organization_id set not null;
alter table keyword_relations alter column organization_id set not null;
alter table assets            alter column organization_id set not null;
alter table chunks            alter column organization_id set not null;
alter table datasets          alter column organization_id set not null;

create index if not exists idx_keywords_org on keywords(organization_id);
create index if not exists idx_relations_org on keyword_relations(organization_id);
create index if not exists idx_assets_org on assets(organization_id);
create index if not exists idx_chunks_org on chunks(organization_id);
create index if not exists idx_datasets_org on datasets(organization_id);
create index if not exists idx_chat_sessions_org on chat_sessions(organization_id);

-- Keyword slugs are unique per organization, not globally
alter table keywords drop constraint if exists keywords_slug_key;
create unique index if not exists idx_keywords_org_slug on keywords(organization_id, slug);

-- =====================================================
-- 4. KEYWORD TYPING, STATUS, OWNERSHIP, COMPLETENESS
-- =====================================================

alter table keywords add column if not exists keyword_type keyword_type not null default 'concept';
alter table keywords add column if not exists status keyword_status not null default 'active';
alter table keywords add column if not exists completeness_score integer not null default 0
  check (completeness_score >= 0 and completeness_score <= 100);
alter table keywords add column if not exists owner_member_id uuid references organization_members(id) on delete set null;

-- Asset lifecycle metadata
alter table assets add column if not exists title text;
alter table assets add column if not exists description text;
alter table assets add column if not exists source text;
alter table assets add column if not exists processing_status processing_status not null default 'processed';

-- Dataset ↔ keyword link + status
alter table datasets add column if not exists keyword_id uuid references keywords(id) on delete set null;
alter table datasets add column if not exists status text not null default 'active';
create index if not exists idx_datasets_keyword on datasets(keyword_id);

-- =====================================================
-- 5. KEYWORD VERSIONING (trigger-based snapshots)
-- =====================================================

create table if not exists keyword_versions (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  version_no integer not null,
  snapshot jsonb not null,
  change_type text not null check (change_type in ('UPDATE', 'DELETE')),
  changed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_keyword_versions_keyword on keyword_versions(keyword_id, version_no desc);
create index if not exists idx_keyword_versions_org on keyword_versions(organization_id);

create or replace function snapshot_keyword_version()
returns trigger
language plpgsql
as $$
begin
  insert into keyword_versions (keyword_id, organization_id, version_no, snapshot, change_type)
  values (
    old.id,
    old.organization_id,
    coalesce((select max(version_no) from keyword_versions where keyword_id = old.id), 0) + 1,
    to_jsonb(old),
    tg_op
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists keywords_version_snapshot on keywords;
create trigger keywords_version_snapshot
  before update or delete on keywords
  for each row execute function snapshot_keyword_version();

-- =====================================================
-- 6. INTELLIGENCE FOUNDATION TABLES (features land M6–M10)
-- =====================================================

create table if not exists metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete set null,
  name text not null,
  description text,
  formula text,                        -- human-readable business formula
  aggregation text,                    -- sum | count | avg | min | max | custom
  source_table_id uuid references dataset_tables(id) on delete set null,
  value_column text,
  date_column text,
  dimensions text[] not null default '{}',
  filters jsonb not null default '[]',
  time_grain text not null default 'month',
  caveats text,
  owner_member_id uuid references organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists idx_metrics_org on metrics(organization_id);
create index if not exists idx_metrics_keyword on metrics(keyword_id);

create table if not exists metric_versions (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  version_no integer not null,
  snapshot jsonb not null,
  changed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_metric_versions_metric on metric_versions(metric_id, version_no desc);

create table if not exists ai_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete cascade,
  name text not null,
  description text,
  skill_type text not null default 'qa' check (skill_type in
    ('qa','summary','report','analysis','forecast','workflow','data_quality','classification','extraction','recommendation')),
  required_data jsonb not null default '{}',
  tools_used text[] not null default '{}',
  prompt_template text,
  output_schema jsonb,
  min_role org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_skills_org on ai_skills(organization_id);
create index if not exists idx_ai_skills_keyword on ai_skills(keyword_id);

create table if not exists ai_context_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  session_id uuid references chat_sessions(id) on delete set null,
  message_id uuid references chat_messages(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  question text,
  intent text,
  context jsonb not null default '{}',   -- keywords/relations/chunks/rows/tools used
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_context_logs_org on ai_context_logs(organization_id, created_at desc);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete set null,
  title text not null,
  report_type text not null default 'custom',
  period_start date,
  period_end date,
  sections jsonb not null default '[]',
  sources jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft','final','archived')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reports_org on reports(organization_id, created_at desc);

create table if not exists report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  version_no integer not null,
  snapshot jsonb not null,
  changed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete set null,
  parent_task_id uuid references tasks(id) on delete cascade,
  title text not null,
  description text,
  status task_status not null default 'todo',
  priority task_priority not null default 'medium',
  assignee_member_id uuid references organization_members(id) on delete set null,
  due_date date,
  source_asset_id uuid references assets(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_org_status on tasks(organization_id, status);
create index if not exists idx_tasks_keyword on tasks(keyword_id);
create index if not exists idx_tasks_parent on tasks(parent_task_id);

create table if not exists task_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on_task_id uuid not null references tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete set null,
  name text not null,
  description text,
  is_template boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete set null,
  step_order integer not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (workflow_id, step_order)
);

create table if not exists data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null,           -- 'keyword' | 'dataset_table' | 'dataset_row' | 'relation'
  entity_id uuid not null,
  issue_type text not null,            -- 'missing_field' | 'duplicate' | 'invalid_value' | 'undefined_keyword' | ...
  severity text not null default 'warning' check (severity in ('info','warning','error')),
  description text,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dq_issues_org_status on data_quality_issues(organization_id, status);

create table if not exists forecasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  metric_id uuid references metrics(id) on delete cascade,
  name text not null,
  horizon_periods integer not null default 3,
  time_grain text not null default 'month',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists forecast_runs (
  id uuid primary key default gen_random_uuid(),
  forecast_id uuid not null references forecasts(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  model text,
  history_points integer,
  assumptions jsonb not null default '{}',
  results jsonb not null default '[]',   -- [{period, value, lower, upper}]
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  created_at timestamptz not null default now()
);

-- =====================================================
-- 7. updated_at TRIGGERS FOR NEW TABLES
-- =====================================================

do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','organization_members','metrics',
                           'ai_skills','reports','tasks','workflows','data_quality_issues']
  loop
    execute format('drop trigger if exists %I_updated_at on %I', t, t);
    execute format('create trigger %I_updated_at before update on %I
                    for each row execute function update_updated_at()', t, t);
  end loop;
end $$;

-- =====================================================
-- 8. ROW LEVEL SECURITY
-- API routes enforce permissions in code with the service
-- client; RLS is defense-in-depth for anon/browser access.
-- =====================================================

create or replace function public.current_member_role(org uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select role::text from organization_members
  where organization_id = org and user_id = auth.uid()
  limit 1;
$$;

-- Tenant content tables: members read; content roles write
do $$
declare t text;
begin
  foreach t in array array[
    'keywords','keyword_relations','assets','keyword_assets','chunks','voice_recordings',
    'chat_sessions','chat_messages','datasets','dataset_tables','dataset_columns','dataset_rows',
    'keyword_versions','metrics','metric_versions','ai_skills','ai_context_logs',
    'reports','report_versions','tasks','task_dependencies','workflows','workflow_steps',
    'data_quality_issues','forecasts','forecast_runs'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Tables with a direct organization_id column get member policies
do $$
declare t text;
begin
  foreach t in array array[
    'keywords','keyword_relations','assets','chunks','voice_recordings','chat_sessions',
    'datasets','keyword_versions','metrics','metric_versions','ai_skills','ai_context_logs',
    'reports','report_versions','tasks','task_dependencies','workflows','workflow_steps',
    'data_quality_issues','forecasts','forecast_runs'
  ]
  loop
    execute format('drop policy if exists %I_member_select on %I', t, t);
    execute format('create policy %I_member_select on %I for select
                    using (public.current_member_role(organization_id) is not null)', t, t);
    execute format('drop policy if exists %I_editor_write on %I', t, t);
    execute format('create policy %I_editor_write on %I for all
                    using (public.current_member_role(organization_id) in (''owner'',''admin'',''manager'',''editor''))
                    with check (public.current_member_role(organization_id) in (''owner'',''admin'',''manager'',''editor''))', t, t);
  end loop;
end $$;

-- Child tables scoped via parent
drop policy if exists keyword_assets_member_select on keyword_assets;
create policy keyword_assets_member_select on keyword_assets for select
  using (exists (select 1 from keywords k where k.id = keyword_id
                 and public.current_member_role(k.organization_id) is not null));
drop policy if exists keyword_assets_editor_write on keyword_assets;
create policy keyword_assets_editor_write on keyword_assets for all
  using (exists (select 1 from keywords k where k.id = keyword_id
                 and public.current_member_role(k.organization_id) in ('owner','admin','manager','editor')));

drop policy if exists chat_messages_member_select on chat_messages;
create policy chat_messages_member_select on chat_messages for select
  using (exists (select 1 from chat_sessions s where s.id = session_id
                 and public.current_member_role(s.organization_id) is not null));

drop policy if exists dataset_tables_member_select on dataset_tables;
create policy dataset_tables_member_select on dataset_tables for select
  using (exists (select 1 from datasets d where d.id = dataset_id
                 and public.current_member_role(d.organization_id) is not null));

drop policy if exists dataset_columns_member_select on dataset_columns;
create policy dataset_columns_member_select on dataset_columns for select
  using (exists (select 1 from dataset_tables dt join datasets d on d.id = dt.dataset_id
                 where dt.id = dataset_table_id
                 and public.current_member_role(d.organization_id) is not null));

drop policy if exists dataset_rows_member_select on dataset_rows;
create policy dataset_rows_member_select on dataset_rows for select
  using (exists (select 1 from dataset_tables dt join datasets d on d.id = dt.dataset_id
                 where dt.id = dataset_table_id
                 and public.current_member_role(d.organization_id) is not null));

-- Org/identity tables
alter table organizations enable row level security;
drop policy if exists organizations_member_select on organizations;
create policy organizations_member_select on organizations for select
  using (public.current_member_role(id) is not null);
drop policy if exists organizations_admin_update on organizations;
create policy organizations_admin_update on organizations for update
  using (public.current_member_role(id) in ('owner','admin'));

alter table profiles enable row level security;
drop policy if exists profiles_self_select on profiles;
create policy profiles_self_select on profiles for select using (auth.uid() = id);
drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update using (auth.uid() = id);

alter table organization_members enable row level security;
drop policy if exists org_members_member_select on organization_members;
create policy org_members_member_select on organization_members for select
  using (public.current_member_role(organization_id) is not null);
drop policy if exists org_members_admin_write on organization_members;
create policy org_members_admin_write on organization_members for all
  using (public.current_member_role(organization_id) in ('owner','admin'));

alter table organization_invites enable row level security;
drop policy if exists org_invites_admin_all on organization_invites;
create policy org_invites_admin_all on organization_invites for all
  using (public.current_member_role(organization_id) in ('owner','admin'));

alter table audit_logs enable row level security;
drop policy if exists audit_admin_select on audit_logs;
create policy audit_admin_select on audit_logs for select
  using (public.current_member_role(organization_id) in ('owner','admin'));
-- append-only: no update/delete policies on audit_logs

-- ============ MIGRATION 0003 ============
-- =====================================================
-- Migration 0003: Keyword version noise reduction (Milestone 2)
-- Skip version snapshots when only completeness_score /
-- updated_at changed, so automatic rescoring does not
-- pollute the version history.
-- =====================================================

create or replace function snapshot_keyword_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(old) - 'completeness_score' - 'updated_at')
       = (to_jsonb(new) - 'completeness_score' - 'updated_at') then
    return new;
  end if;

  insert into keyword_versions (keyword_id, organization_id, version_no, snapshot, change_type)
  values (
    old.id,
    old.organization_id,
    coalesce((select max(version_no) from keyword_versions where keyword_id = old.id), 0) + 1,
    to_jsonb(old),
    tg_op
  );
  return coalesce(new, old);
end;
$$;

-- ============ MIGRATION 0004 ============
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

-- ============ MIGRATION 0005 ============
-- =====================================================
-- Migration 0005: Semantic column mapping (Milestone 5)
-- Business meaning on dataset columns: semantic name,
-- description, required flag, validation rules.
-- =====================================================

alter table dataset_columns add column if not exists semantic_name text;
alter table dataset_columns add column if not exists description text;
alter table dataset_columns add column if not exists is_required boolean not null default false;
alter table dataset_columns add column if not exists validation_rules jsonb not null default '{}';

create index if not exists idx_dataset_columns_semantic on dataset_columns(semantic_name);

-- ============ MIGRATION 0006 ============
-- =====================================================
-- Migration 0006: Keyword access levels
-- Three visibility tiers so a Worker sees only worker-level
-- keywords, a Bauleiter/Schichtleiter (manager) sees worker +
-- manager, and Admin/Owner see everything.
-- =====================================================

do $$ begin
  create type keyword_access_level as enum ('worker', 'manager', 'admin');
exception when duplicate_object then null; end $$;

alter table keywords
  add column if not exists access_level keyword_access_level not null default 'worker';

create index if not exists idx_keywords_access_level on keywords(access_level);

-- Numeric tier for the current member's role in an organization.
create or replace function public.current_access_tier(org uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select case public.current_member_role(org)
    when 'owner' then 3
    when 'admin' then 3
    when 'manager' then 2
    when 'editor' then 2
    when 'analyst' then 1
    when 'viewer' then 1
    when 'guest' then 1
    else 0
  end;
$$;

-- Tighten the keyword read policy to respect access levels (defense-in-depth;
-- the app also filters at query time with the service client).
drop policy if exists keywords_member_select on keywords;
create policy keywords_member_select on keywords for select
  using (
    public.current_member_role(organization_id) is not null
    and public.current_access_tier(organization_id) >=
        case access_level
          when 'worker' then 1
          when 'manager' then 2
          when 'admin' then 3
        end
  );
-- =====================================================
-- Migration 0007: AI answer feedback
-- Human feedback on AI answers (thumbs up/down + optional
-- correction). Negative feedback with a correction feeds the
-- "learned guidance" context immediately; all rows accumulate
-- into a fine-tuning dataset (npm run export:finetune).
-- =====================================================

create table if not exists ai_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  question text not null,
  answer text not null,
  rating smallint not null check (rating in (-1, 1)),
  correction text,
  context_keyword_ids uuid[] not null default '{}',
  model text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_feedback_org on ai_feedback(organization_id, created_at desc);

alter table ai_feedback enable row level security;

drop policy if exists ai_feedback_member_select on ai_feedback;
create policy ai_feedback_member_select on ai_feedback for select
  using (public.current_member_role(organization_id) is not null);

drop policy if exists ai_feedback_member_insert on ai_feedback;
create policy ai_feedback_member_insert on ai_feedback for insert
  with check (
    public.current_member_role(organization_id) is not null
    and user_id = auth.uid()
  );
