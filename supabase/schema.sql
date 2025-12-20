-- =====================================================
-- Company Knowledge Base Schema for Supabase
-- =====================================================

-- Enable the pgvector extension for embeddings
create extension if not exists vector;

-- =====================================================
-- KEYWORDS TABLE (Ontology Nodes)
-- =====================================================
create table keywords (
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
  updated_at timestamptz default now()
);

-- Index for parent-child queries
create index idx_keywords_parent on keywords(parent_id);
create index idx_keywords_slug on keywords(slug);

-- =====================================================
-- KEYWORD RELATIONS TABLE (Edges in the Knowledge Graph)
-- =====================================================
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

create table keyword_relations (
  id uuid primary key default gen_random_uuid(),
  from_keyword_id uuid not null references keywords(id) on delete cascade,
  relation_type relation_type not null,
  to_keyword_id uuid not null references keywords(id) on delete cascade,
  note text, -- optional explanation of the relation
  strength integer default 5 check (strength >= 1 and strength <= 10), -- relation strength 1-10
  bidirectional boolean default false,
  created_at timestamptz default now(),
  
  -- Prevent duplicate relations
  unique(from_keyword_id, relation_type, to_keyword_id)
);

create index idx_relations_from on keyword_relations(from_keyword_id);
create index idx_relations_to on keyword_relations(to_keyword_id);
create index idx_relations_type on keyword_relations(relation_type);

-- =====================================================
-- ASSETS TABLE (Uploaded Files/Evidence)
-- =====================================================
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

create table assets (
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

create index idx_assets_type on assets(file_type);
create index idx_assets_processed on assets(processed);

-- =====================================================
-- KEYWORD_ASSETS TABLE (Many-to-Many Link)
-- =====================================================
create table keyword_assets (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references keywords(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  relevance_score integer default 5 check (relevance_score >= 1 and relevance_score <= 10),
  note text, -- why this asset is linked to this keyword
  created_at timestamptz default now(),
  
  unique(keyword_id, asset_id)
);

create index idx_ka_keyword on keyword_assets(keyword_id);
create index idx_ka_asset on keyword_assets(asset_id);

-- =====================================================
-- CHUNKS TABLE (For RAG - Document Chunks with Embeddings)
-- =====================================================
create table chunks (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id) on delete cascade,
  keyword_id uuid references keywords(id) on delete set null, -- optional direct keyword link
  chunk_index integer not null, -- order within the source
  chunk_text text not null,
  chunk_type text default 'text', -- 'text', 'table', 'heading', etc.
  embedding vector(1536), -- OpenAI ada-002 embedding dimension
  token_count integer,
  meta_json jsonb default '{}', -- page number, section, etc.
  created_at timestamptz default now()
);

create index idx_chunks_asset on chunks(asset_id);
create index idx_chunks_keyword on chunks(keyword_id);

-- Create a vector index for similarity search
create index idx_chunks_embedding on chunks 
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- =====================================================
-- VOICE RECORDINGS TABLE (Optional - Store Original Audio)
-- =====================================================
create table voice_recordings (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid references keywords(id) on delete cascade,
  audio_url text not null,
  transcription text,
  duration_seconds integer,
  field_updated text, -- 'definition', 'explanation', 'example'
  created_by uuid,
  created_at timestamptz default now()
);

create index idx_voice_keyword on voice_recordings(keyword_id);

-- =====================================================
-- CHAT HISTORY TABLE (For Context in Conversations)
-- =====================================================
create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  title text,
  context_keywords uuid[], -- keywords used as context
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  sources_json jsonb default '[]', -- references to keywords/assets used
  token_count integer,
  created_at timestamptz default now()
);

create index idx_chat_messages_session on chat_messages(session_id);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to search chunks by embedding similarity
create or replace function match_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_keyword_ids uuid[] default null
)
returns table (
  id uuid,
  asset_id uuid,
  keyword_id uuid,
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
    c.chunk_text,
    c.chunk_type,
    c.meta_json,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
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
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
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

create trigger keywords_updated_at
  before update on keywords
  for each row execute function update_updated_at();

create trigger assets_updated_at
  before update on assets
  for each row execute function update_updated_at();

create trigger chat_sessions_updated_at
  before update on chat_sessions
  for each row execute function update_updated_at();

-- =====================================================
-- DATASETS (Structured uploads for grounded analytics)
-- =====================================================

create table datasets (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id) on delete set null,
  title text not null,
  description text,
  created_by uuid,
  created_at timestamptz default now()
);

