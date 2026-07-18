-- ============================================================================
-- COMPANY BRAIN — COMPLETE RESTAURANT STARTER SEED
-- ============================================================================
-- Run AFTER supabase/setup_complete.sql.
-- Safe to run repeatedly: stable records are upserted and sample rows are
-- replaced by row_index. The first signed-up profile is attached as owner.
--
-- Creates:
--   * Ristorante Bella Vista organization
--   * Restaurant ontology, business rules, and typed relationships
--   * Seven structured datasets with realistic sample data
--   * Computable metric catalog (no LLM arithmetic required)
--   * Operating handbook evidence + searchable chunks
--   * Manager tasks, a daily-closing workflow, and AI skill recipes
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. ORGANIZATION AND OWNER
-- --------------------------------------------------------------------------
insert into organizations (id, name, slug, industry, timezone, default_language, settings)
values (
  '10000000-0000-0000-0000-000000000001',
  'Ristorante Bella Vista',
  'demo-restaurant',
  'gastronomy',
  'Europe/Berlin',
  'en',
  '{
    "currency":"EUR",
    "country":"DE",
    "service_periods":{"lunch":"11:30-15:00","dinner":"17:30-23:00"},
    "targets":{"food_cost_pct":30,"labor_cost_pct":32,"void_rate_pct":1.5,"cash_difference_eur":10},
    "seed":"restaurant-v1"
  }'::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  industry = excluded.industry,
  timezone = excluded.timezone,
  default_language = excluded.default_language,
  settings = excluded.settings,
  updated_at = now();

-- If a user already signed up, make the earliest profile the owner.
insert into organization_members (organization_id, user_id, role)
select o.id, p.id, 'owner'::org_role
from organizations o
cross join lateral (select id from profiles order by created_at asc limit 1) p
where o.slug = 'demo-restaurant'
on conflict (organization_id, user_id) do update set role = 'owner'::org_role;

-- --------------------------------------------------------------------------
-- 2. ONTOLOGY NODES
-- --------------------------------------------------------------------------
with org as (
  select id from organizations where slug = 'demo-restaurant'
), seed(title, slug, parent_slug, keyword_type, access_level, definition, explanation, examples, synonyms, rules, completeness) as (
  values
    ('Restaurant', 'restaurant', null, 'concept', 'worker',
     'The operating system of the restaurant: guests, menu, sales, people, inventory and food safety.',
     'All operational records belong to a location and a business date. Facts come from captured records; calculations come from registered metrics.',
     array['Ristorante Bella Vista'], array['business'],
     array['Never present an estimate as a recorded fact'], 95),

    ('Menu Management', 'menu-management', 'restaurant', 'department', 'worker',
     'The controlled definition, pricing and release of dishes and drinks.',
     'Menu performance combines recipe truth, current purchase costs, selling prices and item-level sales.',
     array['Seasonal menu review'], array['menu'],
     array['No menu item may be released without a recipe, price and allergen review'], 90),
    ('Menu Item', 'menu-item', 'menu-management', 'entity', 'worker',
     'A sellable dish or drink identified by a stable POS item code.',
     'A menu item has a selling price, recipe, category, active period and one or more sales channels.',
     array['Margherita Pizza','Tiramisu'], array['dish','article','POS item'],
     array['POS item code must be unique'], 95),
    ('Recipe', 'recipe', 'menu-item', 'document_type', 'worker',
     'The approved ingredients, quantities, portion yield and preparation instructions for one menu item.',
     'Recipe quantities are the basis for theoretical usage and recipe cost.',
     array['120 g mozzarella per pizza'], array['standard recipe'],
     array['Recipe changes require a new cost and allergen review'], 90),
    ('Ingredient', 'ingredient', 'menu-management', 'entity', 'worker',
     'A purchased food or beverage input used by recipes.',
     'Ingredients use normalized units so invoice prices, inventory and recipe quantities can be compared.',
     array['Mozzarella','Flour','Salmon'], array['raw material'],
     array['Use FIFO for perishable ingredients'], 90),
    ('Allergen', 'allergen', 'menu-item', 'rule', 'worker',
     'A regulated allergen that must be declared for every affected menu item.',
     'Allergen information is derived from the current recipe and verified before publication.',
     array['Gluten','Milk','Egg'], array['allergen declaration'],
     array['Never answer an allergen question from memory; use the approved declaration'], 95),
    ('Selling Price', 'selling-price', 'menu-item', 'metric', 'manager',
     'The current gross guest price recorded in the POS.',
     'Price changes are effective-dated and approved by management.',
     array['EUR 14.90'], array['menu price'], array['Management approves every price change'], 85),
    ('Recipe Cost', 'recipe-cost', 'menu-item', 'metric', 'manager',
     'The sum of normalized ingredient cost multiplied by recipe quantity and configured waste factor.',
     'It is recalculated whenever an ingredient price or recipe changes.',
     array['EUR 4.20 per portion'], array['plate cost'],
     array['Use current approved ingredient prices; do not let the LLM estimate cost'], 90),
    ('Contribution Margin', 'contribution-margin', 'menu-item', 'kpi', 'manager',
     'Net selling price minus variable recipe and channel costs for one sold item.',
     'It identifies popular but unprofitable items and profitable items that need promotion.',
     array['Net sales minus recipe cost'], array['gross profit per item'],
     array['Always state whether VAT and delivery commissions are included'], 90),

    ('Sales Operations', 'sales-operations', 'restaurant', 'department', 'manager',
     'All order, payment, discount, refund and daily-closing activity.',
     'Item-level POS records are the source of truth for sales analysis.',
     array['Lunch POS sales'], array['commercial operations'],
     array['Every sale and adjustment must remain traceable to its source record'], 95),
    ('Order', 'order', 'sales-operations', 'entity', 'manager',
     'A guest transaction containing one or more order lines.',
     'Orders have channel, service period, table or delivery reference, timestamps and payment status.',
     array['Order POS-10452'], array['ticket','check'], array['Order IDs must be unique per source system'], 90),
    ('Payment', 'payment', 'sales-operations', 'process', 'manager',
     'Settlement of an order through cash, card, voucher or delivery platform.',
     'Payments are reconciled against the daily POS close.',
     array['Visa payment'], array['tender'], array['Payment total must reconcile to closed orders'], 85),
    ('Discount', 'discount', 'sales-operations', 'process', 'manager',
     'An approved reduction of the normal selling price.',
     'Discount reason and approving person are required for analysis.',
     array['Staff meal discount'], array['price reduction'], array['Every discount requires a reason code'], 85),
    ('Void', 'void', 'sales-operations', 'process', 'manager',
     'Cancellation of an already-entered order line or check.',
     'Voids are monitored by employee, item, reason and shift; an unusual pattern is a review signal, not proof of misconduct.',
     array['Wrong item entered'], array['storno','cancellation'],
     array['Every void requires a reason','Voids over EUR 30 require manager approval'], 95),
    ('Daily Closing', 'daily-closing', 'sales-operations', 'process', 'manager',
     'The verified daily reconciliation of POS sales, payment totals, cash, card tips, discounts and voids.',
     'This is the basis of the next-morning manager briefing.',
     array['Z report and cash count'], array['day close','Z report'],
     array['Cash difference above EUR 10 must be explained before the shift is closed'], 95),
    ('Sales Channel', 'sales-channel', 'sales-operations', 'concept', 'manager',
     'The route through which an order reaches the restaurant.',
     'Channels include dine-in, takeaway and delivery platforms and may have different fees.',
     array['Dine-in','Takeaway','Delivery'], array['channel'], array['Keep channel fees separate from recipe cost'], 80),

    ('Inventory and Purchasing', 'inventory-purchasing', 'restaurant', 'department', 'manager',
     'Procurement, deliveries, stock, usage, waste and supplier performance.',
     'Actual inventory movement is compared with theoretical recipe consumption.',
     array['Weekly stock count'], array['stock','procurement'],
     array['Every stock adjustment requires a reason'], 90),
    ('Supplier', 'supplier', 'inventory-purchasing', 'entity', 'manager',
     'An approved company that supplies ingredients or operating materials.',
     'Supplier analysis covers price, delivery quality, rejection rate and reliability.',
     array['Frischemarkt GmbH'], array['vendor'], array['New suppliers require approval and a trial delivery'], 85),
    ('Delivery', 'delivery', 'inventory-purchasing', 'process', 'worker',
     'Receipt of ordered goods with quantity, quality, temperature and date checks.',
     'Rejected or partially accepted deliveries retain evidence and corrective action.',
     array['Morning fresh-food delivery'], array['goods receipt'],
     array['Every food delivery requires an acceptance check'], 90),
    ('Supplier Invoice', 'supplier-invoice', 'inventory-purchasing', 'document_type', 'manager',
     'The supplier billing document containing item quantities, unit prices, tax and totals.',
     'Invoice lines update the ingredient price history only after validation.',
     array['Weekly produce invoice'], array['purchase invoice'],
     array['Do not update ingredient price from an unverified extraction'], 90),
    ('Inventory Count', 'inventory-count', 'inventory-purchasing', 'process', 'manager',
     'A timestamped physical count of each ingredient by storage location.',
     'Counts are taken in normalized units and compared with expected inventory.',
     array['Month-end kitchen count'], array['stocktake'],
     array['Month-end inventory is counted by two people'], 85),
    ('Waste Event', 'waste-event', 'inventory-purchasing', 'process', 'worker',
     'A recorded loss of ingredient or prepared food with quantity, cost, reason and responsible area.',
     'Waste must be quick to capture at the time it occurs.',
     array['2 kg expired mozzarella'], array['spoilage','waste'],
     array['Record waste during the same shift, not from memory at month end'], 95),
    ('Food Cost', 'food-cost', 'inventory-purchasing', 'kpi', 'manager',
     'Ingredient consumption cost for a period, normally expressed relative to net food sales.',
     'Theoretical food cost comes from recipes and sales; actual food cost comes from opening stock plus purchases minus closing stock.',
     array['Actual food cost percentage'], array['cost of goods sold','COGS'],
     array['Always label food cost as theoretical or actual'], 95),

    ('Guest Operations', 'guest-operations', 'restaurant', 'department', 'worker',
     'Reservations, seating, service, complaints and guest feedback.',
     'Guest information is minimized; analytics should use anonymous identifiers whenever possible.',
     array['Dinner reservation flow'], array['front of house'],
     array['Do not store unnecessary personal guest data'], 90),
    ('Reservation', 'reservation', 'guest-operations', 'process', 'worker',
     'A table booking for a date, time and party size.',
     'Status distinguishes booked, seated, cancelled and no-show.',
     array['Table for four at 19:30'], array['booking'],
     array['Parties of eight or more require confirmation','Hold a late table for 15 minutes'], 90),
    ('Guest', 'guest', 'guest-operations', 'entity', 'worker',
     'A person served or represented in a reservation, preferably through an anonymous identifier.',
     'Preferences and allergy notifications require a clear operational purpose.',
     array['Anonymous repeat guest ID'], array['customer'], array['Protect guest privacy'], 80),
    ('Table', 'table', 'guest-operations', 'entity', 'worker',
     'A physical seating unit with capacity, area and active status.',
     'Joined tables retain their component table identifiers.',
     array['Terrace table T12'], array['seat location'], array['Do not exceed configured table capacity without approval'], 80),
    ('No-show', 'no-show', 'reservation', 'process', 'manager',
     'A confirmed reservation whose party did not arrive within the configured hold period.',
     'No-show rate is analyzed by party size, time and booking channel.',
     array['Confirmed party absent after 15 minutes'], array['did not arrive'], array['Record status and time consistently'], 85),
    ('Complaint', 'complaint', 'guest-operations', 'process', 'worker',
     'A guest-reported problem about food, service, billing or environment.',
     'The record includes category, affected order/item, action and resolution.',
     array['Dish returned because it was cold'], array['reklamation'],
     array['Resolve immediately when safe','Record the reason and corrective action'], 90),

    ('People and Labor', 'people-labor', 'restaurant', 'department', 'manager',
     'Roles, scheduled shifts, worked hours and labor cost.',
     'Staffing analysis compares demand by service period with worked labor hours.',
     array['Kitchen dinner shift'], array['workforce'], array['Limit personal data in analytical exports'], 90),
    ('Employee', 'employee', 'people-labor', 'entity', 'manager',
     'A worker represented by a stable internal identifier and operational role.',
     'Analytical views should use internal IDs rather than unnecessary personal fields.',
     array['EMP-014'], array['staff member'], array['Access to employee-level performance is manager-only'], 80),
    ('Role', 'role', 'people-labor', 'role', 'worker',
     'An operational responsibility such as cook, server, host or shift manager.',
     'Roles determine expected tasks and permissions.',
     array['Server','Cook'], array['job role'], array['A shift must have a responsible manager'], 85),
    ('Shift', 'shift', 'people-labor', 'process', 'manager',
     'A scheduled and actually worked time interval for one employee and department.',
     'Scheduled and actual times are stored separately.',
     array['Dinner service 17:00–23:30'], array['work period'],
     array['Shift changes require manager approval'], 90),
    ('Labor Cost', 'labor-cost', 'people-labor', 'kpi', 'manager',
     'Employer labor cost assigned to a business date and department.',
     'Labor cost percentage is labor cost divided by net revenue for the same scope.',
     array['EUR 1,240 dinner labor cost'], array['personnel cost'],
     array['Always compare the same date, location and service-period scope'], 90),

    ('Food Safety', 'food-safety', 'restaurant', 'department', 'worker',
     'HACCP controls, temperature checks, cleaning and corrective actions.',
     'Compliance answers must cite the measurement or checklist record.',
     array['Refrigerator temperature control'], array['HACCP'],
     array['Compliance exceptions require documented corrective action'], 95),
    ('Temperature Check', 'temperature-check', 'food-safety', 'process', 'worker',
     'A timestamped measurement for a named refrigerator, freezer, delivery or prepared-food control point.',
     'The result is compared with the equipment-specific lower and upper limit.',
     array['Cold room 3.4 °C at 09:00'], array['temperature measurement'],
     array['Measure refrigerators at least twice daily','Do not silently replace an out-of-range result'], 95),
    ('Cleaning Check', 'cleaning-check', 'food-safety', 'process', 'worker',
     'Confirmation that a defined area or equipment was cleaned using the approved method.',
     'The record contains task, responsible role, time and exception.',
     array['Kitchen closing clean'], array['cleaning log'], array['Every completed task requires initials or user identity'], 85),
    ('Corrective Action', 'corrective-action', 'food-safety', 'process', 'worker',
     'A documented response that contains an exception, protects guests and prevents recurrence.',
     'It links the exception, immediate containment, owner and verification.',
     array['Move food to another refrigerator and inform chef'], array['remediation'],
     array['Critical violations remain open until verification'], 90),

    ('Daily Manager Briefing', 'daily-manager-briefing', 'restaurant', 'report_type', 'manager',
     'A next-morning report of verified results, exceptions, missing data and recommended actions.',
     'It separates recorded facts, deterministic calculations and hypotheses.',
     array['Yesterday at a glance'], array['morning report'],
     array['Every number cites a computation','Every hypothesis is labeled as a hypothesis'], 95)
)
insert into keywords (
  organization_id, parent_id, title, slug, keyword_type, access_level,
  definition, explanation, examples, synonyms, labels_json, rules,
  completeness_score, status
)
select org.id, null, s.title, s.slug, s.keyword_type::keyword_type,
       s.access_level::keyword_access_level, s.definition, s.explanation,
       s.examples, s.synonyms, '{}'::jsonb, s.rules, s.completeness, 'active'::keyword_status
