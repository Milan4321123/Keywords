-- =====================================================
-- Grounded Analytics Tables (upgrade script)
-- Run this if your existing project was created before
-- `datasets`/`dataset_tables`/`dataset_rows` were added.
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

do $$
begin
  if not exists (select 1 from pg_type where typname = 'dataset_column_type') then
    create type dataset_column_type as enum ('text', 'number', 'date', 'boolean', 'json');
  end if;
end
$$;

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

