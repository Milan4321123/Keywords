import { SupabaseClient } from '@supabase/supabase-js';
import { CaptureField, CaptureFieldAuto, CaptureFormDef } from './capture-types';

const OPTION_MIN = 2;
const OPTION_MAX = 12;
const OPTION_SCAN_ROWS = 300;

/** Semantics that identify the record's business date / timestamp. */
const DATE_AUTO: Record<string, CaptureFieldAuto> = {
  business_date: 'today',
  event_timestamp: 'now',
  measurement_timestamp: 'now',
  verification_timestamp: null, // filled later by a manager, not at capture time
};

function autoFor(semantic: string | null, dataType: string): CaptureFieldAuto {
  if (!semantic) return null;
  if (semantic in DATE_AUTO) return DATE_AUTO[semantic];
  if (semantic === 'weekday') return 'weekday';
  if (semantic === 'employee_id') return 'user';
  if (semantic === 'evidence_reference') return 'evidence';
  if (dataType === 'date' && /timestamp/.test(semantic)) return 'now';
  return null;
}

interface ColumnRow {
  name: string;
  normalized_name: string;
  data_type: 'text' | 'number' | 'date' | 'boolean' | 'json';
  semantic_name: string | null;
  description: string | null;
  is_required: boolean;
  validation_rules: Record<string, any> | null;
}

/**
 * Derive capture forms for a keyword from its linked datasets.
 * The dataset's column definitions ARE the form schema: semantic names decide
 * auto-fill, validation_rules decide bounds, and existing row values provide
 * dropdown options for enum-like text columns.
 */
export async function getCaptureFormsForKeyword(
  supabase: SupabaseClient,
  organizationId: string,
  keywordId: string
): Promise<CaptureFormDef[]> {
  const { data: datasets } = await supabase
    .from('datasets')
    .select('id, title, keyword_id, tables:dataset_tables(id, name, row_count, columns:dataset_columns(*))')
    .eq('organization_id', organizationId)
    .eq('keyword_id', keywordId)
    .limit(4);

  const forms: CaptureFormDef[] = [];

  for (const dataset of (datasets ?? []) as any[]) {
    for (const table of dataset.tables ?? []) {
      const columns: ColumnRow[] = table.columns ?? [];
      if (columns.length === 0) continue;

      // Harvest distinct values from recent rows → dropdowns for enum-ish text columns
      const { data: recentRows } = await supabase
        .from('dataset_rows')
        .select('data')
        .eq('dataset_table_id', table.id)
        .order('row_index', { ascending: false })
        .limit(OPTION_SCAN_ROWS);

      const distinct = new Map<string, Set<string>>();
      for (const row of recentRows ?? []) {
        for (const col of columns) {
          if (col.data_type !== 'text') continue;
          const value = (row.data as Record<string, unknown>)[col.normalized_name];
          if (value == null || String(value).trim() === '') continue;
          if (!distinct.has(col.normalized_name)) distinct.set(col.normalized_name, new Set());
          const set = distinct.get(col.normalized_name)!;
          if (set.size <= OPTION_MAX) set.add(String(value).trim());
        }
      }

      const fields: CaptureField[] = columns.map((col) => {
        const rules = col.validation_rules ?? {};
        const values = distinct.get(col.normalized_name);
        const options =
          col.data_type === 'text' && values && values.size >= OPTION_MIN && values.size <= OPTION_MAX
            ? Array.from(values).sort()
            : null;
        return {
          field: col.normalized_name,
          label: col.name,
          data_type: col.data_type,
          semantic: col.semantic_name ?? null,
          required: Boolean(col.is_required),
          description: col.description ?? null,
          options,
          min: typeof rules.min === 'number' ? rules.min : null,
          max: typeof rules.max === 'number' ? rules.max : null,
          auto: autoFor(col.semantic_name ?? null, col.data_type),
        };
      });

      forms.push({
        dataset_table_id: table.id,
        table_name: table.name,
        dataset_title: dataset.title,
        keyword_id: dataset.keyword_id,
        row_count: table.row_count ?? 0,
        fields,
      });
    }
  }

  return forms;
}

export interface CoercionResult {
  ok: boolean;
  errors: string[];
  data: Record<string, unknown>;
}

/**
 * Validate a submission against the column definitions and coerce values to
 * the column types. Server-side autos (user, weekday, evidence) are applied
 * here so clients cannot spoof them.
 */
export function validateAndCoerce(
  fields: CaptureField[],
  values: Record<string, unknown>,
  context: { userEmail: string; evidenceReference: string | null }
): CoercionResult {
  const errors: string[] = [];
  const data: Record<string, unknown> = {};

  // First pass: everything except server-computed autos
  for (const field of fields) {
    if (field.auto === 'user') {
      data[field.field] = context.userEmail;
      continue;
    }
    if (field.auto === 'evidence') {
      data[field.field] = context.evidenceReference;
      continue;
    }
    if (field.auto === 'weekday') {
      data[field.field] = null; // second pass, needs the date
      continue;
    }

    const raw = values[field.field];
    const empty = raw == null || String(raw).trim() === '';

    if (empty) {
      if (field.required && field.auto == null) {
        errors.push(`"${field.label}" fehlt · is required`);
      }
      data[field.field] = null;
      continue;
    }

    switch (field.data_type) {
      case 'number': {
        const num =
          typeof raw === 'number'
            ? raw
            : Number(String(raw).trim().replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(num)) {
          errors.push(`"${field.label}" ist keine Zahl · not a number`);
          data[field.field] = null;
          break;
        }
        if (field.min != null && num < field.min) {
          errors.push(`"${field.label}" muss ≥ ${field.min} sein`);
        }
        if (field.max != null && num > field.max) {
          errors.push(`"${field.label}" muss ≤ ${field.max} sein`);
        }
        data[field.field] = num;
        break;
      }
      case 'date': {
        const date = new Date(String(raw));
        if (Number.isNaN(date.getTime())) {
          errors.push(`"${field.label}" ist kein gültiges Datum · invalid date`);
          data[field.field] = null;
          break;
        }
        // Pure dates stay YYYY-MM-DD; timestamps keep full ISO
        const rawStr = String(raw);
        data[field.field] = /^\d{4}-\d{2}-\d{2}$/.test(rawStr) ? rawStr : date.toISOString();
        break;
      }
      case 'boolean':
        data[field.field] = raw === true || raw === 'true' || raw === 'yes' || raw === '1';
        break;
      default:
        data[field.field] = String(raw).slice(0, 2000);
    }
  }

  // Second pass: weekday derived from the business date
  for (const field of fields) {
    if (field.auto !== 'weekday') continue;
    const dateField = fields.find((f) => f.semantic === 'business_date') ?? fields.find((f) => f.data_type === 'date');
    const dateValue = dateField ? data[dateField.field] : null;
    if (typeof dateValue === 'string') {
      const date = new Date(dateValue);
      if (!Number.isNaN(date.getTime())) {
        data[field.field] = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      }
    }
  }

  return { ok: errors.length === 0, errors, data };
}