from seed s cross join org
on conflict (organization_id, slug) do update set
  title = excluded.title,
  keyword_type = excluded.keyword_type,
  access_level = excluded.access_level,
  definition = excluded.definition,
  explanation = excluded.explanation,
  examples = excluded.examples,
  synonyms = excluded.synonyms,
  rules = excluded.rules,
  completeness_score = excluded.completeness_score,
  status = excluded.status;

-- Apply hierarchy after all nodes exist.
with org as (select id from organizations where slug = 'demo-restaurant'),
parents(child_slug, parent_slug) as (
  values
    ('menu-management','restaurant'),('menu-item','menu-management'),('recipe','menu-item'),
    ('ingredient','menu-management'),('allergen','menu-item'),('selling-price','menu-item'),
    ('recipe-cost','menu-item'),('contribution-margin','menu-item'),
    ('sales-operations','restaurant'),('order','sales-operations'),('payment','sales-operations'),
    ('discount','sales-operations'),('void','sales-operations'),('daily-closing','sales-operations'),
    ('sales-channel','sales-operations'),('inventory-purchasing','restaurant'),
    ('supplier','inventory-purchasing'),('delivery','inventory-purchasing'),
    ('supplier-invoice','inventory-purchasing'),('inventory-count','inventory-purchasing'),
    ('waste-event','inventory-purchasing'),('food-cost','inventory-purchasing'),
    ('guest-operations','restaurant'),('reservation','guest-operations'),('guest','guest-operations'),
    ('table','guest-operations'),('no-show','reservation'),('complaint','guest-operations'),
    ('people-labor','restaurant'),('employee','people-labor'),('role','people-labor'),
    ('shift','people-labor'),('labor-cost','people-labor'),('food-safety','restaurant'),
    ('temperature-check','food-safety'),('cleaning-check','food-safety'),
    ('corrective-action','food-safety'),('daily-manager-briefing','restaurant')
)
update keywords child
set parent_id = parent.id
from parents p, org
join keywords parent on parent.organization_id = org.id
where child.organization_id = org.id
  and child.slug = p.child_slug
  and parent.slug = p.parent_slug;

