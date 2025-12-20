-- =====================================================
-- Seed data for Company Knowledge Base (demo)
-- Safe to run multiple times (uses fixed UUIDs + ON CONFLICT)
-- =====================================================

-- NOTE: This seed intentionally inserts chunks WITHOUT embeddings.
-- Hybrid retrieval (match_chunks_hybrid) can still find them via full-text search.

-- -----------------------------------------------------
-- Keywords
-- -----------------------------------------------------
insert into keywords (id, parent_id, title, slug, definition, explanation, examples, synonyms, labels_json, rules)
values
  (
    '11111111-1111-1111-1111-111111111111',
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
    '22222222-2222-2222-2222-222222222222',
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
    '33333333-3333-3333-3333-333333333333',
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
on conflict (id) do update set
  parent_id = excluded.parent_id,
  title = excluded.title,
  slug = excluded.slug,
  definition = excluded.definition,
  explanation = excluded.explanation,
  examples = excluded.examples,
  synonyms = excluded.synonyms,
  labels_json = excluded.labels_json,
  rules = excluded.rules;

-- -----------------------------------------------------
-- Relations
-- -----------------------------------------------------
insert into keyword_relations (id, from_keyword_id, relation_type, to_keyword_id, note, strength, bidirectional)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'requires',
    '22222222-2222-2222-2222-222222222222',
    'Invoices require approval before payment.',
    9,
    false
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '33333333-3333-3333-3333-333333333333',
    'depends-on',
    '22222222-2222-2222-2222-222222222222',
    'Payment depends on approval.',
    8,
    false
  )
on conflict (id) do update set
  from_keyword_id = excluded.from_keyword_id,
  relation_type = excluded.relation_type,
  to_keyword_id = excluded.to_keyword_id,
  note = excluded.note,
  strength = excluded.strength,
  bidirectional = excluded.bidirectional;

-- -----------------------------------------------------
-- Assets (fake URLs for demo)
-- -----------------------------------------------------
insert into assets (id, file_name, file_url, file_type, mime_type, file_size, extracted_text, processed)
values
  (
    '44444444-4444-4444-4444-444444444444',
    'invoice_policy.txt',
    'https://example.invalid/assets/invoice_policy.txt',
    'text',
    'text/plain',
    1234,
    'Invoice policy: invoices must be approved before payment. Approval threshold: invoices above $5,000 require Finance approval. All invoices must include supplier name, invoice number, invoice date, line items, VAT/tax, and total.',
    true
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    'ap_workflow.txt',
    'https://example.invalid/assets/ap_workflow.txt',
    'text',
    'text/plain',
    2345,
    'Accounts Payable workflow: 1) Receive invoice 2) Validate supplier & PO/contract 3) Route for approval 4) Schedule payment 5) Archive. Payment terms: Net 30 unless contract specifies otherwise.',
    true
  )
on conflict (id) do update set
  file_name = excluded.file_name,
  file_url = excluded.file_url,
  file_type = excluded.file_type,
  mime_type = excluded.mime_type,
  file_size = excluded.file_size,
  extracted_text = excluded.extracted_text,
  processed = excluded.processed;

-- Link assets to keywords
insert into keyword_assets (id, keyword_id, asset_id, relevance_score, note)
values
  (
    '66666666-6666-6666-6666-666666666666',
    '11111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444444',
    10,
    'Policy text describing invoice requirements.'
  ),
  (
    '77777777-7777-7777-7777-777777777777',
    '22222222-2222-2222-2222-222222222222',
    '55555555-5555-5555-5555-555555555555',
    8,
    'Workflow includes approval and routing.'
  )
on conflict (id) do update set
  keyword_id = excluded.keyword_id,
  asset_id = excluded.asset_id,
  relevance_score = excluded.relevance_score,
  note = excluded.note;

-- -----------------------------------------------------
-- Chunks (text-only; embedding intentionally NULL)
-- -----------------------------------------------------
insert into chunks (id, asset_id, keyword_id, chunk_index, chunk_text, chunk_type, embedding, token_count, meta_json)
values
  (
    '88888888-8888-8888-8888-888888888888',
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    0,
    'Invoices must be approved before payment. Invoices above $5,000 require Finance approval. Required fields: supplier name, invoice number, invoice date, line items, VAT/tax, total.',
    'text',
    null,
    60,
    '{"source":"invoice_policy.txt","section":"requirements"}'::jsonb
  ),
  (
    '99999999-9999-9999-9999-999999999999',
    '55555555-5555-5555-5555-555555555555',
    null,
    0,
    'AP workflow: Receive invoice → validate supplier & PO/contract → route for approval → schedule payment → archive. Payment terms: Net 30 unless contract specifies otherwise.',
    'text',
    null,
    55,
    '{"source":"ap_workflow.txt","section":"process"}'::jsonb
  )
on conflict (id) do update set
  asset_id = excluded.asset_id,
  keyword_id = excluded.keyword_id,
  chunk_index = excluded.chunk_index,
  chunk_text = excluded.chunk_text,
  chunk_type = excluded.chunk_type,
  embedding = excluded.embedding,
  token_count = excluded.token_count,
  meta_json = excluded.meta_json;

-- Done.
