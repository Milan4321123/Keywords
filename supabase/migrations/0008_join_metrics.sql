-- =====================================================
-- Migration 0008: Cross-table (join) metrics
-- A metric may join a second table before aggregating:
-- join_spec = { "right_table_id": uuid, "left_key": text,
--               "right_key": text, "join_type": "inner"|"left",
--               "prefix": text }
-- =====================================================

alter table metrics add column if not exists join_spec jsonb;