-- --------------------------------------------------------------------------
-- 3. TYPED RELATIONSHIPS
-- --------------------------------------------------------------------------
with org as (select id from organizations where slug = 'demo-restaurant'),
rels(from_slug, relation_name, to_slug, note, strength) as (
  values
    ('menu-item','derived-from','recipe','The approved recipe defines the item.',10),
    ('recipe','uses','ingredient','Recipes consume normalized ingredient quantities.',10),
    ('menu-item','requires','allergen','Every item needs an approved allergen declaration.',10),
    ('menu-item','measured-by','selling-price','POS selling price.',8),
    ('menu-item','calculated-from','recipe-cost','Recipe ingredients and current prices determine cost.',10),
    ('contribution-margin','calculated-from','selling-price','Selling price is an input.',9),
    ('contribution-margin','calculated-from','recipe-cost','Recipe cost is an input.',9),
    ('order','contains','menu-item','Order lines reference menu items.',10),
    ('order','depends-on','sales-channel','Channel affects fees and operational context.',7),
    ('payment','belongs-to','order','Payments settle orders.',10),
    ('discount','affects','order','Discounts reduce order revenue.',9),
    ('void','affects','order','Voids reverse entered order value.',10),
    ('void','reported-in','daily-closing','Daily close includes void review.',10),
    ('daily-closing','calculated-from','order','Closed orders produce sales totals.',10),
    ('supplier','produces','delivery','Suppliers deliver ingredients.',7),
    ('delivery','contains','ingredient','Deliveries contain ingredient lines.',9),
    ('supplier-invoice','reported-in','delivery','Invoice documents delivered goods and price.',8),
    ('inventory-count','measured-by','ingredient','Counts measure physical ingredient stock.',9),
    ('waste-event','affects','ingredient','Waste reduces usable stock.',9),
    ('food-cost','calculated-from','supplier-invoice','Purchases contribute to actual food cost.',8),
    ('food-cost','calculated-from','inventory-count','Opening and closing stock are required.',9),
    ('food-cost','calculated-from','recipe','Recipes produce theoretical food cost.',9),
    ('reservation','belongs-to','guest','A reservation represents a guest party.',7),
    ('reservation','requires','table','Seating capacity must be available.',7),
    ('no-show','affects','reservation','No-show is a reservation outcome.',10),
    ('complaint','affects','menu-item','Food complaints may concern a menu item.',7),
    ('complaint','triggers','corrective-action','Serious complaints require action.',8),
    ('shift','owned-by','employee','A worked shift belongs to an employee.',9),
    ('employee','belongs-to','role','Employees perform operational roles.',9),
    ('labor-cost','calculated-from','shift','Worked hours and rates determine labor cost.',10),
    ('temperature-check','part-of','food-safety','Temperature monitoring is a HACCP control.',10),
    ('temperature-check','triggers','corrective-action','Out-of-range measurements require action.',10),
    ('cleaning-check','part-of','food-safety','Cleaning verification is a food-safety control.',9),
    ('daily-manager-briefing','calculated-from','daily-closing','Sales close is a briefing source.',10),
    ('daily-manager-briefing','calculated-from','waste-event','Waste exceptions are briefing inputs.',8),
    ('daily-manager-briefing','calculated-from','shift','Labor inputs are included.',8),
    ('daily-manager-briefing','calculated-from','temperature-check','Compliance exceptions are included.',9),
    ('daily-manager-briefing','calculated-from','reservation','Reservations and no-shows are included.',7)
)
insert into keyword_relations (
  organization_id, from_keyword_id, relation_type, to_keyword_id, note, strength, bidirectional
)
select org.id, kf.id, r.relation_name::relation_type, kt.id, r.note, r.strength, false
from rels r cross join org
join keywords kf on kf.organization_id = org.id and kf.slug = r.from_slug
join keywords kt on kt.organization_id = org.id and kt.slug = r.to_slug
on conflict (from_keyword_id, relation_type, to_keyword_id) do update set
  note = excluded.note, strength = excluded.strength;

-- --------------------------------------------------------------------------
-- 4. OPERATING HANDBOOK EVIDENCE AND SEARCHABLE CHUNKS
-- --------------------------------------------------------------------------
with org as (select id from organizations where slug = 'demo-restaurant')
insert into assets (
  id, organization_id, file_name, file_url, file_type, mime_type, file_size,
  title, description, source, extracted_text, processed, processing_status, meta_json
)
select
  '11000000-0000-0000-0000-000000000001', org.id,
  'seed__restaurant_operating_handbook.txt',
  'https://example.invalid/seed/restaurant_operating_handbook.txt',
  'text'::asset_type, 'text/plain', 3200,
  'Restaurant Operating Handbook',
  'Seeded operating rules for daily close, food safety, voids, waste and reporting.',
  'restaurant-seed',
  'Daily closing: reconcile POS sales, cash, card and delivery-platform totals. Cash differences over EUR 10 require an explanation before closing. Every void requires a reason; voids over EUR 30 require manager approval. Food safety: refrigerators are measured at least twice daily. Out-of-range measurements require an immediate corrective action and verification. Waste is recorded in the same shift with item, quantity, reason and estimated cost. The daily manager briefing separates verified facts, calculations and hypotheses.',
  true, 'processed'::processing_status,
  jsonb_build_object('org_id', org.id::text, 'source', 'restaurant-seed')
from org
on conflict (id) do update set
  organization_id = excluded.organization_id,
  extracted_text = excluded.extracted_text,
  processed = true,
  processing_status = 'processed'::processing_status,
  meta_json = excluded.meta_json;

with org as (select id from organizations where slug = 'demo-restaurant'),
chunks_seed(chunk_index, keyword_slug, chunk_text, token_count, section) as (
  values
    (0,'daily-closing','Daily closing requires reconciliation of POS sales, cash, card and delivery-platform totals. A cash difference over EUR 10 must be explained before the shift is closed.',35,'daily closing'),
    (1,'void','Every void needs a reason code. Voids above EUR 30 require manager approval. Patterns are review signals and must not be presented as proof of misconduct.',34,'void control'),
    (2,'temperature-check','Refrigerators must be measured at least twice daily. An out-of-range result requires immediate containment, a documented corrective action and later verification.',31,'food safety'),
    (3,'waste-event','Waste is captured during the same shift with ingredient or menu item, normalized quantity, reason, estimated cost and responsible operating area.',29,'waste'),
    (4,'daily-manager-briefing','The daily manager briefing separates recorded facts, deterministic calculations and hypotheses. Every numeric claim must cite its calculation source.',27,'reporting')
)
insert into chunks (
  organization_id, asset_id, keyword_id, chunk_index, chunk_text, chunk_type,
  embedding, token_count, meta_json
)
select org.id, '11000000-0000-0000-0000-000000000001', k.id,
       c.chunk_index, c.chunk_text, 'text', null, c.token_count,
       jsonb_build_object('source','restaurant-seed','section',c.section)
from chunks_seed c cross join org
join keywords k on k.organization_id = org.id and k.slug = c.keyword_slug
on conflict (asset_id, chunk_index) do update set
  keyword_id = excluded.keyword_id,
  chunk_text = excluded.chunk_text,
  token_count = excluded.token_count,
  meta_json = excluded.meta_json;

with org as (select id from organizations where slug = 'demo-restaurant'),
links(keyword_slug, note) as (
  values
    ('daily-closing','Daily closing policy and reconciliation thresholds.'),
    ('void','Void reason and approval policy.'),
    ('temperature-check','Temperature monitoring and corrective-action policy.'),
    ('waste-event','Same-shift waste-capture policy.'),
    ('daily-manager-briefing','Evidence requirements for the manager briefing.')
)
insert into keyword_assets (keyword_id, asset_id, relevance_score, note)
select k.id, '11000000-0000-0000-0000-000000000001', 10, l.note
from links l cross join org
join keywords k on k.organization_id = org.id and k.slug = l.keyword_slug
on conflict (keyword_id, asset_id) do update set
  relevance_score = excluded.relevance_score, note = excluded.note;

-- --------------------------------------------------------------------------
-- 5. STRUCTURED DATASETS AND SCHEMAS
-- --------------------------------------------------------------------------
-- Stable IDs make every section independently rerunnable.

with org as (select id from organizations where slug = 'demo-restaurant'),
defs(id, title, description, keyword_slug) as (
  values
    ('12000000-0000-0000-0000-000000000001'::uuid,'[Restaurant Seed] Daily Operations','One verified record per business date from the daily close.','daily-closing'),
    ('12000000-0000-0000-0000-000000000002'::uuid,'[Restaurant Seed] Item Sales','Aggregated POS item sales by date, menu item and channel.','order'),
    ('12000000-0000-0000-0000-000000000003'::uuid,'[Restaurant Seed] Labor Shifts','Worked hours and employer cost by date and department.','shift'),
    ('12000000-0000-0000-0000-000000000004'::uuid,'[Restaurant Seed] Waste Events','Same-shift waste and spoilage records.','waste-event'),
    ('12000000-0000-0000-0000-000000000005'::uuid,'[Restaurant Seed] Temperature Checks','Food-safety measurements and corrective actions.','temperature-check'),
    ('12000000-0000-0000-0000-000000000006'::uuid,'[Restaurant Seed] Reservations','Reservation outcomes by service date.','reservation'),
    ('12000000-0000-0000-0000-000000000007'::uuid,'[Restaurant Seed] Menu Economics','Current price, recipe cost and contribution margin per menu item.','menu-item')
)
insert into datasets (id, organization_id, keyword_id, title, description, status)
select d.id, org.id, k.id, d.title, d.description, 'active'
from defs d cross join org
join keywords k on k.organization_id = org.id and k.slug = d.keyword_slug
on conflict (id) do update set
  organization_id = excluded.organization_id,
  keyword_id = excluded.keyword_id,
  title = excluded.title,
  description = excluded.description,
  status = excluded.status;

