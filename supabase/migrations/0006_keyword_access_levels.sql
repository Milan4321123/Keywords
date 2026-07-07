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
