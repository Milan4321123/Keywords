-- =====================================================
-- Seed data for Company Brain (demo) — multi-tenant aware
-- Seeds Invoice / Approval / Payment into your FIRST organization.
-- Safe to run multiple times. Run AFTER you have signed up and
-- created an organization in the app.
--
-- NOTE: chunks are seeded WITHOUT embeddings; hybrid retrieval
-- (match_chunks_hybrid) still finds them via full-text search.
-- =====================================================

do $$
begin
  if not exists (select 1 from organizations) then
    raise exception
      'No organization found. Sign up in the app and create your organization first, then run this seed.';
  end if;
end $$;

begin;

-- Target org = the earliest-created organization (your main workspace)
-- Remove any prior seeded demo assets/chunks for that org (safe filename prefix)
delete from chunks
 where asset_id in (
   select a.id from assets a
   where a.file_name like 'seed__%'
     and a.organization_id = (select id from organizations order by created_at asc limit 1)
 );
delete from keyword_assets
 where asset_id in (
   select a.id from assets a
   where a.file_name like 'seed__%'
     and a.organization_id = (select id from organizations order by created_at asc limit 1)
 );
delete from assets
 where file_name like 'seed__%'
   and organization_id = (select id from organizations order by created_at asc limit 1);

-- -----------------------------------------------------
-- Keywords (upsert on the per-organization slug uniqueness)
-- -----------------------------------------------------
with org as (
  select id from organizations order by created_at asc limit 1
),
data(title, slug, definition, explanation, examples, synonyms, labels_json, rules) as (
  values
    (
      'Invoice', 'invoice',
      'A billing document from a supplier requesting payment.',
      'Invoices must be matched to a purchase/contract context and approved before payment. They typically include supplier, invoice number, date, line items, tax/VAT, and total.',
      array['Vendor invoice for materials', 'Subcontractor labor invoice'],
      array['bill', 'supplier invoice'],
      '{"de":"Rechnung","en":"Invoice"}'::jsonb,
      array['Must be approved before payment', 'Must include invoice number and supplier']
    ),
    (
      'Approval', 'approval',
      'Authorization required before proceeding with an action.',
      'Approval is required for high-risk or high-value actions. For invoices, approval confirms the work was delivered and the amount is valid.',
      array['Approve an invoice above $5,000'],
      array['authorization', 'sign-off'],
      '{"de":"Freigabe","en":"Approval"}'::jsonb,
      array['Track approver and timestamp']
    ),
    (
      'Payment', 'payment',
      'Transfer of funds to a supplier/contractor.',
      'Payments must only occur after invoice approval and must reference the correct invoice number. Payment terms and due dates matter for cash flow.',
      array['Pay invoice INV-1002 via bank transfer'],
      array['settlement'],
      '{"de":"Zahlung","en":"Payment"}'::jsonb,
      array['Do not pay without approval']
    )
)
insert into keywords (organization_id, parent_id, title, slug, definition, explanation, examples, synonyms, labels_json, rules)
select org.id, null, d.title, d.slug, d.definition, d.explanation, d.examples, d.synonyms, d.labels_json, d.rules
from data d cross join org
on conflict (organization_id, slug) do update set
  title = excluded.title,
  definition = excluded.definition,
  explanation = excluded.explanation,
  examples = excluded.examples,
  synonyms = excluded.synonyms,
  labels_json = excluded.labels_json,
  rules = excluded.rules;

-- -----------------------------------------------------
-- Relations (Invoice requires Approval; Payment depends-on Approval)
-- -----------------------------------------------------
with org as (select id from organizations order by created_at asc limit 1),
ids as (
  select
    (select id from keywords where slug = 'invoice'  and organization_id = org.id) as invoice_id,
    (select id from keywords where slug = 'approval' and organization_id = org.id) as approval_id,
    (select id from keywords where slug = 'payment'  and organization_id = org.id) as payment_id,
    org.id as org_id
  from org
)
insert into keyword_relations (organization_id, from_keyword_id, relation_type, to_keyword_id, note, strength, bidirectional)
select ids.org_id, ids.invoice_id, 'requires'::relation_type, ids.approval_id,
       'Invoices require approval before payment.', 9, false
from ids
where ids.invoice_id is not null and ids.approval_id is not null
on conflict (from_keyword_id, relation_type, to_keyword_id) do update set
  note = excluded.note, strength = excluded.strength;

with org as (select id from organizations order by created_at asc limit 1),
ids as (
  select
    (select id from keywords where slug = 'approval' and organization_id = org.id) as approval_id,
    (select id from keywords where slug = 'payment'  and organization_id = org.id) as payment_id,
    org.id as org_id
  from org
)
insert into keyword_relations (organization_id, from_keyword_id, relation_type, to_keyword_id, note, strength, bidirectional)
select ids.org_id, ids.payment_id, 'depends-on'::relation_type, ids.approval_id,
       'Payment depends on approval.', 8, false
