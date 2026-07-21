/**
 * Additive operational seed for testing the Company Brain with editable data.
 *
 *   npm run seed:operations
 *   npm run seed:operations -- --org demo-restaurant
 *   npm run seed:operations -- --list
 *
 * This script never deletes data. Existing row indexes are left unchanged so
 * manual edits made in the spreadsheet workspace survive subsequent runs.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { computeCompleteness } from '../src/lib/ontology/completeness';
import { computeMetric, MetricDefinition } from '../src/lib/metrics/compute';

function loadEnv() {
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
    ? process.argv[index + 1]
    : null;
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

interface WorkRow {
  business_date: string;
  employee_id: string;
  employee_name: string;
  department: string;
  role: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  scheduled_hours: number;
  worked_hours: number;
  overtime_hours: number;
  hourly_cost_eur: number;
  labor_cost_eur: number;
  status: 'completed' | 'absent';
  evidence_reference: string;
}

const people = [
  { id: 'EMP-001', name: 'Anna Keller', department: 'service', role: 'shift_manager', hourly: 24.5 },
  { id: 'EMP-002', name: 'Luca Moretti', department: 'kitchen', role: 'head_chef', hourly: 28 },
  { id: 'EMP-003', name: 'Mia Schneider', department: 'service', role: 'server', hourly: 19.5 },
  { id: 'EMP-004', name: 'Jonas Weber', department: 'kitchen', role: 'line_cook', hourly: 21.5 },
  { id: 'EMP-005', name: 'Sofia Romano', department: 'service', role: 'server', hourly: 19.5 },
  { id: 'EMP-006', name: 'David Fischer', department: 'kitchen', role: 'kitchen_assistant', hourly: 18.5 },
];

function localTimestamp(date: string, time: string): string {
  return `${date}T${time}:00+02:00`;
}

function workRows(): WorkRow[] {
  const days = [
    { date: '2026-07-13', staff: [0, 1, 2, 3], busy: false },
    { date: '2026-07-14', staff: [0, 1, 4, 5], busy: false },
    { date: '2026-07-15', staff: [0, 1, 2, 3], busy: false },
    { date: '2026-07-16', staff: [0, 1, 4, 5], busy: false },
    { date: '2026-07-17', staff: [0, 1, 2, 3, 4, 5], busy: true },
    { date: '2026-07-18', staff: [0, 1, 2, 3, 4, 5], busy: true },
    { date: '2026-07-19', staff: [0, 1, 2, 3, 4], busy: true },
    { date: '2026-07-20', staff: [0, 1, 4, 5], busy: false },
  ];

  const rows: WorkRow[] = [];
  for (const [dayIndex, day] of days.entries()) {
    for (const [staffIndex, personIndex] of day.staff.entries()) {
      const person = people[personIndex];
      const kitchen = person.department === 'kitchen';
      const plannedStart = kitchen ? '14:00' : '16:00';
      const plannedEnd = kitchen ? '22:30' : '23:30';
      const scheduledHours = kitchen ? 8 : 7;
      const absent = day.date === '2026-07-16' && person.id === 'EMP-005';
      const startDeltaMinutes = ((dayIndex + staffIndex) % 4) * 3 - 3;
      const extraMinutes = day.busy ? 24 + ((personIndex + dayIndex) % 4) * 9 : ((personIndex + dayIndex) % 3) * 6;
      const startHour = Number(plannedStart.slice(0, 2));
      const startMinute = Number(plannedStart.slice(3)) + startDeltaMinutes;
      const normalizedStart = new Date(Date.UTC(2026, 6, Number(day.date.slice(-2)), startHour, startMinute));
      const workedHours = absent ? 0 : Number((scheduledHours + extraMinutes / 60).toFixed(2));
      const end = new Date(normalizedStart.getTime() + workedHours * 3_600_000);
      const time = (value: Date) => `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
      const actualStart = absent ? null : localTimestamp(day.date, time(normalizedStart));
      const actualEnd = absent ? null : localTimestamp(day.date, time(end));
      const overtime = Number(Math.max(0, workedHours - scheduledHours).toFixed(2));

      rows.push({
        business_date: day.date,
        employee_id: person.id,
        employee_name: person.name,
        department: person.department,
        role: person.role,
        scheduled_start: localTimestamp(day.date, plannedStart),
        scheduled_end: localTimestamp(day.date, plannedEnd),
        actual_start: actualStart,
        actual_end: actualEnd,
        scheduled_hours: scheduledHours,
        worked_hours: workedHours,
        overtime_hours: overtime,
        hourly_cost_eur: person.hourly,
        labor_cost_eur: Number((workedHours * person.hourly).toFixed(2)),
        status: absent ? 'absent' : 'completed',
        evidence_reference: absent ? 'manager-note-2026-07-16' : `time-clock-${day.date}-${person.id}`,
      });
    }
  }
  return rows;
}

const columns = [
  { name: 'Business Date', normalized_name: 'business_date', data_type: 'date', semantic_name: 'business_date', description: 'Local operating date for the shift.', is_required: true, validation_rules: {} },
  { name: 'Employee ID', normalized_name: 'employee_id', data_type: 'text', semantic_name: 'employee_id', description: 'Stable internal employee identifier.', is_required: true, validation_rules: {} },
  { name: 'Employee Name', normalized_name: 'employee_name', data_type: 'text', semantic_name: 'employee_name', description: 'Employee display name.', is_required: true, validation_rules: {} },
  { name: 'Department', normalized_name: 'department', data_type: 'text', semantic_name: 'department', description: 'Kitchen or service.', is_required: true, validation_rules: {} },
  { name: 'Role', normalized_name: 'role', data_type: 'text', semantic_name: 'employee_role', description: 'Role worked during this shift.', is_required: true, validation_rules: {} },
  { name: 'Scheduled Start', normalized_name: 'scheduled_start', data_type: 'date', semantic_name: 'scheduled_start_timestamp', description: 'Planned shift start.', is_required: true, validation_rules: {} },
  { name: 'Scheduled End', normalized_name: 'scheduled_end', data_type: 'date', semantic_name: 'scheduled_end_timestamp', description: 'Planned shift end.', is_required: true, validation_rules: {} },
  { name: 'Actual Start', normalized_name: 'actual_start', data_type: 'date', semantic_name: 'actual_start_timestamp', description: 'Clocked shift start; empty for absence.', is_required: false, validation_rules: {} },
  { name: 'Actual End', normalized_name: 'actual_end', data_type: 'date', semantic_name: 'actual_end_timestamp', description: 'Clocked shift end; empty for absence.', is_required: false, validation_rules: {} },
  { name: 'Scheduled Hours', normalized_name: 'scheduled_hours', data_type: 'number', semantic_name: 'scheduled_hours', description: 'Paid hours planned for the employee.', is_required: true, validation_rules: { min: 0, max: 16 } },
  { name: 'Worked Hours', normalized_name: 'worked_hours', data_type: 'number', semantic_name: 'worked_hours', description: 'Clocked paid hours.', is_required: true, validation_rules: { min: 0, max: 16 } },
  { name: 'Overtime Hours', normalized_name: 'overtime_hours', data_type: 'number', semantic_name: 'overtime_hours', description: 'Worked hours above scheduled hours.', is_required: true, validation_rules: { min: 0, max: 8 } },
  { name: 'Hourly Cost EUR', normalized_name: 'hourly_cost_eur', data_type: 'number', semantic_name: 'hourly_labor_cost', description: 'Employer cost per paid hour in EUR.', is_required: true, validation_rules: { min: 0 } },
  { name: 'Labor Cost EUR', normalized_name: 'labor_cost_eur', data_type: 'number', semantic_name: 'labor_cost', description: 'Worked hours multiplied by hourly employer cost.', is_required: true, validation_rules: { min: 0 } },
  { name: 'Status', normalized_name: 'status', data_type: 'text', semantic_name: 'shift_status', description: 'completed or absent.', is_required: true, validation_rules: {} },
  { name: 'Evidence', normalized_name: 'evidence_reference', data_type: 'text', semantic_name: 'evidence_reference', description: 'Time-clock record or manager note.', is_required: true, validation_rules: {} },
] as const;

async function verifyMetrics(db: SupabaseClient, organizationId: string, names: string[]) {
  const { data: metrics, error } = await db
    .from('metrics')
    .select('*')
    .eq('organization_id', organizationId)
    .in('name', names)
    .order('name');
  if (error) throw error;
  for (const metric of metrics ?? []) {
    const result = await computeMetric(db, organizationId, metric as MetricDefinition);
    if (result.missing.length) throw new Error(`${metric.name}: ${result.missing.join(' ')}`);
    console.log(`  ✓ ${metric.name}: ${result.value ?? '—'} (${result.matched_rows} rows)`);
  }
}

async function verifyAllMetrics(db: SupabaseClient, organizationSlug: string) {
  const { data: organization, error: organizationError } = await db
    .from('organizations')
    .select('id,name')
    .eq('slug', organizationSlug)
    .maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization) throw new Error(`Organization "${organizationSlug}" was not found.`);
  const { data: metrics, error } = await db
    .from('metrics')
    .select('*')
    .eq('organization_id', organization.id)
    .order('name');
  if (error) throw error;
  console.log(`Verifying ${metrics?.length ?? 0} metrics for ${organization.name}:`);
  for (const metric of metrics ?? []) {
    const result = await computeMetric(db, organization.id, metric as MetricDefinition);
    const detail = result.missing.length ? `ERROR: ${result.missing.join(' ')}` : `${result.value ?? '—'} (${result.matched_rows} rows)`;
    console.log(`  ${result.missing.length ? '✗' : '✓'} ${metric.name}: ${detail}`);
  }
}

async function listOrganizations(db: SupabaseClient) {
  const { data: organizations, error } = await db.from('organizations').select('id,name,slug').order('created_at');
  if (error) throw error;
  for (const organization of organizations ?? []) {
    const [keywords, datasets, metrics, members] = await Promise.all([
      db.from('keywords').select('id', { count: 'exact', head: true }).eq('organization_id', organization.id),
      db.from('datasets').select('id,title,tables:dataset_tables(name,row_count,columns:dataset_columns(normalized_name,data_type,semantic_name))').eq('organization_id', organization.id),
      db.from('metrics').select('id,name,source_table_id').eq('organization_id', organization.id),
      db.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', organization.id),
    ]);
    const datasetNames = (datasets.data ?? []).map((dataset: any) => {
      const tables = (dataset.tables ?? []).map((table: any) => {
        const fields = (table.columns ?? []).map((column: any) => column.normalized_name).join(',');
        return `${table.name}:${table.row_count ?? 0}${fields ? ` {${fields}}` : ''}`;
      }).join(', ');
      return `${dataset.title} [${tables || 'no table'}]`;
    });
    console.log(`${organization.slug}: ${organization.name} (${members.count ?? 0} members, ${keywords.count ?? 0} keywords, ${datasets.data?.length ?? 0} datasets, ${metrics.data?.length ?? 0} metrics)`);
    for (const name of datasetNames) console.log(`  - ${name}`);
    if (metrics.data?.length) console.log(`  metrics: ${metrics.data.map((metric) => metric.name).join(', ')}`);
  }
}

async function ensureKeyword(db: SupabaseClient, organizationId: string) {
  const { data: matching, error } = await db
    .from('keywords')
    .select('id,slug,title')
    .eq('organization_id', organizationId)
    .in('slug', ['work-time', 'arbeitszeit', 'shift'])
    .limit(1);
  if (error) throw error;
  if (matching?.[0]) return matching[0];

  const definition = 'A planned or completed employee work period with scheduled time, actual clock times, paid hours, cost, status, and evidence.';
  const { score } = computeCompleteness({
    definition,
    explanation: 'This keyword connects employee schedules, time-clock entries, labor cost, overtime, and absence records to one editable operational table.',
    examples: ['EMP-003, 18 July 2026, 16:00–23:30, 8.05 worked hours'],
    synonyms: ['Work time', 'Shift schedule', 'Arbeitszeit', 'Dienstplan'],
    rules: ['Actual hours require a time-clock or manager evidence reference.', 'Labor cost equals worked hours multiplied by hourly employer cost.'],
  });
  const { data, error: insertError } = await db
    .from('keywords')
    .insert({
      organization_id: organizationId,
      title: 'Work Time',
      slug: 'work-time',
      keyword_type: 'process',
      status: 'active',
      access_level: 'worker',
      definition,
      explanation: 'Employee-level schedule and time-clock facts used for staffing, overtime, absence, and labor-cost calculations.',
      examples: ['Planned 7.0 hours; worked 7.6 hours; overtime 0.6 hours'],
      synonyms: ['Shift schedule', 'Arbeitszeit', 'Dienstplan'],
      rules: ['Do not record worked hours without evidence.', 'Keep scheduled and actual times separately.'],
      labels_json: { domain: 'people_and_labor', seeded: true },
      completeness_score: score,
    })
    .select('id,slug,title')
    .single();
  if (insertError) throw insertError;
  return data;
}

async function seedExistingArbeitszeitplanung(db: SupabaseClient, organization: { id: string; name: string }) {
  const { data: datasets, error: datasetError } = await db
    .from('datasets')
    .select('id,keyword_id,title,tables:dataset_tables(id,name,columns:dataset_columns(normalized_name))')
    .eq('organization_id', organization.id)
    .eq('title', 'Arbeitszeitplanung')
    .limit(1);
  if (datasetError) throw datasetError;
  const dataset = datasets?.[0] as any;
  const table = dataset?.tables?.find((candidate: any) => candidate.name === 'arbeitszeitplanung');
  if (!dataset || !table) return false;

  const requiredColumns = new Set([
    'datum', 'mitarbeiter_id', 'projekt', 'aufgabe', 'geplante_stunden',
    'tatsaechliche_stunden', 'status', 'nachweis', 'wochentag',
  ]);
  const liveColumns = new Set((table.columns ?? []).map((column: any) => column.normalized_name));
  if (![...requiredColumns].every((column) => liveColumns.has(column))) return false;

  const { count: seededCount, error: seededCountError } = await db
    .from('dataset_rows')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_table_id', table.id)
    .contains('source_json', { source: 'realistic-demo-work-schedule' });
  if (seededCountError) throw seededCountError;

  if (!seededCount) {
    const { data: latest, error: latestError } = await db
      .from('dataset_rows')
      .select('row_index')
      .eq('dataset_table_id', table.id)
      .order('row_index', { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    const firstIndex = Number(latest?.[0]?.row_index ?? 0) + 1;
    const projects = ['Kundenportal Relaunch', 'Company Brain Rollout', 'Monatsabschluss'];
    const tasks = ['Datenprüfung', 'Implementierung', 'Kundentermin', 'Dokumentation', 'Qualitätssicherung'];
    const source = workRows().map((row, index) => ({
      datum: row.business_date,
      mitarbeiter_id: row.employee_id,
      projekt: projects[(index + Number(row.employee_id.slice(-1))) % projects.length],
      aufgabe: row.status === 'absent' ? 'Krankmeldung' : tasks[index % tasks.length],
      geplante_stunden: row.scheduled_hours,
      tatsaechliche_stunden: row.worked_hours,
      status: row.status === 'absent' ? 'abwesend' : 'abgeschlossen',
      nachweis: row.evidence_reference,
      wochentag: new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'Europe/Berlin' }).format(new Date(`${row.business_date}T12:00:00+02:00`)),
    }));
    const { error: rowsError } = await db.from('dataset_rows').insert(
      source.map((data, index) => ({
        dataset_table_id: table.id,
        row_index: firstIndex + index,
        data,
        source_json: { source: 'realistic-demo-work-schedule', record: index + 1, seeded_at: '2026-07-21' },
      }))
    );
    if (rowsError) throw rowsError;
  }

  const { count: rowCount, error: rowCountError } = await db
    .from('dataset_rows')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_table_id', table.id);
  if (rowCountError) throw rowCountError;
  const { error: tableError } = await db
    .from('dataset_tables')
    .update({ row_count: rowCount ?? 0, column_count: liveColumns.size })
    .eq('id', table.id);
  if (tableError) throw tableError;

  const metricDefinitions = [
    { name: 'Geplante Arbeitsstunden', description: 'Summe aller geplanten Stunden in der Arbeitszeitplanung.', formula: 'sum(geplante_stunden)', aggregation: 'sum', value_column: 'geplante_stunden', filters: [] },
    { name: 'Tatsächliche Arbeitsstunden', description: 'Summe aller tatsächlich erfassten Arbeitsstunden.', formula: 'sum(tatsaechliche_stunden)', aggregation: 'sum', value_column: 'tatsaechliche_stunden', filters: [] },
    { name: 'Abgeschlossene Arbeitszeiteinträge', description: 'Anzahl der als abgeschlossen markierten Einträge.', formula: 'count(*) where status = abgeschlossen', aggregation: 'count', value_column: null, filters: [{ field: 'status', op: 'eq', value: 'abgeschlossen' }] },
    { name: 'Abwesenheiten laut Arbeitszeitplanung', description: 'Anzahl der als abwesend markierten Einträge.', formula: 'count(*) where status = abwesend', aggregation: 'count', value_column: null, filters: [{ field: 'status', op: 'eq', value: 'abwesend' }] },
  ];
  for (const metric of metricDefinitions) {
    const { data: existing, error: existingError } = await db
      .from('metrics')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('name', metric.name)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) continue;
    const { error } = await db.from('metrics').insert({
      organization_id: organization.id,
      keyword_id: dataset.keyword_id,
      source_table_id: table.id,
      name: metric.name,
      description: metric.description,
      formula: metric.formula,
      aggregation: metric.aggregation,
      value_column: metric.value_column,
      date_column: 'datum',
      dimensions: ['mitarbeiter_id', 'projekt', 'aufgabe', 'status', 'wochentag'],
      filters: metric.filters,
      time_grain: 'day',
      caveats: 'Realistische Testeinträge; vor operativer Nutzung durch verifizierte Geschäftsdaten ersetzen.',
    });
    if (error) throw error;
  }

  console.log(`Seeded ${organization.name} / Arbeitszeitplanung: ${rowCount ?? 0} editable rows and ${metricDefinitions.length} exact metrics.`);
  console.log('Your original rows were preserved; rerunning this command will not duplicate or overwrite seeded entries.');
  await verifyMetrics(db, organization.id, metricDefinitions.map((metric) => metric.name));
  return true;
}

async function seedExistingItemSales(db: SupabaseClient, organization: { id: string; name: string }) {
  const { data: datasets, error: datasetError } = await db
    .from('datasets')
    .select('id,keyword_id,title,tables:dataset_tables(id,name,columns:dataset_columns(normalized_name))')
    .eq('organization_id', organization.id)
    .eq('title', 'Gesamtumsatz der Artikel')
    .limit(1);
  if (datasetError) throw datasetError;
  const dataset = datasets?.[0] as any;
  const table = dataset?.tables?.find((candidate: any) => candidate.name === 'gesamtumsatz_artikel');
  if (!dataset || !table) return false;

  const requiredColumns = new Set([
    'business_date', 'employee_id', 'item_code', 'quantity_sold',
    'total_amount', 'currency', 'evidence_reference',
  ]);
  const liveColumns = new Set((table.columns ?? []).map((column: any) => column.normalized_name));
  if (![...requiredColumns].every((column) => liveColumns.has(column))) return false;

  const { count: seededCount, error: seededCountError } = await db
    .from('dataset_rows')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_table_id', table.id)
    .contains('source_json', { source: 'realistic-demo-item-sales' });
  if (seededCountError) throw seededCountError;

  if (!seededCount) {
    const { data: latest, error: latestError } = await db
      .from('dataset_rows')
      .select('row_index')
      .eq('dataset_table_id', table.id)
      .order('row_index', { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    const firstIndex = Number(latest?.[0]?.row_index ?? 0) + 1;
    const products = [
      { code: 'CB-STARTER', unitPrice: 490 },
      { code: 'CB-PRO', unitPrice: 1490 },
      { code: 'ONBOARDING', unitPrice: 850 },
      { code: 'TRAINING-DAY', unitPrice: 620 },
      { code: 'SUPPORT-HOUR', unitPrice: 125 },
    ];
    const dates = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-20'];
    const rows = dates.flatMap((date, dayIndex) =>
      products.slice(0, dayIndex % 2 === 0 ? 4 : 3).map((product, productIndex) => {
        const quantity = product.code === 'SUPPORT-HOUR' ? 2 + ((dayIndex + productIndex) % 4) : 1 + ((dayIndex + productIndex) % 2);
        return {
          business_date: date,
          employee_id: `EMP-${String((dayIndex + productIndex) % 4 + 1).padStart(3, '0')}`,
          item_code: product.code,
          quantity_sold: quantity,
          total_amount: quantity * product.unitPrice,
          currency: 'EUR',
          evidence_reference: `order-${date.replaceAll('-', '')}-${productIndex + 1}`,
        };
      })
    );
    const { error: rowsError } = await db.from('dataset_rows').insert(
      rows.map((data, index) => ({
        dataset_table_id: table.id,
        row_index: firstIndex + index,
        data,
        source_json: { source: 'realistic-demo-item-sales', record: index + 1, seeded_at: '2026-07-21' },
      }))
    );
    if (rowsError) throw rowsError;
  }

  const { count: rowCount, error: rowCountError } = await db
    .from('dataset_rows')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_table_id', table.id);
  if (rowCountError) throw rowCountError;
  const { error: tableError } = await db
    .from('dataset_tables')
    .update({ row_count: rowCount ?? 0, column_count: liveColumns.size })
    .eq('id', table.id);
  if (tableError) throw tableError;

  const metricDefinitions = [
    { name: 'Artikelumsatz EUR', description: 'Gesamter EUR-Umsatz aller erfassten Artikelverkäufe.', formula: 'sum(total_amount) where currency = EUR', aggregation: 'sum', value_column: 'total_amount' },
    { name: 'Verkaufte Artikelmenge', description: 'Gesamte verkaufte Stück- beziehungsweise Leistungseinheiten.', formula: 'sum(quantity_sold) where currency = EUR', aggregation: 'sum', value_column: 'quantity_sold' },
    { name: 'Durchschnittlicher Umsatz je Verkaufszeile', description: 'Durchschnittlicher EUR-Betrag pro erfasster Verkaufszeile.', formula: 'avg(total_amount) where currency = EUR', aggregation: 'avg', value_column: 'total_amount' },
  ];
  for (const metric of metricDefinitions) {
    const { data: existing, error: existingError } = await db
      .from('metrics')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('name', metric.name)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) continue;
    const { error } = await db.from('metrics').insert({
      organization_id: organization.id,
      keyword_id: dataset.keyword_id,
      source_table_id: table.id,
      name: metric.name,
      description: metric.description,
      formula: metric.formula,
      aggregation: metric.aggregation,
      value_column: metric.value_column,
      date_column: 'business_date',
      dimensions: ['employee_id', 'item_code', 'currency'],
      filters: [{ field: 'currency', op: 'eq', value: 'EUR' }],
      time_grain: 'day',
      caveats: 'Realistische Testeinträge; Umsatz ist der erfasste Zeilenbetrag und enthält keine automatisch angenommene Steuerlogik.',
    });
    if (error) throw error;
  }

  console.log(`Seeded ${organization.name} / Gesamtumsatz der Artikel: ${rowCount ?? 0} editable rows and ${metricDefinitions.length} exact metrics.`);
  console.log('Your original sales row was preserved; rerunning this command will not duplicate the seeded sales history.');
  await verifyMetrics(db, organization.id, metricDefinitions.map((metric) => metric.name));
  return true;
}

async function seed(db: SupabaseClient, organizationSlug: string) {
  const { data: organization, error: organizationError } = await db
    .from('organizations')
    .select('id,name,slug')
    .eq('slug', organizationSlug)
    .maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization) throw new Error(`Organization "${organizationSlug}" was not found. Use --list to see available slugs.`);

  const seededWorkTime = await seedExistingArbeitszeitplanung(db, organization);
  const seededItemSales = await seedExistingItemSales(db, organization);
  if (seededWorkTime || seededItemSales) return;

  const keyword = await ensureKeyword(db, organization.id);
  const title = '[Real Data Demo] Employee Work Time Schedule';
  const { data: existingDatasets, error: findDatasetError } = await db
    .from('datasets')
    .select('id')
    .eq('organization_id', organization.id)
    .eq('title', title)
    .limit(1);
  if (findDatasetError) throw findDatasetError;

  let datasetId = existingDatasets?.[0]?.id;
  if (!datasetId) {
    const { data, error } = await db
      .from('datasets')
      .insert({
        organization_id: organization.id,
        keyword_id: keyword.id,
        title,
        description: 'Realistic employee-level schedule and time-clock entries for testing editable tables, metrics, and grounded LLM answers.',
        status: 'active',
      })
      .select('id')
      .single();
    if (error) throw error;
    datasetId = data.id;
  } else {
    const { error } = await db.from('datasets').update({ keyword_id: keyword.id, status: 'active' }).eq('id', datasetId);
    if (error) throw error;
  }

  const { data: existingTable, error: findTableError } = await db
    .from('dataset_tables')
    .select('id')
    .eq('dataset_id', datasetId)
    .eq('name', 'employee_work_time_schedule')
    .maybeSingle();
  if (findTableError) throw findTableError;

  const rows = workRows();
  let tableId = existingTable?.id;
  if (!tableId) {
    const { data, error } = await db
      .from('dataset_tables')
      .insert({
        dataset_id: datasetId,
        name: 'employee_work_time_schedule',
        row_count: rows.length,
        column_count: columns.length,
        meta_json: { source: 'realistic_demo_time_clock', grain: 'employee_shift', editable: true },
      })
      .select('id')
      .single();
    if (error) throw error;
    tableId = data.id;
  }

  const { error: columnsError } = await db.from('dataset_columns').upsert(
    columns.map((column) => ({
      dataset_table_id: tableId,
      ...column,
      sample_values: rows.slice(0, 3).map((row) => String(row[column.normalized_name as keyof WorkRow] ?? '')),
    })),
    { onConflict: 'dataset_table_id,normalized_name' }
  );
  if (columnsError) throw columnsError;

  const { error: rowsError } = await db.from('dataset_rows').upsert(
    rows.map((data, index) => ({
      dataset_table_id: tableId,
      row_index: index + 1,
      data,
      source_json: { source: 'realistic-demo-time-clock', record: index + 1, seeded_at: '2026-07-21' },
    })),
    { onConflict: 'dataset_table_id,row_index', ignoreDuplicates: true }
  );
  if (rowsError) throw rowsError;

  const { count: rowCount, error: countError } = await db
    .from('dataset_rows')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_table_id', tableId);
  if (countError) throw countError;
  const { error: tableUpdateError } = await db
    .from('dataset_tables')
    .update({ row_count: rowCount ?? rows.length, column_count: columns.length })
    .eq('id', tableId);
  if (tableUpdateError) throw tableUpdateError;

  const metricDefinitions = [
    { name: 'Scheduled Labor Hours (Employee)', description: 'Total employee hours scheduled.', formula: 'sum(scheduled_hours)', aggregation: 'sum', value_column: 'scheduled_hours', filters: [] },
    { name: 'Worked Labor Hours (Employee)', description: 'Total employee hours recorded by the time clock.', formula: 'sum(worked_hours)', aggregation: 'sum', value_column: 'worked_hours', filters: [] },
    { name: 'Overtime Hours (Employee)', description: 'Total hours worked above the schedule.', formula: 'sum(overtime_hours)', aggregation: 'sum', value_column: 'overtime_hours', filters: [] },
    { name: 'Employee Labor Cost EUR', description: 'Total employer labor cost for completed employee shifts.', formula: 'sum(labor_cost_eur)', aggregation: 'sum', value_column: 'labor_cost_eur', filters: [] },
    { name: 'Completed Employee Shifts', description: 'Number of completed employee shift records.', formula: 'count(*) where status = completed', aggregation: 'count', value_column: null, filters: [{ field: 'status', op: 'eq', value: 'completed' }] },
    { name: 'Employee Absences', description: 'Number of employee shift records marked absent.', formula: 'count(*) where status = absent', aggregation: 'count', value_column: null, filters: [{ field: 'status', op: 'eq', value: 'absent' }] },
  ];

  for (const metric of metricDefinitions) {
    const { data: existing, error: findMetricError } = await db
      .from('metrics')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('name', metric.name)
      .maybeSingle();
    if (findMetricError) throw findMetricError;
    if (existing) continue;
    const { error } = await db.from('metrics').insert({
      organization_id: organization.id,
      keyword_id: keyword.id,
      source_table_id: tableId,
      name: metric.name,
      description: metric.description,
      formula: metric.formula,
      aggregation: metric.aggregation,
      value_column: metric.value_column,
      date_column: 'business_date',
      dimensions: ['employee_name', 'department', 'role', 'status'],
      filters: metric.filters,
      time_grain: 'day',
      caveats: 'Realistic demo records for product testing; replace with verified business records before operational use.',
    });
    if (error) throw error;
  }

  console.log(`Seeded ${organization.name}: ${rowCount ?? rows.length} editable work-time rows, ${columns.length} columns, ${metricDefinitions.length} metrics, linked to "${keyword.title}".`);
  console.log('Existing rows were preserved. Open the linked keyword or select this dataset in Data Hub to edit cells.');
  await verifyMetrics(db, organization.id, metricDefinitions.map((metric) => metric.name));
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (hasFlag('list')) {
    await listOrganizations(db);
    return;
  }
  if (hasFlag('verify-all')) {
    await verifyAllMetrics(db, arg('org') ?? 'demo-restaurant');
    return;
  }
  await seed(db, arg('org') ?? 'demo-restaurant');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
