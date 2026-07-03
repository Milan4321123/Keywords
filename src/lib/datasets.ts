import * as XLSX from 'xlsx';

export type InferredColumnType = 'text' | 'number' | 'date' | 'boolean' | 'json';

export interface ParsedDatasetTable {
  name: string;
  columns: Array<{
    name: string;
    normalized_name: string;
    data_type: InferredColumnType;
    sample_values: string[];
    semantic_name: string | null;
  }>;
  rows: Array<{
    row_index: number;
    data: Record<string, unknown>;
    source_json: Record<string, unknown>;
  }>;
  meta_json: Record<string, unknown>;
}

function normalizeHeader(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  const base = raw || fallback;
  return base
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || fallback;
}

function isLikelyBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === 'false' || v === 'yes' || v === 'no' || v === 'y' || v === 'n';
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === 'y') return true;
  if (v === 'false' || v === 'no' || v === 'n') return false;
  return null;
}

function parseEuropeanNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/[0-9]/.test(trimmed)) return null;
  const normalized = trimmed
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const direct = Number(v);
  if (Number.isFinite(direct)) return direct;
  return parseEuropeanNumber(v);
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d && d.y && d.m && d.d) {
      const iso = new Date(Date.UTC(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0, d.S ?? 0));
      if (!Number.isNaN(iso.getTime())) return iso.toISOString();
    }
  }
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const iso = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }
  return null;
}

function coerceCellValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const boolVal = parseBoolean(trimmed);
  if (boolVal !== null) return boolVal;

  const asNumber = parseNumber(trimmed);
  if (asNumber !== null) return asNumber;

  const asDate = parseDate(trimmed);
  if (asDate !== null) return asDate;

  return trimmed;
}

/**
 * Heuristic semantic mapping: guess the business meaning of a column from its
 * name and type. Users can refine via PATCH /api/datasets/columns; the AI
 * router uses semantic names to pick the right columns for metrics.
 */
export function guessSemanticName(
  normalizedName: string,
  dataType: InferredColumnType
): string | null {
  const n = normalizedName;

  if (/(^|_)(amount|betrag|price|preis|total|cost|kosten|revenue|umsatz|sum|value|wert)($|_)/.test(n) && dataType === 'number') {
    return 'amount';
  }
  if (/(^|_)(qty|quantity|menge|count|anzahl|units)($|_)/.test(n) && dataType === 'number') {
    return 'quantity';
  }
  if (dataType === 'date' || /(^|_)(date|datum|_at|day)($|_)/.test(n)) return 'date';
  if (/(^|_)(month|monat|period|quarter|year|jahr)($|_)/.test(n)) return 'period';
  if (/(^|_)(status|state|zustand)($|_)/.test(n)) return 'status';
  if (/(_id|_nr|_no|_number)$|^(id|nr|no)$|(^|_)(invoice_number|order_number|rechnungsnummer)($|_)/.test(n)) {
    return 'identifier';
  }
  if (/(^|_)(currency|währung|waehrung)($|_)/.test(n)) return 'currency';
  if (/(^|_)(email|e_mail)($|_)/.test(n)) return 'email';
  if (/(^|_)(customer|kunde|client|supplier|lieferant|vendor|employee|mitarbeiter|project|projekt|product|produkt|name|title)($|_)/.test(n)) {
    return 'entity';
  }
  if (/(^|_)(category|kategorie|type|typ|trade|gewerk|department|abteilung|group)($|_)/.test(n)) {
    return 'dimension';
  }
  return null;
}

function inferColumnType(values: unknown[]): InferredColumnType {
  const nonNull = values.filter((v) => v != null && String(v).trim() !== '');
  if (nonNull.length === 0) return 'text';

  const boolCount = nonNull.filter(isLikelyBoolean).length;
  if (boolCount / nonNull.length > 0.9) return 'boolean';

  const numCount = nonNull.filter((v) => parseNumber(v) !== null).length;
  if (numCount / nonNull.length > 0.9) return 'number';

  const dateCount = nonNull.filter((v) => parseDate(v) !== null).length;
  if (dateCount / nonNull.length > 0.9) return 'date';

  const jsonCount = nonNull.filter((v) => {
    if (typeof v !== 'string') return false;
    const t = v.trim();
    if (!t) return false;
    if (!(t.startsWith('{') || t.startsWith('['))) return false;
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  }).length;
  if (jsonCount / nonNull.length > 0.9) return 'json';

  return 'text';
}

export function parseWorkbookToDatasetTables(params: {
  fileBuffer: ArrayBuffer;
  fileName: string;
  assetId?: string;
  maxRowsPerSheet?: number;
}): ParsedDatasetTable[] {
  const workbook = XLSX.read(params.fileBuffer, { type: 'array', cellDates: true });
  const maxRowsPerSheet = params.maxRowsPerSheet ?? 50_000;
  const tables: ParsedDatasetTable[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
    const firstDataRowIndex = grid.findIndex((row) => Array.isArray(row) && row.some((c) => String(c ?? '').trim() !== ''));
    if (firstDataRowIndex === -1) continue;

    const headerRow = grid[firstDataRowIndex] || [];
    const headerCount = Math.max(1, headerRow.length);
    const normalizedHeaders: string[] = [];
    const displayHeaders: string[] = [];
    const used = new Set<string>();
    for (let i = 0; i < headerCount; i++) {
      const display = String(headerRow[i] ?? '').trim() || `Column ${i + 1}`;
      const base = normalizeHeader(display, `col_${i + 1}`);
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate)) {
        candidate = `${base}_${suffix++}`;
      }
      used.add(candidate);
      normalizedHeaders.push(candidate);
      displayHeaders.push(display);
    }

    const bodyRows = grid.slice(firstDataRowIndex + 1).slice(0, maxRowsPerSheet);
    const columnSamples: Record<string, unknown[]> = Object.fromEntries(normalizedHeaders.map((h) => [h, []]));
    const rows: ParsedDatasetTable['rows'] = [];

    for (let r = 0; r < bodyRows.length; r++) {
      const row = bodyRows[r] || [];
      const data: Record<string, unknown> = {};
      for (let c = 0; c < normalizedHeaders.length; c++) {
        const key = normalizedHeaders[c];
        const rawValue = (row as unknown[])[c];
        const coerced = coerceCellValue(rawValue);
        data[key] = coerced;
        if (columnSamples[key].length < 50) columnSamples[key].push(rawValue);
      }

      rows.push({
        row_index: r + 1,
        data,
        source_json: {
          asset_id: params.assetId ?? null,
          file_name: params.fileName,
          sheet_name: sheetName,
          excel_row_number: firstDataRowIndex + 2 + r,
        },
      });
    }

    const columns = normalizedHeaders.map((normalized, idx) => {
      const samples = columnSamples[normalized] ?? [];
      const dataType = inferColumnType(samples);
      const sampleValues = samples
        .map((v) => (v == null ? '' : String(v)))
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);
      return {
        name: displayHeaders[idx] ?? normalized,
        normalized_name: normalized,
        data_type: dataType,
        sample_values: sampleValues,
        semantic_name: guessSemanticName(normalized, dataType),
      };
    });

    tables.push({
      name: sheetName,
      columns,
      rows,
      meta_json: {
        sheet_name: sheetName,
        header_row_index: firstDataRowIndex + 1,
        truncated: grid.length - (firstDataRowIndex + 1) > maxRowsPerSheet,
      },
    });
  }

  return tables;
}

