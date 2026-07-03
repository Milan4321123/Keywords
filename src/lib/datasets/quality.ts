export interface QualityColumn {
  name: string;
  normalized_name: string;
  data_type: 'text' | 'number' | 'date' | 'boolean' | 'json';
  semantic_name?: string | null;
  is_required?: boolean;
}

export interface QualityRow {
  id: string;
  row_index: number;
  data: Record<string, unknown>;
}

export interface QualityIssue {
  issue_type:
    | 'missing_values'
    | 'type_violation'
    | 'duplicate_rows'
    | 'duplicate_identifier'
    | 'negative_amount'
    | 'inconsistent_status';
  severity: 'info' | 'warning' | 'error';
  column: string | null;
  description: string;
  affected_count: number;
  sample_row_ids: string[];
}

function isNumberLike(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (Number.isFinite(Number(v))) return true;
  return Number.isFinite(Number(v.replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.')));
}

function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return true;
  if (typeof value !== 'string') return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Data quality checks for one dataset table. Pure function over rows in
 * memory; results are persisted to data_quality_issues by the API route.
 */
export function validateTable(columns: QualityColumn[], rows: QualityRow[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (rows.length === 0) return issues;

  const sample = (ids: string[]) => ids.slice(0, 10);

  for (const column of columns) {
    const field = column.normalized_name;
    const missingIds: string[] = [];
    const violationIds: string[] = [];
    const negativeIds: string[] = [];
    const statusVariants = new Map<string, Map<string, string[]>>(); // canonical -> variant -> row ids

    for (const row of rows) {
      const value = row.data[field];

      if (value == null || String(value).trim() === '') {
        missingIds.push(row.id);
        continue;
      }

      if (column.data_type === 'number' && !isNumberLike(value)) violationIds.push(row.id);
      if (column.data_type === 'date' && !isDateLike(value)) violationIds.push(row.id);

      if (column.semantic_name === 'amount' && typeof value === 'number' && value < 0) {
        negativeIds.push(row.id);
      }

      if (column.semantic_name === 'status' || /(^|_)status($|_)/.test(field)) {
        const raw = String(value).trim();
        const canonical = raw.toLowerCase();
        if (!statusVariants.has(canonical)) statusVariants.set(canonical, new Map());
        const variants = statusVariants.get(canonical)!;
        if (!variants.has(raw)) variants.set(raw, []);
        variants.get(raw)!.push(row.id);
      }
    }

    if (missingIds.length > 0) {
      const ratio = missingIds.length / rows.length;
      issues.push({
        issue_type: 'missing_values',
        severity: column.is_required ? 'error' : ratio > 0.2 ? 'warning' : 'info',
        column: field,
        description: `${missingIds.length} of ${rows.length} rows have no value for "${column.name}"${column.is_required ? ' (required column)' : ''}`,
        affected_count: missingIds.length,
        sample_row_ids: sample(missingIds),
      });
    }

    if (violationIds.length > 0) {
      issues.push({
        issue_type: 'type_violation',
        severity: 'warning',
        column: field,
        description: `${violationIds.length} rows have values in "${column.name}" that are not valid ${column.data_type}s`,
        affected_count: violationIds.length,
        sample_row_ids: sample(violationIds),
      });
    }

    if (negativeIds.length > 0) {
      issues.push({
        issue_type: 'negative_amount',
        severity: 'warning',
        column: field,
        description: `${negativeIds.length} rows have negative values in amount column "${column.name}"`,
        affected_count: negativeIds.length,
        sample_row_ids: sample(negativeIds),
      });
    }

    for (const [canonical, variants] of statusVariants) {
      if (variants.size > 1) {
        const allIds = Array.from(variants.values()).flat();
        issues.push({
          issue_type: 'inconsistent_status',
          severity: 'warning',
          column: field,
          description: `Status value "${canonical}" appears with inconsistent spellings: ${Array.from(variants.keys()).join(', ')}`,
          affected_count: allIds.length,
          sample_row_ids: sample(allIds),
        });
      }
    }
  }

  // Full-row duplicates
  const rowHash = new Map<string, string[]>();
  for (const row of rows) {
    const hash = JSON.stringify(row.data);
    if (!rowHash.has(hash)) rowHash.set(hash, []);
    rowHash.get(hash)!.push(row.id);
  }
  const duplicateGroups = Array.from(rowHash.values()).filter((ids) => ids.length > 1);
  if (duplicateGroups.length > 0) {
    const affected = duplicateGroups.reduce((sum, ids) => sum + ids.length - 1, 0);
    issues.push({
      issue_type: 'duplicate_rows',
      severity: 'warning',
      column: null,
      description: `${duplicateGroups.length} groups of fully identical rows (${affected} redundant rows)`,
      affected_count: affected,
      sample_row_ids: sample(duplicateGroups.flat()),
    });
  }

  // Duplicate identifiers (invoice numbers etc.)
  for (const column of columns) {
    if (column.semantic_name !== 'identifier') continue;
    const field = column.normalized_name;
    const seen = new Map<string, string[]>();
    for (const row of rows) {
      const value = row.data[field];
      if (value == null || String(value).trim() === '') continue;
      const key = String(value).trim();
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(row.id);
    }
    const dupes = Array.from(seen.entries()).filter(([, ids]) => ids.length > 1);
    if (dupes.length > 0) {
      issues.push({
        issue_type: 'duplicate_identifier',
        severity: 'error',
        column: field,
        description: `${dupes.length} values in identifier column "${column.name}" occur more than once (e.g. ${dupes.slice(0, 3).map(([v]) => v).join(', ')})`,
        affected_count: dupes.reduce((sum, [, ids]) => sum + ids.length, 0),
        sample_row_ids: sample(dupes.flatMap(([, ids]) => ids)),
      });
    }
  }

  const severityRank = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