insert into dataset_tables (id, dataset_id, name, row_count, column_count, meta_json)
values
  ('13000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','daily_operations',14,11,'{"source":"POS daily close","grain":"business_date"}'),
  ('13000000-0000-0000-0000-000000000002','12000000-0000-0000-0000-000000000002','item_sales',20,8,'{"source":"POS order lines","grain":"date_item_channel"}'),
  ('13000000-0000-0000-0000-000000000003','12000000-0000-0000-0000-000000000003','labor_shifts',28,7,'{"source":"time clock","grain":"date_department"}'),
  ('13000000-0000-0000-0000-000000000004','12000000-0000-0000-0000-000000000004','waste_events',8,8,'{"source":"mobile form or voice","grain":"event"}'),
  ('13000000-0000-0000-0000-000000000005','12000000-0000-0000-0000-000000000005','temperature_checks',16,9,'{"source":"mobile HACCP form","grain":"measurement"}'),
  ('13000000-0000-0000-0000-000000000006','12000000-0000-0000-0000-000000000006','reservations',14,8,'{"source":"reservation system","grain":"service_date"}'),
  ('13000000-0000-0000-0000-000000000007','12000000-0000-0000-0000-000000000007','menu_economics',8,9,'{"source":"recipe and POS master data","grain":"menu_item"}')
on conflict (id) do update set
  name = excluded.name,
  row_count = excluded.row_count,
  column_count = excluded.column_count,
  meta_json = excluded.meta_json;

-- Column definitions. semantic_name gives the LLM stable business meaning.
with cols(table_id, name, normalized_name, data_type, semantic_name, description, required, validation) as (
  values
    ('13000000-0000-0000-0000-000000000001'::uuid,'Business Date','business_date','date','business_date','Restaurant operating date.',true,'{"not_null":true}'),
    ('13000000-0000-0000-0000-000000000001','Weekday','weekday','text','weekday','Local weekday.',true,'{}'),
    ('13000000-0000-0000-0000-000000000001','Gross Revenue EUR','gross_revenue_eur','number','gross_revenue','Sales including VAT before discounts.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000001','Net Revenue EUR','net_revenue_eur','number','net_revenue','Revenue excluding VAT after discounts.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000001','Guests','guests','number','guest_count','Verified covers served.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000001','Orders','orders','number','order_count','Closed orders.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000001','Discount EUR','discount_eur','number','discount_amount','Approved discounts.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000001','Void EUR','void_eur','number','void_amount','Voided value.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000001','Refund EUR','refund_eur','number','refund_amount','Refunded value.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000001','Cash Difference EUR','cash_difference_eur','number','cash_difference','Counted cash minus expected cash.',true,'{}'),
    ('13000000-0000-0000-0000-000000000001','Card Tips EUR','card_tips_eur','number','card_tips','Tips recorded on card payments.',true,'{"min":0}'),

    ('13000000-0000-0000-0000-000000000002','Business Date','business_date','date','business_date','Operating date.',true,'{"not_null":true}'),
    ('13000000-0000-0000-0000-000000000002','POS Item Code','item_code','text','menu_item_id','Stable POS item identifier.',true,'{"unique_scope":["business_date","channel"]}'),
    ('13000000-0000-0000-0000-000000000002','Menu Item','item_name','text','menu_item_name','Display name at time of sale.',true,'{}'),
    ('13000000-0000-0000-0000-000000000002','Category','category','text','menu_category','Food or beverage category.',true,'{}'),
    ('13000000-0000-0000-0000-000000000002','Channel','channel','text','sales_channel','Dine-in, takeaway or delivery.',true,'{}'),
    ('13000000-0000-0000-0000-000000000002','Quantity','quantity','number','quantity_sold','Items sold.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000002','Net Revenue EUR','net_revenue_eur','number','net_revenue','Item net sales after discounts.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000002','Discount EUR','discount_eur','number','discount_amount','Item-level discount.',true,'{"min":0}'),

    ('13000000-0000-0000-0000-000000000003','Business Date','business_date','date','business_date','Operating date.',true,'{}'),
    ('13000000-0000-0000-0000-000000000003','Department','department','text','department','Kitchen or service.',true,'{}'),
    ('13000000-0000-0000-0000-000000000003','Service Period','service_period','text','service_period','Lunch or dinner.',true,'{}'),
    ('13000000-0000-0000-0000-000000000003','Scheduled Hours','scheduled_hours','number','scheduled_hours','Planned labor hours.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000003','Worked Hours','worked_hours','number','worked_hours','Clocked labor hours.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000003','Labor Cost EUR','labor_cost_eur','number','labor_cost','Employer labor cost.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000003','Headcount','headcount','number','headcount','Employees working in scope.',true,'{"min":0}'),

    ('13000000-0000-0000-0000-000000000004','Timestamp','occurred_at','date','event_timestamp','Time waste occurred.',true,'{}'),
    ('13000000-0000-0000-0000-000000000004','Item','item_name','text','waste_item','Ingredient or prepared item.',true,'{}'),
    ('13000000-0000-0000-0000-000000000004','Quantity','quantity','number','waste_quantity','Normalized waste quantity.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000004','Unit','unit','text','unit','kg, l or portions.',true,'{}'),
    ('13000000-0000-0000-0000-000000000004','Estimated Cost EUR','estimated_cost_eur','number','waste_cost','Approved estimated waste cost.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000004','Reason','reason','text','waste_reason','Expiry, preparation, spoilage or return.',true,'{}'),
    ('13000000-0000-0000-0000-000000000004','Department','department','text','department','Responsible operating area.',true,'{}'),
    ('13000000-0000-0000-0000-000000000004','Evidence','evidence','text','evidence_reference','Photo, voice or note reference.',false,'{}'),

    ('13000000-0000-0000-0000-000000000005','Measured At','measured_at','date','measurement_timestamp','Measurement time.',true,'{}'),
    ('13000000-0000-0000-0000-000000000005','Equipment','equipment','text','equipment_id','Named control point.',true,'{}'),
    ('13000000-0000-0000-0000-000000000005','Temperature C','temperature_c','number','temperature_c','Measured Celsius value.',true,'{}'),
    ('13000000-0000-0000-0000-000000000005','Minimum C','min_c','number','temperature_min_c','Allowed minimum.',false,'{}'),
    ('13000000-0000-0000-0000-000000000005','Maximum C','max_c','number','temperature_max_c','Allowed maximum.',false,'{}'),
    ('13000000-0000-0000-0000-000000000005','Status','status','text','control_status','ok or violation.',true,'{}'),
    ('13000000-0000-0000-0000-000000000005','Recorded By','recorded_by','text','employee_id','Internal staff identifier.',true,'{}'),
    ('13000000-0000-0000-0000-000000000005','Corrective Action','corrective_action','text','corrective_action','Containment and remediation.',false,'{}'),
    ('13000000-0000-0000-0000-000000000005','Verified At','verified_at','date','verification_timestamp','Follow-up verification time.',false,'{}'),

    ('13000000-0000-0000-0000-000000000006','Service Date','service_date','date','business_date','Reservation service date.',true,'{}'),
    ('13000000-0000-0000-0000-000000000006','Booked Parties','booked_parties','number','booked_parties','Confirmed parties.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000006','Booked Guests','booked_guests','number','booked_guests','Expected covers.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000006','Seated Parties','seated_parties','number','seated_parties','Parties that were seated.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000006','Seated Guests','seated_guests','number','seated_guests','Reservation covers served.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000006','Cancellations','cancellations','number','reservation_cancellations','Cancelled reservations.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000006','No Shows','no_shows','number','reservation_no_shows','Confirmed parties that did not arrive.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000006','Average Party Size','avg_party_size','number','average_party_size','Booked guests divided by parties.',true,'{"min":0}'),

    ('13000000-0000-0000-0000-000000000007','POS Item Code','item_code','text','menu_item_id','Stable item code.',true,'{}'),
    ('13000000-0000-0000-0000-000000000007','Menu Item','item_name','text','menu_item_name','Current display name.',true,'{}'),
    ('13000000-0000-0000-0000-000000000007','Category','category','text','menu_category','Menu category.',true,'{}'),
    ('13000000-0000-0000-0000-000000000007','Gross Price EUR','gross_price_eur','number','selling_price_gross','Current guest price including VAT.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000007','Net Price EUR','net_price_eur','number','selling_price_net','Selling price excluding VAT.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000007','Recipe Cost EUR','recipe_cost_eur','number','recipe_cost','Current approved portion cost.',true,'{"min":0}'),
    ('13000000-0000-0000-0000-000000000007','Contribution Margin EUR','contribution_margin_eur','number','contribution_margin','Net price minus recipe cost.',true,'{}'),
    ('13000000-0000-0000-0000-000000000007','Food Cost Pct','food_cost_pct','number','food_cost_percentage','Recipe cost divided by net price.',true,'{"min":0,"max":100}'),
    ('13000000-0000-0000-0000-000000000007','Allergens','allergens','text','allergen_codes','Approved allergen codes.',true,'{}')
)
insert into dataset_columns (
  dataset_table_id, name, normalized_name, data_type, semantic_name,
  description, is_required, validation_rules, sample_values
)
select table_id, name, normalized_name, data_type::dataset_column_type,
       semantic_name, description, required, validation::jsonb, '{}'
from cols
on conflict (dataset_table_id, normalized_name) do update set
  name = excluded.name,
  data_type = excluded.data_type,
  semantic_name = excluded.semantic_name,
  description = excluded.description,
  is_required = excluded.is_required,
  validation_rules = excluded.validation_rules;

