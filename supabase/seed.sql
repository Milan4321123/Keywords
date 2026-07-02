-- =====================================================
-- Seed data for Company Knowledge Base (demo)
-- Safe to run multiple times.
-- =====================================================

-- NOTE: This seed intentionally inserts chunks WITHOUT embeddings.
-- Hybrid retrieval (match_chunks_hybrid) can still find them via full-text search.

begin;

-- Clean up any prior seeded demo assets/chunks (uses a safe filename prefix)
delete from chunks where asset_id in (select id from assets where file_name like 'seed__%');
delete from keyword_assets where asset_id in (select id from assets where file_name like 'seed__%');
delete from assets where file_name like 'seed__%';

-- -----------------------------------------------------
-- Keywords
-- -----------------------------------------------------
with upsert_keywords as (
  insert into keywords (parent_id, title, slug, definition, explanation, examples, synonyms, labels_json, rules)
  values
    (
      null,
      'Invoice',
      'invoice',
      'A billing document from a supplier requesting payment.',
      'Invoices must be matched to a purchase/contract context and approved before payment. They typically include supplier, invoice number, date, line items, tax/VAT, and total.',
      array['Vendor invoice for materials', 'Subcontractor labor invoice'],
      array['bill', 'supplier invoice'],
      '{"de":"Rechnung","en":"Invoice"}'::jsonb,
      array['Must be approved before payment', 'Must include invoice number and supplier']
    ),
    (
      null,
      'Approval',
      'approval',
      'Authorization required before proceeding with an action.',
      'Approval is required for high-risk or high-value actions. For invoices, approval confirms the work was delivered and the amount is valid.',
      array['Approve an invoice above $5,000'],
      array['authorization', 'sign-off'],
      '{"de":"Freigabe","en":"Approval"}'::jsonb,
      array['Track approver and timestamp']
    ),
    (
      null,
      'Payment',
      'payment',
      'Transfer of funds to a supplier/contractor.',
      'Payments must only occur after invoice approval and must reference the correct invoice number. Payment terms and due dates matter for cash flow.',
      array['Pay invoice INV-1002 via bank transfer'],
      array['settlement'],
      '{"de":"Zahlung","en":"Payment"}'::jsonb,
      array['Do not pay without approval']
    )
  on conflict (slug) do update set
    parent_id = excluded.parent_id,
    title = excluded.title,
    definition = excluded.definition,
    explanation = excluded.explanation,
    examples = excluded.examples,
    synonyms = excluded.synonyms,
    labels_json = excluded.labels_json,
    rules = excluded.rules
  returning id, slug
),
kw_invoice as (
  select id as keyword_id from upsert_keywords where slug = 'invoice'
),
kw_approval as (
  select id as keyword_id from upsert_keywords where slug = 'approval'
),
kw_payment as (
  select id as keyword_id from upsert_keywords where slug = 'payment'
)
select 1;

-- -----------------------------------------------------
-- Relations
-- -----------------------------------------------------
with ids as (
  select
    (select id from keywords where slug = 'invoice') as invoice_id,
    (select id from keywords where slug = 'approval') as approval_id,
    (select id from keywords where slug = 'payment') as payment_id
)
insert into keyword_relations (from_keyword_id, relation_type, to_keyword_id, note, strength, bidirectional)
select
  ids.invoice_id,
  'requires'::relation_type,
  ids.approval_id,
  'Invoices require approval before payment.',
  9,
  false
from ids
where ids.invoice_id is not null and ids.approval_id is not null
on conflict (from_keyword_id, relation_type, to_keyword_id) do update set
  note = excluded.note,
  strength = excluded.strength,
  bidirectional = excluded.bidirectional;

with ids as (
  select
    (select id from keywords where slug = 'approval') as approval_id,
    (select id from keywords where slug = 'payment') as payment_id
)
insert into keyword_relations (from_keyword_id, relation_type, to_keyword_id, note, strength, bidirectional)
select
  ids.payment_id,
  'depends-on'::relation_type,
  ids.approval_id,
  'Payment depends on approval.',
  8,
  false
from ids
where ids.payment_id is not null and ids.approval_id is not null
on conflict (from_keyword_id, relation_type, to_keyword_id) do update set
  note = excluded.note,
  strength = excluded.strength,
  bidirectional = excluded.bidirectional;

