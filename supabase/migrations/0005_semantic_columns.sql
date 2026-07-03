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