-- --------------------------------------------------------------------------
-- 6. SAMPLE RECORDS
-- --------------------------------------------------------------------------
-- Daily close: two comparable weeks, including a Saturday void spike and one
-- cash discrepancy. source_json makes provenance explicit.
with rows(row_index, data) as (
  values
    (1,'{"business_date":"2026-07-01","weekday":"Wed","gross_revenue_eur":3210,"net_revenue_eur":2990,"guests":87,"orders":63,"discount_eur":46,"void_eur":18,"refund_eur":0,"cash_difference_eur":1.5,"card_tips_eur":184}'::jsonb),
    (2,'{"business_date":"2026-07-02","weekday":"Thu","gross_revenue_eur":3480,"net_revenue_eur":3240,"guests":93,"orders":68,"discount_eur":54,"void_eur":21,"refund_eur":0,"cash_difference_eur":-2,"card_tips_eur":201}'::jsonb),
    (3,'{"business_date":"2026-07-03","weekday":"Fri","gross_revenue_eur":4860,"net_revenue_eur":4520,"guests":126,"orders":91,"discount_eur":82,"void_eur":43,"refund_eur":18,"cash_difference_eur":3,"card_tips_eur":286}'::jsonb),
    (4,'{"business_date":"2026-07-04","weekday":"Sat","gross_revenue_eur":5580,"net_revenue_eur":5190,"guests":142,"orders":102,"discount_eur":96,"void_eur":151,"refund_eur":0,"cash_difference_eur":14.5,"card_tips_eur":324}'::jsonb),
    (5,'{"business_date":"2026-07-05","weekday":"Sun","gross_revenue_eur":4210,"net_revenue_eur":3910,"guests":113,"orders":82,"discount_eur":61,"void_eur":29,"refund_eur":0,"cash_difference_eur":-1,"card_tips_eur":249}'::jsonb),
    (6,'{"business_date":"2026-07-06","weekday":"Mon","gross_revenue_eur":2260,"net_revenue_eur":2100,"guests":62,"orders":46,"discount_eur":31,"void_eur":15,"refund_eur":0,"cash_difference_eur":0,"card_tips_eur":126}'::jsonb),
    (7,'{"business_date":"2026-07-07","weekday":"Tue","gross_revenue_eur":2590,"net_revenue_eur":2410,"guests":71,"orders":52,"discount_eur":39,"void_eur":22,"refund_eur":0,"cash_difference_eur":2,"card_tips_eur":145}'::jsonb),
    (8,'{"business_date":"2026-07-08","weekday":"Wed","gross_revenue_eur":3370,"net_revenue_eur":3135,"guests":90,"orders":65,"discount_eur":49,"void_eur":20,"refund_eur":0,"cash_difference_eur":1,"card_tips_eur":191}'::jsonb),
    (9,'{"business_date":"2026-07-09","weekday":"Thu","gross_revenue_eur":3620,"net_revenue_eur":3365,"guests":96,"orders":70,"discount_eur":58,"void_eur":24,"refund_eur":0,"cash_difference_eur":-3.5,"card_tips_eur":208}'::jsonb),
    (10,'{"business_date":"2026-07-10","weekday":"Fri","gross_revenue_eur":5010,"net_revenue_eur":4660,"guests":130,"orders":94,"discount_eur":87,"void_eur":48,"refund_eur":0,"cash_difference_eur":2,"card_tips_eur":298}'::jsonb),
    (11,'{"business_date":"2026-07-11","weekday":"Sat","gross_revenue_eur":5790,"net_revenue_eur":5380,"guests":148,"orders":107,"discount_eur":104,"void_eur":163,"refund_eur":22,"cash_difference_eur":8,"card_tips_eur":341}'::jsonb),
    (12,'{"business_date":"2026-07-12","weekday":"Sun","gross_revenue_eur":4350,"net_revenue_eur":4045,"guests":116,"orders":84,"discount_eur":65,"void_eur":31,"refund_eur":0,"cash_difference_eur":-1.5,"card_tips_eur":257}'::jsonb),
    (13,'{"business_date":"2026-07-13","weekday":"Mon","gross_revenue_eur":2140,"net_revenue_eur":1990,"guests":59,"orders":43,"discount_eur":29,"void_eur":13,"refund_eur":0,"cash_difference_eur":0.5,"card_tips_eur":119}'::jsonb),
    (14,'{"business_date":"2026-07-14","weekday":"Tue","gross_revenue_eur":2730,"net_revenue_eur":2540,"guests":74,"orders":55,"discount_eur":42,"void_eur":19,"refund_eur":0,"cash_difference_eur":1,"card_tips_eur":153}'::jsonb)
)
insert into dataset_rows (dataset_table_id, row_index, data, source_json)
select '13000000-0000-0000-0000-000000000001', row_index, data,
       jsonb_build_object('source','seed-pos-close','record',row_index)
from rows
on conflict (dataset_table_id, row_index) do update set data=excluded.data, source_json=excluded.source_json;

with rows(row_index, data) as (
  values
    (1,'{"business_date":"2026-07-04","item_code":"PIZ-MARG","item_name":"Pizza Margherita","category":"Pizza","channel":"dine_in","quantity":38,"net_revenue_eur":484.5,"discount_eur":8}'::jsonb),
    (2,'{"business_date":"2026-07-04","item_code":"PIZ-DIAV","item_name":"Pizza Diavola","category":"Pizza","channel":"dine_in","quantity":31,"net_revenue_eur":445.2,"discount_eur":12}'::jsonb),
    (3,'{"business_date":"2026-07-04","item_code":"RIS-FUNG","item_name":"Risotto ai Funghi","category":"Main","channel":"dine_in","quantity":22,"net_revenue_eur":347.6,"discount_eur":0}'::jsonb),
    (4,'{"business_date":"2026-07-04","item_code":"SAL-SALM","item_name":"Salmone Grigliato","category":"Main","channel":"dine_in","quantity":19,"net_revenue_eur":390.5,"discount_eur":15}'::jsonb),
    (5,'{"business_date":"2026-07-04","item_code":"DES-TIRA","item_name":"Tiramisu","category":"Dessert","channel":"dine_in","quantity":35,"net_revenue_eur":207.4,"discount_eur":0}'::jsonb),
    (6,'{"business_date":"2026-07-04","item_code":"PIZ-MARG","item_name":"Pizza Margherita","category":"Pizza","channel":"delivery","quantity":17,"net_revenue_eur":216.8,"discount_eur":18}'::jsonb),
    (7,'{"business_date":"2026-07-10","item_code":"PIZ-MARG","item_name":"Pizza Margherita","category":"Pizza","channel":"dine_in","quantity":34,"net_revenue_eur":433.5,"discount_eur":7}'::jsonb),
    (8,'{"business_date":"2026-07-10","item_code":"PIZ-DIAV","item_name":"Pizza Diavola","category":"Pizza","channel":"dine_in","quantity":29,"net_revenue_eur":416.4,"discount_eur":9}'::jsonb),
    (9,'{"business_date":"2026-07-10","item_code":"RIS-FUNG","item_name":"Risotto ai Funghi","category":"Main","channel":"dine_in","quantity":24,"net_revenue_eur":379.2,"discount_eur":0}'::jsonb),
    (10,'{"business_date":"2026-07-10","item_code":"SAL-SALM","item_name":"Salmone Grigliato","category":"Main","channel":"dine_in","quantity":21,"net_revenue_eur":431.6,"discount_eur":12}'::jsonb),
    (11,'{"business_date":"2026-07-10","item_code":"DES-TIRA","item_name":"Tiramisu","category":"Dessert","channel":"dine_in","quantity":38,"net_revenue_eur":225.2,"discount_eur":0}'::jsonb),
    (12,'{"business_date":"2026-07-11","item_code":"PIZ-MARG","item_name":"Pizza Margherita","category":"Pizza","channel":"dine_in","quantity":42,"net_revenue_eur":535.5,"discount_eur":11}'::jsonb),
    (13,'{"business_date":"2026-07-11","item_code":"PIZ-DIAV","item_name":"Pizza Diavola","category":"Pizza","channel":"dine_in","quantity":36,"net_revenue_eur":517.1,"discount_eur":14}'::jsonb),
    (14,'{"business_date":"2026-07-11","item_code":"RIS-FUNG","item_name":"Risotto ai Funghi","category":"Main","channel":"dine_in","quantity":25,"net_revenue_eur":395,"discount_eur":0}'::jsonb),
    (15,'{"business_date":"2026-07-11","item_code":"SAL-SALM","item_name":"Salmone Grigliato","category":"Main","channel":"dine_in","quantity":23,"net_revenue_eur":472.7,"discount_eur":19}'::jsonb),
    (16,'{"business_date":"2026-07-11","item_code":"DES-TIRA","item_name":"Tiramisu","category":"Dessert","channel":"dine_in","quantity":41,"net_revenue_eur":243,"discount_eur":0}'::jsonb),
    (17,'{"business_date":"2026-07-11","item_code":"PIZ-MARG","item_name":"Pizza Margherita","category":"Pizza","channel":"delivery","quantity":21,"net_revenue_eur":267.8,"discount_eur":24}'::jsonb),
    (18,'{"business_date":"2026-07-11","item_code":"PIZ-DIAV","item_name":"Pizza Diavola","category":"Pizza","channel":"delivery","quantity":18,"net_revenue_eur":258.5,"discount_eur":22}'::jsonb),
    (19,'{"business_date":"2026-07-12","item_code":"PIZ-MARG","item_name":"Pizza Margherita","category":"Pizza","channel":"dine_in","quantity":31,"net_revenue_eur":395.3,"discount_eur":5}'::jsonb),
    (20,'{"business_date":"2026-07-12","item_code":"DES-TIRA","item_name":"Tiramisu","category":"Dessert","channel":"dine_in","quantity":29,"net_revenue_eur":171.9,"discount_eur":0}'::jsonb)
)
insert into dataset_rows (dataset_table_id,row_index,data,source_json)
select '13000000-0000-0000-0000-000000000002',row_index,data,jsonb_build_object('source','seed-pos-items','record',row_index)
from rows on conflict (dataset_table_id,row_index) do update set data=excluded.data,source_json=excluded.source_json;