-- -----------------------------------------------------
-- Assets (fake URLs for demo)
-- -----------------------------------------------------
with inserted_assets as (
  insert into assets (file_name, file_url, file_type, mime_type, file_size, extracted_text, processed)
  values
    (
      'seed__invoice_policy.txt',
      'https://example.invalid/assets/seed__invoice_policy.txt',
      'text',
      'text/plain',
      1234,
      'Invoice policy: invoices must be approved before payment. Approval threshold: invoices above $5,000 require Finance approval. All invoices must include supplier name, invoice number, invoice date, line items, VAT/tax, and total.',
      true
    ),
    (
      'seed__ap_workflow.txt',
      'https://example.invalid/assets/seed__ap_workflow.txt',
      'text',
      'text/plain',
      2345,
      'Accounts Payable workflow: 1) Receive invoice 2) Validate supplier & PO/contract 3) Route for approval 4) Schedule payment 5) Archive. Payment terms: Net 30 unless contract specifies otherwise.',
      true
    )
  returning id, file_name
),
ids as (
  select
    (select id from keywords where slug = 'invoice') as invoice_keyword_id,
    (select id from keywords where slug = 'approval') as approval_keyword_id,
    (select id from inserted_assets where file_name = 'seed__invoice_policy.txt') as invoice_asset_id,
    (select id from inserted_assets where file_name = 'seed__ap_workflow.txt') as ap_asset_id
)
select 1;

-- Set demo scope on seeded assets (used by org scoping in retrieval)
update assets
set meta_json = coalesce(meta_json, '{}'::jsonb) || jsonb_build_object('org_id', 'demo')
where file_name like 'seed__%';

-- Link assets to keywords
with ids as (
  select
    (select id from keywords where slug = 'invoice') as invoice_keyword_id,
    (select id from keywords where slug = 'approval') as approval_keyword_id,
    (select id from assets where file_name = 'seed__invoice_policy.txt' order by created_at desc limit 1) as invoice_asset_id,
    (select id from assets where file_name = 'seed__ap_workflow.txt' order by created_at desc limit 1) as ap_asset_id
)
insert into keyword_assets (keyword_id, asset_id, relevance_score, note)
select
  ids.invoice_keyword_id,
  ids.invoice_asset_id,
  10,
  'Policy text describing invoice requirements.'
from ids
where ids.invoice_keyword_id is not null and ids.invoice_asset_id is not null
on conflict (keyword_id, asset_id) do update set
  relevance_score = excluded.relevance_score,
  note = excluded.note;

with ids as (
  select
    (select id from keywords where slug = 'approval') as approval_keyword_id,
    (select id from assets where file_name = 'seed__ap_workflow.txt' order by created_at desc limit 1) as ap_asset_id
)
insert into keyword_assets (keyword_id, asset_id, relevance_score, note)
select
  ids.approval_keyword_id,
  ids.ap_asset_id,
  8,
  'Workflow includes approval and routing.'
from ids
where ids.approval_keyword_id is not null and ids.ap_asset_id is not null
on conflict (keyword_id, asset_id) do update set
  relevance_score = excluded.relevance_score,
  note = excluded.note;

-- -----------------------------------------------------
-- Chunks (text-only; embedding intentionally NULL)
-- -----------------------------------------------------
with ids as (
  select
    (select id from keywords where slug = 'invoice') as invoice_keyword_id,
    (select id from assets where file_name = 'seed__invoice_policy.txt' order by created_at desc limit 1) as invoice_asset_id,
    (select id from assets where file_name = 'seed__ap_workflow.txt' order by created_at desc limit 1) as ap_asset_id
)
insert into chunks (asset_id, keyword_id, chunk_index, chunk_text, chunk_type, embedding, token_count, meta_json)
select
  ids.invoice_asset_id,
  ids.invoice_keyword_id,
  0,
  'Invoices must be approved before payment. Invoices above $5,000 require Finance approval. Required fields: supplier name, invoice number, invoice date, line items, VAT/tax, total.',
  'text',
  null,
  60,
  '{"source":"seed__invoice_policy.txt","section":"requirements"}'::jsonb
from ids
where ids.invoice_asset_id is not null
;

with ids as (
  select (select id from assets where file_name = 'seed__ap_workflow.txt' order by created_at desc limit 1) as ap_asset_id
)
insert into chunks (asset_id, keyword_id, chunk_index, chunk_text, chunk_type, embedding, token_count, meta_json)
select
  ids.ap_asset_id,
  null,
  0,
  'AP workflow: Receive invoice → validate supplier & PO/contract → route for approval → schedule payment → archive. Payment terms: Net 30 unless contract specifies otherwise.',
  'text',
  null,
  55,
  '{"source":"seed__ap_workflow.txt","section":"process"}'::jsonb
from ids
where ids.ap_asset_id is not null
;

-- Done.

commit;
