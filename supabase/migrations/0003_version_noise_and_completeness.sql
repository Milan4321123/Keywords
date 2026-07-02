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
