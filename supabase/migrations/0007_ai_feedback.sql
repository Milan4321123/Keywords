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