-- Labor records generated for both departments across the 14 operating dates.
with days as (
  select * from (values
    (1,'2026-07-01',44.0,890.0),(2,'2026-07-02',46.0,925.0),(3,'2026-07-03',58.0,1180.0),
    (4,'2026-07-04',66.0,1345.0),(5,'2026-07-05',52.0,1050.0),(6,'2026-07-06',39.0,790.0),
    (7,'2026-07-07',40.0,810.0),(8,'2026-07-08',45.0,910.0),(9,'2026-07-09',47.0,950.0),
    (10,'2026-07-10',59.0,1200.0),(11,'2026-07-11',68.0,1395.0),(12,'2026-07-12',53.0,1070.0),
    (13,'2026-07-13',38.0,770.0),(14,'2026-07-14',41.0,830.0)
  ) d(day_no,business_date,total_hours,total_cost)
), rows as (
  select (day_no*2-1) row_index,
    jsonb_build_object('business_date',business_date,'department','kitchen','service_period','full_day',
      'scheduled_hours',round((total_hours*0.46)::numeric,1),'worked_hours',round((total_hours*0.47)::numeric,1),
      'labor_cost_eur',round((total_cost*0.49)::numeric,2),'headcount',case when total_hours>55 then 6 else 4 end) data
  from days
  union all
  select (day_no*2) row_index,
    jsonb_build_object('business_date',business_date,'department','service','service_period','full_day',
      'scheduled_hours',round((total_hours*0.54)::numeric,1),'worked_hours',round((total_hours*0.53)::numeric,1),
      'labor_cost_eur',round((total_cost*0.51)::numeric,2),'headcount',case when total_hours>55 then 8 else 5 end) data
  from days
)
insert into dataset_rows (dataset_table_id,row_index,data,source_json)
select '13000000-0000-0000-0000-000000000003',row_index,data,jsonb_build_object('source','seed-time-clock','record',row_index)
from rows on conflict (dataset_table_id,row_index) do update set data=excluded.data,source_json=excluded.source_json;

with rows(row_index,data) as (
  values
    (1,'{"occurred_at":"2026-07-03T22:15:00+02:00","item_name":"Tiramisu portions","quantity":3,"unit":"portion","estimated_cost_eur":7.8,"reason":"preparation_surplus","department":"kitchen","evidence":"voice-note-001"}'::jsonb),
    (2,'{"occurred_at":"2026-07-04T23:05:00+02:00","item_name":"Pizza dough","quantity":2.4,"unit":"kg","estimated_cost_eur":8.4,"reason":"preparation_surplus","department":"kitchen","evidence":"form-002"}'::jsonb),
    (3,'{"occurred_at":"2026-07-05T10:10:00+02:00","item_name":"Mozzarella","quantity":1.8,"unit":"kg","estimated_cost_eur":18.9,"reason":"expired","department":"kitchen","evidence":"photo-003"}'::jsonb),
    (4,'{"occurred_at":"2026-07-06T14:20:00+02:00","item_name":"Mixed salad","quantity":5,"unit":"portion","estimated_cost_eur":9.5,"reason":"guest_return","department":"kitchen","evidence":"POS complaint 771"}'::jsonb),
    (5,'{"occurred_at":"2026-07-10T22:40:00+02:00","item_name":"Open house wine","quantity":1.5,"unit":"l","estimated_cost_eur":10.2,"reason":"spillage","department":"service","evidence":"form-005"}'::jsonb),
    (6,'{"occurred_at":"2026-07-11T23:15:00+02:00","item_name":"Pizza dough","quantity":3.1,"unit":"kg","estimated_cost_eur":10.85,"reason":"preparation_surplus","department":"kitchen","evidence":"form-006"}'::jsonb),
    (7,'{"occurred_at":"2026-07-12T10:05:00+02:00","item_name":"Mozzarella","quantity":2.2,"unit":"kg","estimated_cost_eur":23.1,"reason":"expired","department":"kitchen","evidence":"photo-007"}'::jsonb),
    (8,'{"occurred_at":"2026-07-13T21:55:00+02:00","item_name":"Salmone Grigliato","quantity":2,"unit":"portion","estimated_cost_eur":17.2,"reason":"guest_return","department":"kitchen","evidence":"complaint-184"}'::jsonb)
)
insert into dataset_rows (dataset_table_id,row_index,data,source_json)
select '13000000-0000-0000-0000-000000000004',row_index,data,jsonb_build_object('source','seed-waste-form','record',row_index)
from rows on conflict (dataset_table_id,row_index) do update set data=excluded.data,source_json=excluded.source_json;

with rows(row_index,data) as (
  values
    (1,'{"measured_at":"2026-07-08T09:00:00+02:00","equipment":"cold_room","temperature_c":3.6,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-004","corrective_action":null,"verified_at":null}'::jsonb),
    (2,'{"measured_at":"2026-07-08T17:00:00+02:00","equipment":"cold_room","temperature_c":4.1,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-011","corrective_action":null,"verified_at":null}'::jsonb),
    (3,'{"measured_at":"2026-07-09T09:00:00+02:00","equipment":"freezer_2","temperature_c":-17.8,"min_c":-30,"max_c":-18,"status":"violation","recorded_by":"EMP-004","corrective_action":"Door seal checked; products transferred to freezer 1.","verified_at":"2026-07-09T10:00:00+02:00"}'::jsonb),
    (4,'{"measured_at":"2026-07-09T10:00:00+02:00","equipment":"freezer_2","temperature_c":-19.4,"min_c":-30,"max_c":-18,"status":"ok","recorded_by":"EMP-004","corrective_action":"Follow-up verification.","verified_at":"2026-07-09T10:00:00+02:00"}'::jsonb),
    (5,'{"measured_at":"2026-07-10T09:00:00+02:00","equipment":"cold_room","temperature_c":3.9,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-007","corrective_action":null,"verified_at":null}'::jsonb),
    (6,'{"measured_at":"2026-07-10T17:00:00+02:00","equipment":"cold_room","temperature_c":4.4,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-010","corrective_action":null,"verified_at":null}'::jsonb),
    (7,'{"measured_at":"2026-07-11T09:00:00+02:00","equipment":"meat_fridge","temperature_c":4.8,"min_c":0,"max_c":4,"status":"violation","recorded_by":"EMP-004","corrective_action":"Thermostat lowered; raw meat moved to cold room.","verified_at":"2026-07-11T10:30:00+02:00"}'::jsonb),
    (8,'{"measured_at":"2026-07-11T10:30:00+02:00","equipment":"meat_fridge","temperature_c":3.7,"min_c":0,"max_c":4,"status":"ok","recorded_by":"EMP-004","corrective_action":"Follow-up verification.","verified_at":"2026-07-11T10:30:00+02:00"}'::jsonb),
    (9,'{"measured_at":"2026-07-11T17:00:00+02:00","equipment":"cold_room","temperature_c":4.5,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-009","corrective_action":null,"verified_at":null}'::jsonb),
    (10,'{"measured_at":"2026-07-12T09:00:00+02:00","equipment":"cold_room","temperature_c":3.8,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-006","corrective_action":null,"verified_at":null}'::jsonb),
    (11,'{"measured_at":"2026-07-12T17:00:00+02:00","equipment":"cold_room","temperature_c":4.0,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-012","corrective_action":null,"verified_at":null}'::jsonb),
    (12,'{"measured_at":"2026-07-13T09:00:00+02:00","equipment":"freezer_1","temperature_c":-20.1,"min_c":-30,"max_c":-18,"status":"ok","recorded_by":"EMP-004","corrective_action":null,"verified_at":null}'::jsonb),
    (13,'{"measured_at":"2026-07-13T17:00:00+02:00","equipment":"freezer_1","temperature_c":-19.7,"min_c":-30,"max_c":-18,"status":"ok","recorded_by":"EMP-008","corrective_action":null,"verified_at":null}'::jsonb),
    (14,'{"measured_at":"2026-07-14T09:00:00+02:00","equipment":"cold_room","temperature_c":3.5,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-005","corrective_action":null,"verified_at":null}'::jsonb),
    (15,'{"measured_at":"2026-07-14T17:00:00+02:00","equipment":"cold_room","temperature_c":4.2,"min_c":0,"max_c":7,"status":"ok","recorded_by":"EMP-010","corrective_action":null,"verified_at":null}'::jsonb),
    (16,'{"measured_at":"2026-07-15T09:00:00+02:00","equipment":"meat_fridge","temperature_c":4.6,"min_c":0,"max_c":4,"status":"violation","recorded_by":"EMP-004","corrective_action":null,"verified_at":null}'::jsonb)
)
insert into dataset_rows (dataset_table_id,row_index,data,source_json)
select '13000000-0000-0000-0000-000000000005',row_index,data,jsonb_build_object('source','seed-haccp-form','record',row_index)
from rows on conflict (dataset_table_id,row_index) do update set data=excluded.data,source_json=excluded.source_json;