from ids
where ids.payment_id is not null and ids.approval_id is not null
on conflict (from_keyword_id, relation_type, to_keyword_id) do update set
  note = excluded.note, strength = excluded.strength;

-- -----------------------------------------------------
-- Assets (fake URLs for demo). meta_json.org_id enables hybrid retrieval scoping.
-- -----------------------------------------------------
with org as (select id from organizations order by created_at asc limit 1)
insert into assets (organization_id, file_name, file_url, file_type, mime_type, file_size, extracted_text, processed, processing_status, meta_json)
select org.id, v.file_name, v.file_url, 'text'::asset_type, 'text/plain', v.file_size, v.extracted_text, true, 'processed',
       jsonb_build_object('org_id', org.id::text, 'source', 'seed')
from org, (values
  (
    'seed__invoice_policy.txt',
    'https://example.invalid/assets/seed__invoice_policy.txt',
    1234,
    'Invoice policy: invoices must be approved before payment. Approval threshold: invoices above $5,000 require Finance approval. All invoices must include supplier name, invoice number, invoice date, line items, VAT/tax, and total.'
  ),
  (
    'seed__ap_workflow.txt',
    'https://example.invalid/assets/seed__ap_workflow.txt',
    2345,
    'Accounts Payable workflow: 1) Receive invoice 2) Validate supplier & PO/contract 3) Route for approval 4) Schedule payment 5) Archive. Payment terms: Net 30 unless contract specifies otherwise.'
  )
) as v(file_name, file_url, file_size, extracted_text);

-- Link assets to keywords
with org as (select id from organizations order by created_at asc limit 1),
ids as (
  select
    (select id from keywords where slug = 'invoice' and organization_id = org.id) as invoice_keyword_id,
    (select id from assets where file_name = 'seed__invoice_policy.txt' and organization_id = org.id order by created_at desc limit 1) as invoice_asset_id
  from org
)
insert into keyword_assets (keyword_id, asset_id, relevance_score, note)
select ids.invoice_keyword_id, ids.invoice_asset_id, 10, 'Policy text describing invoice requirements.'
from ids
where ids.invoice_keyword_id is not null and ids.invoice_asset_id is not null
on conflict (keyword_id, asset_id) do update set relevance_score = excluded.relevance_score, note = excluded.note;

with org as (select id from organizations order by created_at asc limit 1),
ids as (
  select
    (select id from keywords where slug = 'approval' and organization_id = org.id) as approval_keyword_id,
    (select id from assets where file_name = 'seed__ap_workflow.txt' and organization_id = org.id order by created_at desc limit 1) as ap_asset_id
  from org
)
insert into keyword_assets (keyword_id, asset_id, relevance_score, note)
select ids.approval_keyword_id, ids.ap_asset_id, 8, 'Workflow includes approval and routing.'
from ids
where ids.approval_keyword_id is not null and ids.ap_asset_id is not null
on conflict (keyword_id, asset_id) do update set relevance_score = excluded.relevance_score, note = excluded.note;

-- -----------------------------------------------------
-- Chunks (text-only; embedding intentionally NULL)
-- -----------------------------------------------------
with org as (select id from organizations order by created_at asc limit 1),
ids as (
  select
    (select id from keywords where slug = 'invoice' and organization_id = org.id) as invoice_keyword_id,
    (select id from assets where file_name = 'seed__invoice_policy.txt' and organization_id = org.id order by created_at desc limit 1) as invoice_asset_id,
    org.id as org_id
  from org
)
insert into chunks (organization_id, asset_id, keyword_id, chunk_index, chunk_text, chunk_type, embedding, token_count, meta_json)
select ids.org_id, ids.invoice_asset_id, ids.invoice_keyword_id, 0,
  'Invoices must be approved before payment. Invoices above $5,000 require Finance approval. Required fields: supplier name, invoice number, invoice date, line items, VAT/tax, total.',
  'text', null, 60, '{"source":"seed__invoice_policy.txt","section":"requirements"}'::jsonb
from ids
where ids.invoice_asset_id is not null
on conflict (asset_id, chunk_index) do nothing;

with org as (select id from organizations order by created_at asc limit 1),
ids as (
  select
    (select id from assets where file_name = 'seed__ap_workflow.txt' and organization_id = org.id order by created_at desc limit 1) as ap_asset_id,
    org.id as org_id
  from org
)
insert into chunks (organization_id, asset_id, keyword_id, chunk_index, chunk_text, chunk_type, embedding, token_count, meta_json)
select ids.org_id, ids.ap_asset_id, null, 0,
  'AP workflow: Receive invoice → validate supplier & PO/contract → route for approval → schedule payment → archive. Payment terms: Net 30 unless contract specifies otherwise.',
  'text', null, 55, '{"source":"seed__ap_workflow.txt","section":"process"}'::jsonb
from ids
where ids.ap_asset_id is not null
on conflict (asset_id, chunk_index) do nothing;

commit;