create index idx_datasets_asset on datasets(asset_id);

create table dataset_tables (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  name text not null,
  row_count integer default 0,
  column_count integer default 0,
  meta_json jsonb default '{}',
  created_at timestamptz default now(),
  unique(dataset_id, name)
);

create index idx_dataset_tables_dataset on dataset_tables(dataset_id);

create type dataset_column_type as enum ('text', 'number', 'date', 'boolean', 'json');

create table dataset_columns (
  id uuid primary key default gen_random_uuid(),
  dataset_table_id uuid not null references dataset_tables(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  data_type dataset_column_type not null default 'text',
  sample_values text[] default '{}',
  created_at timestamptz default now(),
  unique(dataset_table_id, normalized_name)
);

create index idx_dataset_columns_table on dataset_columns(dataset_table_id);

create table dataset_rows (
  id uuid primary key default gen_random_uuid(),
  dataset_table_id uuid not null references dataset_tables(id) on delete cascade,
  row_index integer not null,
  data jsonb not null,
  source_json jsonb default '{}',
  created_at timestamptz default now(),
  unique(dataset_table_id, row_index)
);

create index idx_dataset_rows_table on dataset_rows(dataset_table_id);
create index idx_dataset_rows_data_gin on dataset_rows using gin (data jsonb_path_ops);

-- =====================================================
-- ROW LEVEL SECURITY (Optional - Enable as needed)
-- =====================================================

-- Enable RLS on all tables
-- alter table keywords enable row level security;
-- alter table keyword_relations enable row level security;
-- alter table assets enable row level security;
-- alter table keyword_assets enable row level security;
-- alter table chunks enable row level security;

-- =====================================================
-- SAMPLE DATA FOR TESTING
-- =====================================================

-- Insert root keywords for a construction/property management domain
insert into keywords (id, title, slug, definition, explanation) values
  ('00000000-0000-0000-0000-000000000001', 'Projects', 'projects', 
   'Construction or renovation projects', 
   'A project is a defined scope of construction work with a start date, end date, budget, and assigned team.'),
  ('00000000-0000-0000-0000-000000000002', 'Documents', 'documents', 
   'All business documents and paperwork', 
   'Documents include invoices, contracts, permits, reports, and any official paperwork related to operations.'),
  ('00000000-0000-0000-0000-000000000003', 'Roles', 'roles', 
   'People and their responsibilities', 
   'Roles define who does what in the organization - from project managers to site workers.'),
  ('00000000-0000-0000-0000-000000000004', 'Properties', 'properties', 
   'Real estate and rental units', 
   'Properties include buildings, apartments, commercial spaces that we own or manage.');

-- Insert sub-keywords
insert into keywords (parent_id, title, slug, definition) values
  ('00000000-0000-0000-0000-000000000002', 'Invoice', 'invoice', 
   'A billing document from a supplier requesting payment for goods or services'),
  ('00000000-0000-0000-0000-000000000002', 'Contract', 'contract', 
   'A legal agreement between parties defining terms, scope, and obligations'),
  ('00000000-0000-0000-0000-000000000002', 'Approval', 'approval', 
   'Authorization required before proceeding with an action or payment'),
  ('00000000-0000-0000-0000-000000000001', 'Trade', 'trade', 
   'A specific craft or discipline within construction (e.g., electrical, plumbing)'),
  ('00000000-0000-0000-0000-000000000001', 'Defect', 'defect', 
   'A flaw or issue in construction work that needs correction'),
  ('00000000-0000-0000-0000-000000000003', 'Bauleiter', 'bauleiter', 
   'Site manager responsible for overseeing construction progress'),
  ('00000000-0000-0000-0000-000000000004', 'Tenant', 'tenant', 
   'A person or business renting a property'),
  ('00000000-0000-0000-0000-000000000004', 'Unit', 'unit', 
   'An individual apartment or space within a building');