with rows(row_index,data) as (
  values
    (1,'{"service_date":"2026-07-01","booked_parties":19,"booked_guests":53,"seated_parties":18,"seated_guests":50,"cancellations":1,"no_shows":0,"avg_party_size":2.79}'::jsonb),
    (2,'{"service_date":"2026-07-02","booked_parties":21,"booked_guests":60,"seated_parties":20,"seated_guests":57,"cancellations":1,"no_shows":0,"avg_party_size":2.86}'::jsonb),
    (3,'{"service_date":"2026-07-03","booked_parties":30,"booked_guests":88,"seated_parties":28,"seated_guests":82,"cancellations":1,"no_shows":1,"avg_party_size":2.93}'::jsonb),
    (4,'{"service_date":"2026-07-04","booked_parties":35,"booked_guests":106,"seated_parties":32,"seated_guests":96,"cancellations":1,"no_shows":2,"avg_party_size":3.03}'::jsonb),
    (5,'{"service_date":"2026-07-05","booked_parties":26,"booked_guests":77,"seated_parties":25,"seated_guests":74,"cancellations":1,"no_shows":0,"avg_party_size":2.96}'::jsonb),
    (6,'{"service_date":"2026-07-06","booked_parties":13,"booked_guests":35,"seated_parties":12,"seated_guests":32,"cancellations":1,"no_shows":0,"avg_party_size":2.69}'::jsonb),
    (7,'{"service_date":"2026-07-07","booked_parties":15,"booked_guests":42,"seated_parties":14,"seated_guests":39,"cancellations":1,"no_shows":0,"avg_party_size":2.8}'::jsonb),
    (8,'{"service_date":"2026-07-08","booked_parties":20,"booked_guests":57,"seated_parties":19,"seated_guests":54,"cancellations":1,"no_shows":0,"avg_party_size":2.85}'::jsonb),
    (9,'{"service_date":"2026-07-09","booked_parties":22,"booked_guests":64,"seated_parties":21,"seated_guests":61,"cancellations":1,"no_shows":0,"avg_party_size":2.91}'::jsonb),
    (10,'{"service_date":"2026-07-10","booked_parties":31,"booked_guests":91,"seated_parties":29,"seated_guests":85,"cancellations":1,"no_shows":1,"avg_party_size":2.94}'::jsonb),
    (11,'{"service_date":"2026-07-11","booked_parties":37,"booked_guests":113,"seated_parties":33,"seated_guests":101,"cancellations":1,"no_shows":3,"avg_party_size":3.05}'::jsonb),
    (12,'{"service_date":"2026-07-12","booked_parties":27,"booked_guests":80,"seated_parties":26,"seated_guests":77,"cancellations":1,"no_shows":0,"avg_party_size":2.96}'::jsonb),
    (13,'{"service_date":"2026-07-13","booked_parties":12,"booked_guests":33,"seated_parties":11,"seated_guests":30,"cancellations":1,"no_shows":0,"avg_party_size":2.75}'::jsonb),
    (14,'{"service_date":"2026-07-14","booked_parties":16,"booked_guests":45,"seated_parties":15,"seated_guests":42,"cancellations":1,"no_shows":0,"avg_party_size":2.81}'::jsonb)
)
insert into dataset_rows (dataset_table_id,row_index,data,source_json)
select '13000000-0000-0000-0000-000000000006',row_index,data,jsonb_build_object('source','seed-reservations','record',row_index)
from rows on conflict (dataset_table_id,row_index) do update set data=excluded.data,source_json=excluded.source_json;

with rows(row_index,data) as (
  values
    (1,'{"item_code":"PIZ-MARG","item_name":"Pizza Margherita","category":"Pizza","gross_price_eur":14.9,"net_price_eur":13.93,"recipe_cost_eur":3.42,"contribution_margin_eur":10.51,"food_cost_pct":24.55,"allergens":"A,G"}'::jsonb),
    (2,'{"item_code":"PIZ-DIAV","item_name":"Pizza Diavola","category":"Pizza","gross_price_eur":16.9,"net_price_eur":15.79,"recipe_cost_eur":4.88,"contribution_margin_eur":10.91,"food_cost_pct":30.91,"allergens":"A,G"}'::jsonb),
    (3,'{"item_code":"RIS-FUNG","item_name":"Risotto ai Funghi","category":"Main","gross_price_eur":18.5,"net_price_eur":17.29,"recipe_cost_eur":5.1,"contribution_margin_eur":12.19,"food_cost_pct":29.5,"allergens":"G,L"}'::jsonb),
    (4,'{"item_code":"SAL-SALM","item_name":"Salmone Grigliato","category":"Main","gross_price_eur":24.9,"net_price_eur":23.27,"recipe_cost_eur":8.6,"contribution_margin_eur":14.67,"food_cost_pct":36.96,"allergens":"D"}'::jsonb),
    (5,'{"item_code":"PAS-CARB","item_name":"Spaghetti Carbonara","category":"Pasta","gross_price_eur":17.9,"net_price_eur":16.73,"recipe_cost_eur":4.95,"contribution_margin_eur":11.78,"food_cost_pct":29.59,"allergens":"A,C,G"}'::jsonb),
    (6,'{"item_code":"DES-TIRA","item_name":"Tiramisu","category":"Dessert","gross_price_eur":7.9,"net_price_eur":7.38,"recipe_cost_eur":2.6,"contribution_margin_eur":4.78,"food_cost_pct":35.23,"allergens":"A,C,G"}'::jsonb),
    (7,'{"item_code":"SAL-MIST","item_name":"Insalata Mista","category":"Starter","gross_price_eur":9.9,"net_price_eur":9.25,"recipe_cost_eur":2.05,"contribution_margin_eur":7.2,"food_cost_pct":22.16,"allergens":"M"}'::jsonb),
    (8,'{"item_code":"BEV-WINE","item_name":"House Wine 0.2l","category":"Beverage","gross_price_eur":7.5,"net_price_eur":6.3,"recipe_cost_eur":1.38,"contribution_margin_eur":4.92,"food_cost_pct":21.9,"allergens":"O"}'::jsonb)
)
insert into dataset_rows (dataset_table_id,row_index,data,source_json)
select '13000000-0000-0000-0000-000000000007',row_index,data,jsonb_build_object('source','seed-menu-master','record',row_index)
from rows on conflict (dataset_table_id,row_index) do update set data=excluded.data,source_json=excluded.source_json;

-- --------------------------------------------------------------------------
-- 7. COMPUTABLE METRIC CATALOG
-- --------------------------------------------------------------------------
-- These metrics deliberately match the current engine: one aggregation over
-- one source column, with optional filters. Compound ratios remain documented
-- in ontology definitions until the formula engine supports them safely.
with org as (select id from organizations where slug='demo-restaurant'),
defs(name, description, formula, aggregation, table_id, value_column, date_column, dimensions, filters, time_grain, caveats, keyword_slug) as (
  values
    ('Net Revenue','Verified net revenue after discounts.','sum(net_revenue_eur)','sum','13000000-0000-0000-0000-000000000001'::uuid,'net_revenue_eur','business_date',array['weekday'],'[]'::jsonb,'day','Excludes VAT; confirm source close is final.','daily-closing'),
    ('Guests Served','Verified restaurant covers.','sum(guests)','sum','13000000-0000-0000-0000-000000000001'::uuid,'guests','business_date',array['weekday'],'[]'::jsonb,'day','Uses the restaurant definition of a guest/cover.','guest'),
    ('Void Value','Total voided value.','sum(void_eur)','sum','13000000-0000-0000-0000-000000000001'::uuid,'void_eur','business_date',array['weekday'],'[]'::jsonb,'day','A high value is a review signal, not proof of wrongdoing.','void'),
    ('Discount Value','Total approved discounts.','sum(discount_eur)','sum','13000000-0000-0000-0000-000000000001'::uuid,'discount_eur','business_date',array['weekday'],'[]'::jsonb,'day',null,'discount'),
    ('Cash Difference','Net daily cash differences.','sum(cash_difference_eur)','sum','13000000-0000-0000-0000-000000000001'::uuid,'cash_difference_eur','business_date',array['weekday'],'[]'::jsonb,'day','Positive and negative differences can offset; inspect daily series.','daily-closing'),
    ('Worked Labor Hours','Clocked labor hours.','sum(worked_hours)','sum','13000000-0000-0000-0000-000000000003'::uuid,'worked_hours','business_date',array['department'],'[]'::jsonb,'day',null,'shift'),
    ('Labor Cost','Employer labor cost.','sum(labor_cost_eur)','sum','13000000-0000-0000-0000-000000000003'::uuid,'labor_cost_eur','business_date',array['department'],'[]'::jsonb,'day','Compare with net revenue over the identical scope.','labor-cost'),
    ('Waste Cost','Approved estimated cost of recorded waste.','sum(estimated_cost_eur)','sum','13000000-0000-0000-0000-000000000004'::uuid,'estimated_cost_eur','occurred_at',array['department','reason'],'[]'::jsonb,'day','Only recorded waste; missing capture understates the result.','waste-event'),
    ('Temperature Violations','Count of out-of-range temperature records.','count(*) where status = violation','count','13000000-0000-0000-0000-000000000005'::uuid,null,'measured_at',array['equipment'],'[{"field":"status","op":"eq","value":"violation"}]'::jsonb,'day','A follow-up OK record does not erase the original violation.','temperature-check'),
    ('Reservation No-shows','Count of no-show parties.','sum(no_shows)','sum','13000000-0000-0000-0000-000000000006'::uuid,'no_shows','service_date',array[]::text[],'[]'::jsonb,'day','Party count, not guest count.','no-show'),
    ('Average Menu Recipe Cost','Average current recipe cost across active seeded items.','avg(recipe_cost_eur)','avg','13000000-0000-0000-0000-000000000007'::uuid,'recipe_cost_eur',null,array['category'],'[]'::jsonb,'month','Not sales-weighted.','recipe-cost'),
    ('Average Menu Contribution Margin','Average current contribution margin per listed item.','avg(contribution_margin_eur)','avg','13000000-0000-0000-0000-000000000007'::uuid,'contribution_margin_eur',null,array['category'],'[]'::jsonb,'month','Not sales-weighted.','contribution-margin')
)
insert into metrics (
  organization_id, keyword_id, name, description, formula, aggregation,
  source_table_id, value_column, date_column, dimensions, filters, time_grain, caveats
)
select org.id,k.id,d.name,d.description,d.formula,d.aggregation,d.table_id,d.value_column,
       d.date_column,d.dimensions,d.filters,d.time_grain,d.caveats
