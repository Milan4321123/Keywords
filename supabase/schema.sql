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
