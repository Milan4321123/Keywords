/**
 * Additive, idempotent project-management scenario for Company Brain.
 *
 *   npm run seed:project -- --org milan
 *
 * Creates one connected project ontology plus editable control, risk,
 * decision, and stakeholder tables; exact metrics; evidence text; tasks; and
 * dependencies. It never deletes or resets existing organization data.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { computeCompleteness } from '../src/lib/ontology/completeness';
import { computeMetric, MetricDefinition } from '../src/lib/metrics/compute';

function loadEnv() {
  const path = resolve(__dirname, '../.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : null;
}

interface KeywordSeed {
  slug: string;
  title: string;
  parent?: string;
  type: string;
  definition: string;
  explanation: string;
  examples: string[];
  synonyms: string[];
  rules: string[];
}

const keywordSeeds: KeywordSeed[] = [
  {
    slug: 'project-atlas', title: 'Project Atlas', type: 'concept',
    definition: 'A cross-functional customer-portal relaunch with a controlled scope, budget, delivery plan, risk register, and September 2026 go-live target.',
    explanation: 'Project Atlas replaces the legacy customer portal with self-service ordering, invoice access, support requests, and operational reporting. The steering group reviews delivery progress, forecast cost, open risks, unresolved decisions, and stakeholder commitments every Tuesday. Project status is green only when the critical-path work packages are on plan, no high exposure risk lacks mitigation, and every blocked task has a named owner and next action.',
    examples: ['Customer portal relaunch', 'Target go-live: 21 September 2026', 'Steering review every Tuesday'],
    synonyms: ['Atlas', 'Customer Portal Relaunch', 'Kundenportal Projekt'],
    rules: ['Scope changes require an approved decision-log entry.', 'Forecast cost must be reviewed weekly.', 'A blocked critical-path task must be escalated within one business day.'],
  },
  {
    slug: 'atlas-scope', title: 'Atlas Scope', parent: 'project-atlas', type: 'rule',
    definition: 'The approved boundary of capabilities and deliverables included in Project Atlas.',
    explanation: 'In scope are account login, order history, invoice downloads, support tickets, product catalogue search, and manager reporting. Payment processing and native mobile apps are explicitly outside the first release. The scope baseline is the reference for planning, acceptance, and change control.',
    examples: ['Invoice download is in scope', 'Native iOS app is out of scope'],
    synonyms: ['Project scope', 'Scope baseline'],
    rules: ['Every work package must map to an approved deliverable.', 'New scope requires budget and schedule impact before approval.'],
  },
  {
    slug: 'atlas-milestone', title: 'Atlas Milestone', parent: 'project-atlas', type: 'workflow_step',
    definition: 'A dated control point used to confirm that a defined group of Project Atlas deliverables is complete.',
    explanation: 'Milestones are evidence-based gates rather than approximate progress statements. A milestone is complete only after its acceptance evidence is linked and all required predecessor tasks are done.',
    examples: ['API contract approved', 'UAT exit approved', 'Production go-live'],
    synonyms: ['Gate', 'Project checkpoint'],
    rules: ['No milestone is marked done without acceptance evidence.', 'A slipped milestone requires a forecast update.'],
  },
  {
    slug: 'atlas-risk', title: 'Atlas Risk', parent: 'project-atlas', type: 'risk',
    definition: 'An uncertain event that may affect Project Atlas cost, schedule, quality, security, or adoption.',
    explanation: 'Risks are quantified using probability, financial impact, and exposure. Each open risk has one accountable owner, a mitigation, a due date, and recent evidence. Issues that have already occurred are managed as blocked tasks rather than hidden in the risk register.',
    examples: ['Legacy data quality may delay migration', 'Security review capacity may delay go-live'],
    synonyms: ['Project risk', 'Risk register entry'],
    rules: ['High exposure risks are reviewed weekly.', 'Risks without mitigation are escalated to the steering group.'],
  },
  {
    slug: 'atlas-decision', title: 'Atlas Decision', parent: 'project-atlas', type: 'document_type',
    definition: 'A recorded project choice with context, owner, consequences, status, and review date.',
    explanation: 'The decision log prevents important trade-offs from disappearing into meetings or chat. Approved decisions become binding project context for later planning and AI answers.',
    examples: ['Use phased migration rather than big-bang migration', 'Defer native mobile app to phase two'],
    synonyms: ['Decision log', 'Project decision'],
    rules: ['Material decisions must record context and impact.', 'Open decisions need an owner and review date.'],
  },
  {
    slug: 'atlas-stakeholder', title: 'Atlas Stakeholder', parent: 'project-atlas', type: 'role',
    definition: 'A person or group affected by Project Atlas or responsible for a project outcome.',
    explanation: 'Stakeholder records capture the latest position, concerns, commitments, responsible contact, and next communication date. This gives the AI project manager current human context instead of only technical status.',
    examples: ['Customer service lead', 'Finance sponsor', 'Pilot customer group'],
    synonyms: ['Stakeholder', 'Project participant'],
    rules: ['Every steering commitment needs an owner and date.', 'Negative sentiment requires a follow-up action.'],
  },
  {
    slug: 'atlas-budget', title: 'Atlas Budget', parent: 'project-atlas', type: 'kpi',
    definition: 'The approved, actual, and forecast cost position for Project Atlas.',
    explanation: 'Budget is controlled at work-package level. Actual cost reports what has already been consumed; forecast cost estimates the final outcome based on current delivery knowledge. The AI must never confuse actual and forecast values.',
    examples: ['Approved budget EUR 765,000', 'Forecast cost updated weekly'],
    synonyms: ['Project cost', 'Budget forecast'],
    rules: ['Forecast and actual cost must remain separate.', 'Forecast overrun above 5% requires steering approval.'],
  },
];

const projectRows = [
  { work_package_id: 'WP-01', workstream: 'Discovery', deliverable: 'Approved scope and success measures', owner: 'Anna Keller', planned_start: '2026-06-08', planned_end: '2026-06-19', progress_pct: 100, status: 'done', budget_eur: 40000, actual_cost_eur: 38200, forecast_cost_eur: 38200, risk_level: 'low', dependency: null, next_action: 'Archive signed scope baseline', evidence_reference: 'atlas-scope-v1.2' },
  { work_package_id: 'WP-02', workstream: 'Experience', deliverable: 'Validated portal UX and design system', owner: 'Mia Schneider', planned_start: '2026-06-15', planned_end: '2026-07-24', progress_pct: 78, status: 'in_progress', budget_eur: 65000, actual_cost_eur: 54100, forecast_cost_eur: 68000, risk_level: 'medium', dependency: 'WP-01', next_action: 'Close invoice-download usability findings', evidence_reference: 'ux-test-report-07-17' },
  { work_package_id: 'WP-03', workstream: 'Platform', deliverable: 'Approved target data model', owner: 'Luca Moretti', planned_start: '2026-06-22', planned_end: '2026-07-10', progress_pct: 100, status: 'done', budget_eur: 45000, actual_cost_eur: 44100, forecast_cost_eur: 44100, risk_level: 'low', dependency: 'WP-01', next_action: 'Maintain schema decision record', evidence_reference: 'adr-014-data-model' },
  { work_package_id: 'WP-04', workstream: 'Platform', deliverable: 'Customer and invoice APIs', owner: 'Jonas Weber', planned_start: '2026-07-06', planned_end: '2026-08-07', progress_pct: 62, status: 'in_progress', budget_eur: 120000, actual_cost_eur: 79800, forecast_cost_eur: 132000, risk_level: 'high', dependency: 'WP-03', next_action: 'Approve invoice API error contract', evidence_reference: 'api-contract-review-07-20' },
  { work_package_id: 'WP-05', workstream: 'Migration', deliverable: 'Repeatable legacy-data migration', owner: 'David Fischer', planned_start: '2026-07-06', planned_end: '2026-08-21', progress_pct: 55, status: 'in_progress', budget_eur: 95000, actual_cost_eur: 58200, forecast_cost_eur: 110000, risk_level: 'high', dependency: 'WP-03', next_action: 'Resolve duplicate customer identifiers', evidence_reference: 'migration-rehearsal-02' },
  { work_package_id: 'WP-06', workstream: 'Reporting', deliverable: 'Operational manager dashboard', owner: 'Sofia Romano', planned_start: '2026-07-20', planned_end: '2026-08-21', progress_pct: 25, status: 'in_progress', budget_eur: 70000, actual_cost_eur: 14900, forecast_cost_eur: 78000, risk_level: 'medium', dependency: 'WP-04', next_action: 'Confirm KPI acceptance definitions', evidence_reference: 'reporting-workshop-07-20' },
  { work_package_id: 'WP-07', workstream: 'Quality', deliverable: 'UAT completed with exit approval', owner: 'Elena Rossi', planned_start: '2026-08-10', planned_end: '2026-09-04', progress_pct: 15, status: 'blocked', budget_eur: 55000, actual_cost_eur: 11800, forecast_cost_eur: 60000, risk_level: 'high', dependency: 'WP-04, WP-05', next_action: 'Unblock stable test environment and migration dataset', evidence_reference: 'uat-readiness-check-07-21' },
  { work_package_id: 'WP-08', workstream: 'Security', deliverable: 'Security and privacy release approval', owner: 'Tobias Hartmann', planned_start: '2026-07-13', planned_end: '2026-08-28', progress_pct: 45, status: 'in_progress', budget_eur: 45000, actual_cost_eur: 20100, forecast_cost_eur: 48000, risk_level: 'high', dependency: 'WP-04', next_action: 'Complete penetration-test remediation plan', evidence_reference: 'security-review-07-18' },
  { work_package_id: 'WP-09', workstream: 'Change', deliverable: 'Support-team training and runbook', owner: 'Anna Keller', planned_start: '2026-08-17', planned_end: '2026-09-11', progress_pct: 5, status: 'todo', budget_eur: 30000, actual_cost_eur: 1500, forecast_cost_eur: 32000, risk_level: 'medium', dependency: 'WP-06', next_action: 'Confirm training audience and dates', evidence_reference: 'training-outline-v0.1' },
  { work_package_id: 'WP-10', workstream: 'Release', deliverable: 'Pilot customer rollout', owner: 'Mia Schneider', planned_start: '2026-09-07', planned_end: '2026-09-11', progress_pct: 0, status: 'todo', budget_eur: 60000, actual_cost_eur: 0, forecast_cost_eur: 62000, risk_level: 'medium', dependency: 'WP-07, WP-08', next_action: 'Nominate ten pilot customers', evidence_reference: 'pilot-plan-draft' },
  { work_package_id: 'WP-11', workstream: 'Release', deliverable: 'Production go-live', owner: 'Luca Moretti', planned_start: '2026-09-14', planned_end: '2026-09-21', progress_pct: 0, status: 'todo', budget_eur: 85000, actual_cost_eur: 0, forecast_cost_eur: 90000, risk_level: 'high', dependency: 'WP-10', next_action: 'Prepare go/no-go evidence checklist', evidence_reference: 'release-checklist-v0.3' },
  { work_package_id: 'WP-12', workstream: 'Operations', deliverable: 'Four-week hypercare completed', owner: 'Sofia Romano', planned_start: '2026-09-21', planned_end: '2026-10-16', progress_pct: 0, status: 'todo', budget_eur: 60000, actual_cost_eur: 0, forecast_cost_eur: 65000, risk_level: 'medium', dependency: 'WP-11', next_action: 'Define incident triage rota', evidence_reference: 'hypercare-plan-v0.1' },
];

const riskRows = [
  { risk_id: 'R-01', title: 'Duplicate legacy customer identifiers', category: 'data', probability_pct: 70, impact_eur: 80000, exposure_eur: 56000, owner: 'David Fischer', mitigation: 'Run deterministic matching and business-owner exception review.', due_date: '2026-07-29', status: 'mitigating', last_update: '2026-07-21', evidence_reference: 'migration-rehearsal-02' },
  { risk_id: 'R-02', title: 'Invoice API contract remains unresolved', category: 'dependency', probability_pct: 60, impact_eur: 65000, exposure_eur: 39000, owner: 'Jonas Weber', mitigation: 'Decision workshop with Finance and Platform; approve error semantics.', due_date: '2026-07-24', status: 'open', last_update: '2026-07-20', evidence_reference: 'api-contract-review-07-20' },
  { risk_id: 'R-03', title: 'Security review capacity bottleneck', category: 'security', probability_pct: 45, impact_eur: 90000, exposure_eur: 40500, owner: 'Tobias Hartmann', mitigation: 'Reserve external penetration-test capacity and prioritize critical paths.', due_date: '2026-07-31', status: 'mitigating', last_update: '2026-07-18', evidence_reference: 'security-review-07-18' },
  { risk_id: 'R-04', title: 'UAT environment not stable', category: 'quality', probability_pct: 65, impact_eur: 70000, exposure_eur: 45500, owner: 'Elena Rossi', mitigation: 'Dedicated environment owner and daily defect triage from 3 August.', due_date: '2026-08-03', status: 'open', last_update: '2026-07-21', evidence_reference: 'uat-readiness-check-07-21' },
  { risk_id: 'R-05', title: 'Support-team adoption is late', category: 'change', probability_pct: 35, impact_eur: 30000, exposure_eur: 10500, owner: 'Anna Keller', mitigation: 'Move training design forward and recruit super-users.', due_date: '2026-08-07', status: 'monitoring', last_update: '2026-07-17', evidence_reference: 'stakeholder-support-07-17' },
  { risk_id: 'R-06', title: 'Forecast cost exceeds approved work-package budgets', category: 'cost', probability_pct: 55, impact_eur: 52000, exposure_eur: 28600, owner: 'Luca Moretti', mitigation: 'Review API, migration, and reporting estimates in steering.', due_date: '2026-07-28', status: 'open', last_update: '2026-07-21', evidence_reference: 'cost-forecast-07-21' },
  { risk_id: 'R-07', title: 'Pilot customers unavailable in release week', category: 'stakeholder', probability_pct: 25, impact_eur: 25000, exposure_eur: 6250, owner: 'Mia Schneider', mitigation: 'Confirm primary and backup pilot groups before August.', due_date: '2026-08-14', status: 'monitoring', last_update: '2026-07-16', evidence_reference: 'pilot-plan-draft' },
  { risk_id: 'R-08', title: 'Reporting KPIs have ambiguous acceptance criteria', category: 'scope', probability_pct: 50, impact_eur: 28000, exposure_eur: 14000, owner: 'Sofia Romano', mitigation: 'Register exact definitions and source columns in Company Brain.', due_date: '2026-07-27', status: 'mitigating', last_update: '2026-07-20', evidence_reference: 'reporting-workshop-07-20' },
];

const decisionRows = [
  { decision_id: 'D-01', decision_date: '2026-06-12', title: 'Phase delivery instead of big-bang release', context: 'Risk review showed migration and adoption uncertainty.', decision: 'Use pilot release followed by controlled production rollout.', owner: 'Steering Group', impact: 'Adds pilot gate and reduces release blast radius.', status: 'approved', review_date: '2026-09-11', evidence_reference: 'steering-minutes-06-12' },
  { decision_id: 'D-02', decision_date: '2026-06-19', title: 'Defer native mobile application', context: 'Mobile delivery would exceed phase-one budget and schedule.', decision: 'Responsive web portal is phase one; native app moves to roadmap.', owner: 'Finance Sponsor', impact: 'Protects September target and EUR 765k baseline.', status: 'approved', review_date: '2026-11-02', evidence_reference: 'scope-baseline-v1.2' },
  { decision_id: 'D-03', decision_date: '2026-07-03', title: 'Adopt canonical customer identifier', context: 'Legacy systems use conflicting customer keys.', decision: 'New portal uses the ERP customer UUID as canonical identifier.', owner: 'Platform Lead', impact: 'Migration must maintain a reviewed cross-reference map.', status: 'approved', review_date: '2026-08-14', evidence_reference: 'adr-014-data-model' },
  { decision_id: 'D-04', decision_date: '2026-07-20', title: 'Invoice API error semantics', context: 'Finance and Platform disagree on partial invoice availability behavior.', decision: 'Pending workshop decision.', owner: 'Jonas Weber', impact: 'Blocks API completion and UAT test-case finalization.', status: 'open', review_date: '2026-07-24', evidence_reference: 'api-contract-review-07-20' },
  { decision_id: 'D-05', decision_date: '2026-07-21', title: 'Approve external penetration test', context: 'Internal security capacity is constrained.', decision: 'Pending budget-owner approval for external capacity.', owner: 'Tobias Hartmann', impact: 'Could protect the security approval milestone.', status: 'open', review_date: '2026-07-28', evidence_reference: 'security-review-07-18' },
  { decision_id: 'D-06', decision_date: '2026-07-21', title: 'Reporting KPI acceptance baseline', context: 'Managers use conflicting definitions for active customers and response time.', decision: 'Use registered Company Brain metrics as acceptance definitions.', owner: 'Sofia Romano', impact: 'Makes reporting tests deterministic and auditable.', status: 'approved', review_date: '2026-08-21', evidence_reference: 'reporting-workshop-07-20' },
];

const stakeholderRows = [
  { update_date: '2026-07-21', stakeholder: 'Finance Sponsor', sentiment: 'concerned', summary: 'Supports scope but wants forecast overrun explained before next steering.', commitments: 'Review cost options on 28 July.', next_contact: '2026-07-28', owner: 'Luca Moretti', evidence_reference: 'cost-forecast-07-21' },
  { update_date: '2026-07-20', stakeholder: 'Customer Service Lead', sentiment: 'supportive', summary: 'Wants training and escalation runbook earlier than currently planned.', commitments: 'Nominate four super-users by 31 July.', next_contact: '2026-07-31', owner: 'Anna Keller', evidence_reference: 'stakeholder-support-07-17' },
  { update_date: '2026-07-18', stakeholder: 'Security Officer', sentiment: 'concerned', summary: 'Release approval depends on penetration-test remediation evidence.', commitments: 'Confirm external assessor availability.', next_contact: '2026-07-24', owner: 'Tobias Hartmann', evidence_reference: 'security-review-07-18' },
  { update_date: '2026-07-17', stakeholder: 'Pilot Customer Group', sentiment: 'positive', summary: 'Customers value invoice download and order history; search filters need refinement.', commitments: 'Participate in September pilot if dates are confirmed in August.', next_contact: '2026-08-14', owner: 'Mia Schneider', evidence_reference: 'ux-test-report-07-17' },
  { update_date: '2026-07-21', stakeholder: 'Operations Managers', sentiment: 'neutral', summary: 'KPI definitions and dashboard drill-down remain unclear.', commitments: 'Approve acceptance examples after definition workshop.', next_contact: '2026-07-27', owner: 'Sofia Romano', evidence_reference: 'reporting-workshop-07-20' },
  { update_date: '2026-07-21', stakeholder: 'Project Team', sentiment: 'concerned', summary: 'API and migration dependencies are compressing the UAT window.', commitments: 'Run daily dependency stand-up until UAT is unblocked.', next_contact: '2026-07-22', owner: 'Elena Rossi', evidence_reference: 'uat-readiness-check-07-21' },
];

type ColumnSeed = { name: string; normalized_name: string; data_type: 'text' | 'number' | 'date' | 'boolean'; semantic_name: string; description: string; is_required: boolean; validation_rules: Record<string, unknown> };

function column(name: string, normalized_name: string, data_type: ColumnSeed['data_type'], semantic_name: string, description: string, validation_rules: Record<string, unknown> = {}): ColumnSeed {
  return { name, normalized_name, data_type, semantic_name, description, is_required: true, validation_rules };
}

async function ensureKeyword(db: SupabaseClient, orgId: string, seed: KeywordSeed, ids: Map<string, string>) {
  const { data: existing, error: findError } = await db.from('keywords').select('id,labels_json').eq('organization_id', orgId).eq('slug', seed.slug).maybeSingle();
  if (findError) throw findError;
  const projectLabels = seed.parent
    ? { project: 'atlas', seeded: true }
    : { project: 'atlas', seeded: true, is_project: true, object_type: 'project' };
  if (existing) {
    await db.from('keywords').update({ labels_json: { ...(existing.labels_json ?? {}), ...projectLabels } }).eq('id', existing.id).eq('organization_id', orgId);
    ids.set(seed.slug, existing.id);
    return existing.id;
  }
  const { score } = computeCompleteness(seed);
  const { data, error } = await db.from('keywords').insert({
    organization_id: orgId, title: seed.title, slug: seed.slug, parent_id: seed.parent ? ids.get(seed.parent) : null,
    keyword_type: seed.type, status: 'active', access_level: 'worker', definition: seed.definition,
    explanation: seed.explanation, examples: seed.examples, synonyms: seed.synonyms, rules: seed.rules,
    labels_json: projectLabels, completeness_score: score,
  }).select('id').single();
  if (error) throw error;
  ids.set(seed.slug, data.id);
  return data.id;
}

async function ensureDataset(
  db: SupabaseClient, orgId: string, keywordId: string, title: string, tableName: string,
  description: string, columns: ColumnSeed[], rows: Array<Record<string, unknown>>
) {
  const { data: found } = await db.from('datasets').select('id').eq('organization_id', orgId).eq('title', title).limit(1);
  let datasetId = found?.[0]?.id;
  if (!datasetId) {
    const { data, error } = await db.from('datasets').insert({ organization_id: orgId, keyword_id: keywordId, title, description, status: 'active' }).select('id').single();
    if (error) throw error;
    datasetId = data.id;
  }
  const { data: foundTable } = await db.from('dataset_tables').select('id').eq('dataset_id', datasetId).eq('name', tableName).maybeSingle();
  let tableId = foundTable?.id;
  if (!tableId) {
    const { data, error } = await db.from('dataset_tables').insert({ dataset_id: datasetId, name: tableName, row_count: rows.length, column_count: columns.length, meta_json: { source: 'project-atlas-seed', grain: 'project_control_record', editable: true } }).select('id').single();
    if (error) throw error;
    tableId = data.id;
  }
  const { error: columnError } = await db.from('dataset_columns').upsert(columns.map((definition) => ({
    dataset_table_id: tableId, ...definition,
    sample_values: rows.slice(0, 3).map((row) => String(row[definition.normalized_name] ?? '')),
  })), { onConflict: 'dataset_table_id,normalized_name' });
  if (columnError) throw columnError;
  const { error: rowError } = await db.from('dataset_rows').upsert(rows.map((data, index) => ({
    dataset_table_id: tableId, row_index: index + 1, data,
    source_json: { source: 'project-atlas-seed', record: index + 1, seeded_at: '2026-07-21' },
  })), { onConflict: 'dataset_table_id,row_index', ignoreDuplicates: true });
  if (rowError) throw rowError;
  const { count } = await db.from('dataset_rows').select('id', { count: 'exact', head: true }).eq('dataset_table_id', tableId);
  await db.from('dataset_tables').update({ row_count: count ?? rows.length, column_count: columns.length }).eq('id', tableId);
  return tableId;
}

async function ensureMetric(db: SupabaseClient, orgId: string, keywordId: string, tableId: string, definition: any) {
  const { data: existing } = await db.from('metrics').select('id').eq('organization_id', orgId).eq('name', definition.name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db.from('metrics').insert({
    organization_id: orgId, keyword_id: keywordId, source_table_id: tableId,
    name: definition.name, description: definition.description, formula: definition.formula,
    aggregation: definition.aggregation, value_column: definition.value_column ?? null,
    date_column: definition.date_column ?? null, dimensions: definition.dimensions ?? [],
    filters: definition.filters ?? [], time_grain: definition.time_grain ?? 'month', caveats: definition.caveats ?? null,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function seedBusinessObjectLayer(
  db: SupabaseClient,
  orgId: string,
  projectId: string,
  keywordIds: string[],
  metricRows: any[],
  taskIds: string[],
  assetId: string
) {
  const probe = await db.from('business_objects').select('id').limit(1);
  if (probe.error) {
    if (['PGRST205', '42P01'].includes(String(probe.error.code ?? ''))) {
      console.log('  ↳ Business object seed skipped: apply migration 0008 first, then rerun this command.');
      return;
    }
    throw probe.error;
  }
  const { data: existing, error: findError } = await db
    .from('business_objects')
    .select('id')
    .eq('organization_id', orgId)
    .eq('object_type', 'project')
    .eq('external_key', 'PROJECT-ATLAS')
    .maybeSingle();
  if (findError) throw findError;
  let objectId = existing?.id;
  if (!objectId) {
    const { data, error } = await db.from('business_objects').insert({
      organization_id: orgId,
      object_type: 'project',
      external_key: 'PROJECT-ATLAS',
      display_name: 'Project Atlas',
      description: 'Customer-portal relaunch governed through sourced delivery, budget, risk, decision, task, and evidence records.',
      status: 'active',
      canonical_keyword_id: projectId,
      attributes: { target_go_live: '2026-09-21', steering_cadence: 'weekly', seeded: true },
    }).select('id').single();
    if (error) throw error;
    objectId = data.id;
  }

  const { data: projectDatasets } = await db
    .from('datasets')
    .select('id')
    .eq('organization_id', orgId)
    .in('keyword_id', keywordIds);
  const links = [
    ...keywordIds.map((keyword_id) => ({ keyword_id, link_role: keyword_id === projectId ? 'canonical' : 'context' })),
    ...(projectDatasets ?? []).map((dataset) => ({ dataset_id: dataset.id, link_role: 'source-data' })),
    ...metricRows.map((metric) => ({ metric_id: metric.id, link_role: 'measured-by' })),
    ...taskIds.map((task_id) => ({ task_id, link_role: 'work-item' })),
    { asset_id: assetId, link_role: 'approved-evidence' },
  ];
  for (const link of links) {
    let query = db.from('business_object_links').select('id').eq('organization_id', orgId).eq('object_id', objectId).eq('link_role', link.link_role);
    const target = Object.keys(link).find((key) => key.endsWith('_id'))!;
    query = query.eq(target, (link as any)[target]);
    const { data: found } = await query.maybeSingle();
    if (!found) {
      const { error } = await db.from('business_object_links').insert({ organization_id: orgId, object_id: objectId, ...link });
      if (error) throw error;
    }
  }

  const fixedFacts = [
    { id: '92000000-0000-0000-0000-000000000001', fact_key: 'target_go_live', value: '2026-09-21', data_type: 'date', truth_status: 'approved', source_type: 'document', source_asset_id: assetId, derivation: null },
    { id: '92000000-0000-0000-0000-000000000002', fact_key: 'steering_cadence', value: 'weekly_tuesday', data_type: 'text', truth_status: 'approved', source_type: 'document', source_asset_id: assetId, derivation: null },
  ];
  const factKeyByMetric = new Map([
    ['Atlas Approved Budget', ['approved_budget', 'currency', 'EUR']],
    ['Atlas Actual Cost', ['actual_cost', 'currency', 'EUR']],
    ['Atlas Forecast Cost', ['forecast_cost', 'currency', 'EUR']],
    ['Atlas Average Progress', ['average_progress', 'percentage', '%']],
    ['Atlas Open Risk Exposure', ['open_risk_exposure', 'currency', 'EUR']],
    ['Atlas Open Decisions', ['open_decisions', 'number', null]],
  ] as const);
  const metricFacts: any[] = [];
  for (const metric of metricRows) {
    const definition = factKeyByMetric.get(metric.name);
    if (!definition) continue;
    const result = await computeMetric(db, orgId, metric as MetricDefinition);
    metricFacts.push({
      id: `92000000-0000-0000-0001-${String(metricFacts.length + 1).padStart(12, '0')}`,
      fact_key: definition[0], value: result.value, data_type: definition[1], unit: definition[2],
      truth_status: 'derived', source_type: 'metric', source_metric_id: metric.id,
      derivation: `${metric.name}: ${metric.formula}; ${result.matched_rows} source rows`,
    });
  }
  const { error: factsError } = await db.from('business_facts').upsert(
    [...fixedFacts, ...metricFacts].map((fact) => ({
      organization_id: orgId, object_id: objectId, valid_from: '2026-07-21T00:00:00Z', confidence: 1, ...fact,
    })),
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (factsError) throw factsError;

  const { error: eventsError } = await db.from('business_events').upsert([
    { id: '93000000-0000-0000-0000-000000000001', organization_id: orgId, object_id: objectId, event_type: 'scope_baseline_approved', occurred_at: '2026-06-19T15:00:00Z', payload: { baseline: 'v1.2' }, truth_status: 'approved', source_type: 'document', source_asset_id: assetId },
    { id: '93000000-0000-0000-0000-000000000002', organization_id: orgId, object_id: objectId, event_type: 'management_review', occurred_at: '2026-07-21T10:00:00Z', payload: { forecast_status: 'over_budget', uat_status: 'blocked' }, truth_status: 'verified', source_type: 'document', source_asset_id: assetId },
  ], { onConflict: 'id', ignoreDuplicates: true });
  if (eventsError) throw eventsError;
  console.log(`  ✓ Grounded business object: Project Atlas with ${fixedFacts.length + metricFacts.length} current facts, ${links.length} context links, and 2 events.`);
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service configuration in .env');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const slug = arg('org') ?? 'milan';
  const { data: org, error: orgError } = await db.from('organizations').select('id,name').eq('slug', slug).maybeSingle();
  if (orgError) throw orgError;
  if (!org) throw new Error(`Organization "${slug}" not found.`);

  const ids = new Map<string, string>();
  for (const seed of keywordSeeds) await ensureKeyword(db, org.id, seed, ids);
  const projectId = ids.get('project-atlas')!;
  for (const [child, type, note] of [
    ['atlas-scope', 'contains', 'The approved scope defines the project boundary.'],
    ['atlas-milestone', 'contains', 'Milestones control evidence-based delivery gates.'],
    ['atlas-risk', 'contains', 'Risks are reviewed as part of project control.'],
    ['atlas-decision', 'contains', 'Decisions preserve binding project context.'],
    ['atlas-stakeholder', 'contains', 'Stakeholder commitments affect project delivery.'],
    ['atlas-budget', 'contains', 'Budget tracks actual and forecast cost.'],
  ] as const) {
    await db.from('keyword_relations').upsert({ organization_id: org.id, from_keyword_id: projectId, to_keyword_id: ids.get(child), relation_type: type, note, strength: 9 }, { onConflict: 'from_keyword_id,relation_type,to_keyword_id', ignoreDuplicates: true });
  }
  await db.from('keyword_relations').upsert([
    { organization_id: org.id, from_keyword_id: ids.get('atlas-milestone'), to_keyword_id: ids.get('atlas-risk'), relation_type: 'depends-on', note: 'Milestone confidence depends on unresolved risk exposure.', strength: 8 },
    { organization_id: org.id, from_keyword_id: ids.get('atlas-decision'), to_keyword_id: ids.get('atlas-scope'), relation_type: 'approves', note: 'Approved decisions change or confirm project scope.', strength: 9 },
    { organization_id: org.id, from_keyword_id: ids.get('atlas-risk'), to_keyword_id: ids.get('atlas-budget'), relation_type: 'causes', note: 'Material risks can increase forecast cost.', strength: 8 },
  ], { onConflict: 'from_keyword_id,relation_type,to_keyword_id', ignoreDuplicates: true });

  const projectTable = await ensureDataset(db, org.id, projectId, '[Project Atlas] Project Control', 'project_atlas_control', 'Work-package plan with progress, dates, cost, dependencies, risk, next action, and evidence.', [
    column('Work Package ID', 'work_package_id', 'text', 'work_package_id', 'Stable work-package identifier.'),
    column('Workstream', 'workstream', 'text', 'workstream', 'Delivery workstream.'),
    column('Deliverable', 'deliverable', 'text', 'deliverable', 'Evidence-based outcome.'),
    column('Owner', 'owner', 'text', 'owner', 'Accountable work-package owner.'),
    column('Planned Start', 'planned_start', 'date', 'planned_start_date', 'Baseline start date.'),
    column('Planned End', 'planned_end', 'date', 'planned_end_date', 'Current baseline end date.'),
    column('Progress %', 'progress_pct', 'number', 'progress_percentage', 'Verified completion percentage.', { min: 0, max: 100 }),
    column('Status', 'status', 'text', 'work_status', 'todo, in_progress, blocked, or done.'),
    column('Budget EUR', 'budget_eur', 'number', 'approved_budget', 'Approved work-package budget.', { min: 0 }),
    column('Actual Cost EUR', 'actual_cost_eur', 'number', 'actual_cost', 'Cost incurred to date.', { min: 0 }),
    column('Forecast Cost EUR', 'forecast_cost_eur', 'number', 'forecast_cost', 'Expected final work-package cost.', { min: 0 }),
    column('Risk Level', 'risk_level', 'text', 'risk_level', 'low, medium, or high.'),
    column('Dependency', 'dependency', 'text', 'dependency_reference', 'Predecessor work-package IDs.'),
    column('Next Action', 'next_action', 'text', 'next_action', 'Concrete next management action.'),
    column('Evidence', 'evidence_reference', 'text', 'evidence_reference', 'Reference supporting current status.'),
  ], projectRows);

  const riskTable = await ensureDataset(db, org.id, ids.get('atlas-risk')!, '[Project Atlas] Risk Register', 'project_atlas_risks', 'Quantified project risks with mitigation, owner, timing, status, and evidence.', [
    column('Risk ID', 'risk_id', 'text', 'risk_id', 'Stable risk identifier.'),
    column('Risk', 'title', 'text', 'risk_title', 'Uncertain event or condition.'),
    column('Category', 'category', 'text', 'risk_category', 'Primary risk category.'),
    column('Probability %', 'probability_pct', 'number', 'risk_probability', 'Assessed probability.', { min: 0, max: 100 }),
    column('Impact EUR', 'impact_eur', 'number', 'risk_impact', 'Estimated financial impact.', { min: 0 }),
    column('Exposure EUR', 'exposure_eur', 'number', 'risk_exposure', 'Probability multiplied by impact.', { min: 0 }),
    column('Owner', 'owner', 'text', 'owner', 'Accountable risk owner.'),
    column('Mitigation', 'mitigation', 'text', 'risk_mitigation', 'Approved response action.'),
    column('Due Date', 'due_date', 'date', 'due_date', 'Mitigation due date.'),
    column('Status', 'status', 'text', 'risk_status', 'open, mitigating, monitoring, or closed.'),
    column('Last Update', 'last_update', 'date', 'last_update_date', 'Date of latest evidence-based review.'),
    column('Evidence', 'evidence_reference', 'text', 'evidence_reference', 'Supporting review evidence.'),
  ], riskRows);

  const decisionTable = await ensureDataset(db, org.id, ids.get('atlas-decision')!, '[Project Atlas] Decision Log', 'project_atlas_decisions', 'Binding project choices and unresolved decisions with context and impact.', [
    column('Decision ID', 'decision_id', 'text', 'decision_id', 'Stable decision identifier.'),
    column('Decision Date', 'decision_date', 'date', 'decision_date', 'Date raised or approved.'),
    column('Title', 'title', 'text', 'decision_title', 'Short decision name.'),
    column('Context', 'context', 'text', 'decision_context', 'Why a choice is needed.'),
    column('Decision', 'decision', 'text', 'decision_outcome', 'Approved outcome or pending state.'),
    column('Owner', 'owner', 'text', 'owner', 'Accountable decision owner.'),
    column('Impact', 'impact', 'text', 'decision_impact', 'Consequence for project delivery.'),
    column('Status', 'status', 'text', 'decision_status', 'open or approved.'),
    column('Review Date', 'review_date', 'date', 'review_date', 'Next review or confirmation date.'),
    column('Evidence', 'evidence_reference', 'text', 'evidence_reference', 'Meeting, ADR, or baseline reference.'),
  ], decisionRows);

  const stakeholderTable = await ensureDataset(db, org.id, ids.get('atlas-stakeholder')!, '[Project Atlas] Stakeholder Updates', 'project_atlas_stakeholders', 'Current stakeholder position, concerns, commitments, and next communication.', [
    column('Update Date', 'update_date', 'date', 'update_date', 'Date of stakeholder update.'),
    column('Stakeholder', 'stakeholder', 'text', 'stakeholder', 'Person or group.'),
    column('Sentiment', 'sentiment', 'text', 'stakeholder_sentiment', 'positive, supportive, neutral, or concerned.'),
    column('Summary', 'summary', 'text', 'stakeholder_summary', 'Current position and concern.'),
    column('Commitments', 'commitments', 'text', 'commitments', 'Promised action or decision.'),
    column('Next Contact', 'next_contact', 'date', 'next_contact_date', 'Next planned communication.'),
    column('Owner', 'owner', 'text', 'owner', 'Project contact responsible.'),
    column('Evidence', 'evidence_reference', 'text', 'evidence_reference', 'Meeting or communication evidence.'),
  ], stakeholderRows);

  const metricSpecs = [
    [projectId, projectTable, { name: 'Atlas Approved Budget', description: 'Approved budget across all Atlas work packages.', formula: 'sum(budget_eur)', aggregation: 'sum', value_column: 'budget_eur', date_column: 'planned_end', dimensions: ['workstream','status'] }],
    [projectId, projectTable, { name: 'Atlas Actual Cost', description: 'Cost incurred to date across Atlas.', formula: 'sum(actual_cost_eur)', aggregation: 'sum', value_column: 'actual_cost_eur', date_column: 'planned_end', dimensions: ['workstream','status'] }],
    [ids.get('atlas-budget'), projectTable, { name: 'Atlas Forecast Cost', description: 'Current expected final cost.', formula: 'sum(forecast_cost_eur)', aggregation: 'sum', value_column: 'forecast_cost_eur', date_column: 'planned_end', dimensions: ['workstream','risk_level'] }],
    [projectId, projectTable, { name: 'Atlas Average Progress', description: 'Unweighted average verified work-package progress.', formula: 'avg(progress_pct)', aggregation: 'avg', value_column: 'progress_pct', date_column: 'planned_end', dimensions: ['workstream','status'] }],
    [ids.get('atlas-milestone'), projectTable, { name: 'Atlas Completed Work Packages', description: 'Work packages with status done.', formula: 'count(*) where status = done', aggregation: 'count', filters: [{ field: 'status', op: 'eq', value: 'done' }], date_column: 'planned_end' }],
    [ids.get('atlas-risk'), projectTable, { name: 'Atlas High-risk Work Packages', description: 'Work packages currently assessed high risk.', formula: 'count(*) where risk_level = high', aggregation: 'count', filters: [{ field: 'risk_level', op: 'eq', value: 'high' }], date_column: 'planned_end' }],
    [ids.get('atlas-risk'), riskTable, { name: 'Atlas Open Risk Exposure', description: 'Financial exposure across open or actively mitigated risks.', formula: 'sum(exposure_eur) where status in open, mitigating', aggregation: 'sum', value_column: 'exposure_eur', filters: [{ field: 'status', op: 'in', values: ['open','mitigating'] }], date_column: 'last_update', dimensions: ['category','owner','status'] }],
    [ids.get('atlas-risk'), riskTable, { name: 'Atlas Open Risk Count', description: 'Count of open or actively mitigated risks.', formula: 'count(*) where status in open, mitigating', aggregation: 'count', filters: [{ field: 'status', op: 'in', values: ['open','mitigating'] }], date_column: 'last_update' }],
    [ids.get('atlas-decision'), decisionTable, { name: 'Atlas Open Decisions', description: 'Unresolved decisions requiring ownership.', formula: 'count(*) where status = open', aggregation: 'count', filters: [{ field: 'status', op: 'eq', value: 'open' }], date_column: 'decision_date' }],
    [ids.get('atlas-stakeholder'), stakeholderTable, { name: 'Atlas Concerned Stakeholders', description: 'Stakeholder updates with concerned sentiment.', formula: 'count(*) where sentiment = concerned', aggregation: 'count', filters: [{ field: 'sentiment', op: 'eq', value: 'concerned' }], date_column: 'update_date' }],
  ] as const;
  const metricIds: string[] = [];
  for (const [keywordId, tableId, definition] of metricSpecs) metricIds.push(await ensureMetric(db, org.id, keywordId!, tableId, definition));

  const brief = `# Project Atlas — approved project brief\n\nObjective: launch the replacement customer portal by 21 September 2026 with invoice access, order history, support requests, catalogue search, and manager reporting.\n\nGovernance: steering meets each Tuesday. Scope changes require a decision record with budget and schedule impact. Forecast cost is reviewed weekly. Critical blockers are escalated within one business day.\n\nCurrent management assessment on 21 July 2026: API integration, legacy-data migration, UAT readiness, and security approval form the critical path. The forecast is above the approved work-package budget in several areas. Finance wants an explanation and options at the 28 July steering meeting. UAT is blocked until a stable environment and usable migration dataset exist.\n\nRelease gates: approved API contract; successful migration rehearsal; UAT exit; security approval; pilot acceptance; go/no-go decision. Every gate requires linked evidence.\n\nOut of scope for phase one: native mobile applications and embedded payment processing.`;
  const { data: foundAsset } = await db.from('assets').select('id').eq('organization_id', org.id).eq('file_name', 'project-atlas-approved-brief.md').maybeSingle();
  let assetId = foundAsset?.id;
  if (!assetId) {
    const { data, error } = await db.from('assets').insert({ organization_id: org.id, file_name: 'project-atlas-approved-brief.md', title: 'Project Atlas Approved Brief', description: 'Approved scope, governance, current assessment, and release gates.', source: 'project-atlas-seed', file_url: `data:text/markdown;charset=utf-8,${encodeURIComponent(brief)}`, file_type: 'text', mime_type: 'text/markdown', file_size: Buffer.byteLength(brief), extracted_text: brief, processed: true, processing_status: 'processed', meta_json: { source: 'project-atlas-seed' } }).select('id').single();
    if (error) throw error;
    assetId = data.id;
  }
  for (const keywordId of [projectId, ids.get('atlas-scope'), ids.get('atlas-milestone'), ids.get('atlas-risk')]) {
    await db.from('keyword_assets').upsert({ keyword_id: keywordId, asset_id: assetId, relevance_score: 10, note: 'Approved Project Atlas management context.' }, { onConflict: 'keyword_id,asset_id', ignoreDuplicates: true });
  }
  const chunks = brief.split(/\n\n+/).filter(Boolean);
  await db.from('chunks').upsert(chunks.map((chunk_text, chunk_index) => ({ asset_id: assetId, keyword_id: projectId, organization_id: org.id, chunk_index, chunk_text, chunk_type: chunk_index === 0 ? 'heading' : 'text', token_count: Math.ceil(chunk_text.length / 4), meta_json: { source: 'project-atlas-seed' } })), { onConflict: 'asset_id,chunk_index', ignoreDuplicates: true });

  const { data: membership } = await db.from('organization_members').select('id,user_id').eq('organization_id', org.id).order('created_at').limit(1).maybeSingle();
  const taskSeeds = [
    { id: '91000000-0000-0000-0000-000000000001', keyword: 'atlas-decision', title: 'Approve invoice API error contract', description: 'Finance and Platform must approve partial-availability and error semantics. Evidence: signed API decision record.', status: 'in_progress', priority: 'urgent', due_date: '2026-07-24' },
    { id: '91000000-0000-0000-0000-000000000002', keyword: 'atlas-risk', title: 'Resolve duplicate customer identifiers', description: 'Complete matching rules and route unresolved duplicates to business owners. Evidence: migration exception report.', status: 'in_progress', priority: 'urgent', due_date: '2026-07-29' },
    { id: '91000000-0000-0000-0000-000000000003', keyword: 'atlas-milestone', title: 'Complete customer and invoice API', description: 'Finish API implementation after contract approval and publish integration-test evidence.', status: 'todo', priority: 'high', due_date: '2026-08-07' },
    { id: '91000000-0000-0000-0000-000000000004', keyword: 'atlas-risk', title: 'Stabilize UAT environment', description: 'Assign environment owner, establish deployment calendar, and close critical environment defects.', status: 'blocked', priority: 'urgent', due_date: '2026-08-03' },
    { id: '91000000-0000-0000-0000-000000000005', keyword: 'atlas-milestone', title: 'Run migration rehearsal 3', description: 'Execute full-volume migration with reconciled counts and signed exception list.', status: 'todo', priority: 'high', due_date: '2026-08-10' },
    { id: '91000000-0000-0000-0000-000000000006', keyword: 'atlas-milestone', title: 'Start user acceptance testing', description: 'Begin UAT only when API, migration dataset, and stable environment evidence are available.', status: 'blocked', priority: 'high', due_date: '2026-08-12' },
    { id: '91000000-0000-0000-0000-000000000007', keyword: 'atlas-budget', title: 'Prepare forecast-overrun options', description: 'Explain forecast drivers and present reduce-scope, add-budget, and schedule options to Finance.', status: 'todo', priority: 'high', due_date: '2026-07-28' },
    { id: '91000000-0000-0000-0000-000000000008', keyword: 'atlas-stakeholder', title: 'Confirm support super-users', description: 'Customer Service Lead nominates four super-users for training design and pilot support.', status: 'todo', priority: 'medium', due_date: '2026-07-31' },
    { id: '91000000-0000-0000-0000-000000000009', keyword: 'atlas-risk', title: 'Approve external penetration test', description: 'Finance Sponsor approves external test capacity and security owner books assessment dates.', status: 'todo', priority: 'high', due_date: '2026-07-28' },
    { id: '91000000-0000-0000-0000-000000000010', keyword: 'atlas-milestone', title: 'Prepare go/no-go evidence pack', description: 'Compile UAT exit, security approval, pilot acceptance, operations runbook, and rollback evidence.', status: 'todo', priority: 'medium', due_date: '2026-09-14' },
  ];
  for (const task of taskSeeds) {
    await db.from('tasks').upsert({ id: task.id, organization_id: org.id, keyword_id: ids.get(task.keyword), title: task.title, description: `${task.description} [project-atlas-seed]`, status: task.status, priority: task.priority, due_date: task.due_date, assignee_member_id: membership?.id ?? null, created_by: membership?.user_id ?? null }, { onConflict: 'id', ignoreDuplicates: true });
  }
  for (const [task_id, depends_on_task_id] of [
    [taskSeeds[2].id, taskSeeds[0].id], [taskSeeds[3].id, taskSeeds[0].id], [taskSeeds[4].id, taskSeeds[1].id],
    [taskSeeds[5].id, taskSeeds[2].id], [taskSeeds[5].id, taskSeeds[3].id], [taskSeeds[5].id, taskSeeds[4].id],
    [taskSeeds[9].id, taskSeeds[5].id], [taskSeeds[9].id, taskSeeds[8].id],
  ]) {
    await db.from('task_dependencies').upsert({ organization_id: org.id, task_id, depends_on_task_id }, { onConflict: 'task_id,depends_on_task_id', ignoreDuplicates: true });
  }

  const { data: metricRows } = await db.from('metrics').select('*').eq('organization_id', org.id).in('id', metricIds).order('name');
  console.log(`Seeded ${org.name}: ${keywordSeeds.length} connected concepts, 4 editable project tables, ${taskSeeds.length} dependent tasks, one evidence brief, and ${metricIds.length} exact metrics.`);
  for (const metric of metricRows ?? []) {
    const result = await computeMetric(db, org.id, metric as MetricDefinition);
    if (result.missing.length) throw new Error(`${metric.name}: ${result.missing.join(' ')}`);
    console.log(`  ✓ ${metric.name}: ${result.value} (${result.matched_rows} rows)`);
  }
  await seedBusinessObjectLayer(
    db,
    org.id,
    projectId,
    Array.from(ids.values()),
    metricRows ?? [],
    taskSeeds.map((task) => task.id),
    assetId
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