from defs d cross join org
join keywords k on k.organization_id=org.id and k.slug=d.keyword_slug
on conflict (organization_id,name) do update set
  keyword_id=excluded.keyword_id,description=excluded.description,formula=excluded.formula,
  aggregation=excluded.aggregation,source_table_id=excluded.source_table_id,
  value_column=excluded.value_column,date_column=excluded.date_column,
  dimensions=excluded.dimensions,filters=excluded.filters,time_grain=excluded.time_grain,
  caveats=excluded.caveats,updated_at=now();

-- --------------------------------------------------------------------------
-- 8. TASKS, WORKFLOW, AND AI SKILLS
-- --------------------------------------------------------------------------
with org as (select id from organizations where slug='demo-restaurant'),
defs(id,title,description,status,priority,due_date,keyword_slug) as (
  values
    ('14000000-0000-0000-0000-000000000001'::uuid,'Investigate Saturday void pattern','Review Saturday voids by employee, item and reason. Treat the pattern as a control review, not an accusation. [restaurant-seed]','todo','high','2026-07-20'::date,'void'),
    ('14000000-0000-0000-0000-000000000002'::uuid,'Verify meat-fridge corrective action','The latest meat-fridge violation has no corrective action or verification. [restaurant-seed]','blocked','urgent','2026-07-16'::date,'temperature-check'),
    ('14000000-0000-0000-0000-000000000003'::uuid,'Review salmon recipe and price','Salmon food-cost percentage exceeds the 30% target. Confirm supplier cost, portion and selling price. [restaurant-seed]','todo','high','2026-07-22'::date,'recipe-cost'),
    ('14000000-0000-0000-0000-000000000004'::uuid,'Reduce mozzarella expiry waste','Check Monday ordering and weekend closing stock. [restaurant-seed]','in_progress','medium','2026-07-24'::date,'waste-event')
)
insert into tasks (id,organization_id,keyword_id,title,description,status,priority,due_date)
select d.id,org.id,k.id,d.title,d.description,d.status::task_status,d.priority::task_priority,d.due_date
from defs d cross join org
join keywords k on k.organization_id=org.id and k.slug=d.keyword_slug
on conflict (id) do update set
  keyword_id=excluded.keyword_id,title=excluded.title,description=excluded.description,
  status=excluded.status,priority=excluded.priority,due_date=excluded.due_date,updated_at=now();

with org as (select id from organizations where slug='demo-restaurant'),
k as (select id from keywords where organization_id=(select id from org) and slug='daily-closing')
insert into workflows (id,organization_id,keyword_id,name,description,is_template)
select '15000000-0000-0000-0000-000000000001',org.id,k.id,
       'Daily Restaurant Closing','Verify POS, payments, cash, voids, tips and manager exceptions.',true
from org,k
on conflict (id) do update set
  keyword_id=excluded.keyword_id,name=excluded.name,description=excluded.description,is_template=true,updated_at=now();

with org as (select id from organizations where slug='demo-restaurant'),
defs(step_order,name,description,keyword_slug) as (
  values
    (1,'Close POS','Generate and archive the final POS close.','daily-closing'),
    (2,'Reconcile payments','Compare cash, card and delivery-platform totals.','payment'),
    (3,'Review discounts and voids','Verify reason and approval for every exception.','void'),
    (4,'Record waste and incidents','Complete same-shift capture before staff leave.','waste-event'),
    (5,'Complete food-safety checks','Confirm required measurements and corrective actions.','temperature-check'),
    (6,'Publish manager handoff','Record unresolved exceptions and responsible owner.','daily-manager-briefing')
)
insert into workflow_steps (workflow_id,organization_id,keyword_id,step_order,name,description)
select '15000000-0000-0000-0000-000000000001',org.id,k.id,d.step_order,d.name,d.description
from defs d cross join org
join keywords k on k.organization_id=org.id and k.slug=d.keyword_slug
on conflict (workflow_id,step_order) do update set
  keyword_id=excluded.keyword_id,name=excluded.name,description=excluded.description;

-- Replace only the explicitly seeded skills.
delete from ai_skills
where organization_id=(select id from organizations where slug='demo-restaurant')
  and name in ('__world_model__','Daily manager briefing','Menu margin review','Food-safety exception review');

with org as (select id from organizations where slug='demo-restaurant')
insert into ai_skills (
  organization_id,keyword_id,name,description,skill_type,required_data,tools_used,
  prompt_template,output_schema,min_role
)
values
  ((select id from org),null,'__world_model__','Seeded restaurant world model','summary',
   '{"hash":"restaurant-seed-v1","generated_at":"2026-07-15T00:00:00Z","stats":{"keywords":39,"relations":38,"defined":39}}',array[]::text[],
   'Ristorante Bella Vista is a restaurant whose operating model connects menu and recipe truth, item-level POS sales, daily closing, labor, inventory and waste, reservations, and HACCP controls. Recorded facts must come from source rows. Numeric results must come from computation tools. The restaurant target is food cost at or below 30%, labor cost at or below 32%, void rate below 1.5%, and explained cash differences above EUR 10. Compliance exceptions require corrective action. Manager reporting separates facts, calculations and hypotheses.',null,'viewer'::org_role),
  ((select id from org),(select id from keywords where organization_id=(select id from org) and slug='daily-manager-briefing'),
   'Daily manager briefing','Create an evidence-grounded morning briefing.','report',
   '{"tables":["daily_operations","labor_shifts","waste_events","temperature_checks","reservations"]}',
   array['compute_metric','query_table','compare_periods'],
   'Summarize the latest completed day. Compare with the previous comparable weekday. Report verified sales, guests, labor, waste, voids, cash and compliance exceptions. Label hypotheses and list missing data. End with no more than three concrete actions.',
   '{"type":"object","required":["facts","exceptions","hypotheses","actions"]}', 'manager'::org_role),
  ((select id from org),(select id from keywords where organization_id=(select id from org) and slug='contribution-margin'),
   'Menu margin review','Find popular low-margin and high-margin underperforming items.','analysis',
   '{"tables":["item_sales","menu_economics"]}',array['query_table'],
   'Join menu economics conceptually by item_code with item sales. Never estimate missing costs. Distinguish popularity from profitability and show the period and channel used.',
   '{"type":"object","required":["items","evidence","actions"]}', 'manager'::org_role),
  ((select id from org),(select id from keywords where organization_id=(select id from org) and slug='temperature-check'),
   'Food-safety exception review','Identify unresolved food-safety exceptions.','analysis',
   '{"tables":["temperature_checks"]}',array['query_table'],
   'List every violation in scope with equipment, measurement, limit, corrective action and verification. A later OK reading does not erase the violation. Escalate records without corrective action or verification.',
   '{"type":"object","required":["violations","unresolved","actions"]}', 'viewer'::org_role);

-- Audit marker for operational visibility.
insert into audit_logs (organization_id,action,entity_type,details)
select id,'seed.restaurant_complete','organization',
       '{"seed":"restaurant-v1","datasets":7,"purpose":"complete restaurant starter"}'::jsonb
from organizations where slug='demo-restaurant';

commit;

-- Expected result summary (the SQL editor will show these rows):
select
  o.name,
  (select count(*) from keywords k where k.organization_id=o.id) as keywords,
  (select count(*) from keyword_relations r where r.organization_id=o.id) as relations,
  (select count(*) from datasets d where d.organization_id=o.id and d.title like '[Restaurant Seed]%') as datasets,
  (select count(*) from metrics m where m.organization_id=o.id) as metrics,
  (select count(*) from tasks t where t.organization_id=o.id and t.description like '%[restaurant-seed]%') as tasks
from organizations o
where o.slug='demo-restaurant';
