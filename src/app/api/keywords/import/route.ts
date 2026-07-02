import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext, audit } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { computeCompleteness } from '@/lib/ontology/completeness';

const ARRAY_SPLIT = /\s*\|\s*/;
const KEYWORD_TYPES = [
  'concept', 'process', 'metric', 'dataset', 'document_type', 'role',
  'task_type', 'workflow_step', 'department', 'entity', 'kpi',
  'report_type', 'risk', 'rule', 'skill',
];
const KEYWORD_STATUSES = ['draft', 'active', 'archived'];

interface ImportKeyword {
  title: string;
  slug?: string;
  parent_slug?: string;
  keyword_type?: string;
  status?: string;
  definition?: string;
  explanation?: string;
  examples?: string[] | string;
  synonyms?: string[] | string;
  rules?: string[] | string;
  labels_json?: Record<string, string>;
}

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function toArray(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v) => v && v.trim());
  if (typeof value === 'string' && value.trim()) return value.split(ARRAY_SPLIT).filter(Boolean);
  return [];
}

/** Minimal CSV parser handling quoted fields and escaped quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

function csvToKeywords(csvText: string): ImportKeyword[] {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, i) => {
      record[key] = cells[i] ?? '';
    });
    return {
      title: record.title,
      slug: record.slug,
      parent_slug: record.parent_slug,
      keyword_type: record.keyword_type,
      status: record.status,
      definition: record.definition,
      explanation: record.explanation,
      examples: record.examples,
      synonyms: record.synonyms,
      rules: record.rules,
    };
  });
}

// POST /api/keywords/import - Import keywords from JSON or CSV (upsert by slug)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgContext('edit_keywords');
    const body = await req.json();

    let items: ImportKeyword[] = [];
    if (Array.isArray(body.keywords)) {
      items = body.keywords;
    } else if (typeof body.csv === 'string') {
      items = csvToKeywords(body.csv);
    }

    items = items.filter((k) => k && typeof k.title === 'string' && k.title.trim());
    if (items.length === 0) {
      return NextResponse.json(
        { data: null, error: 'No importable keywords found. Provide { keywords: [...] } or { csv: "..." }.' },
        { status: 400 }
      );
    }
    if (items.length > 2000) {
      return NextResponse.json({ data: null, error: 'Import limited to 2000 keywords per request' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await ctx.supabase
      .from('keywords')
      .select('id, slug')
      .eq('organization_id', ctx.org.id);
    if (existingError) throw existingError;

    const idBySlug = new Map((existing ?? []).map((k) => [k.slug, k.id] as const));
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    // Pass 1: upsert keywords without parent links
    for (const item of items) {
      const slug = slugify(item.slug || item.title) || `keyword-${Date.now()}-${created}`;
      const examples = toArray(item.examples);
      const synonyms = toArray(item.synonyms);
      const rules = toArray(item.rules);
      const { score } = computeCompleteness({
        definition: item.definition,
        explanation: item.explanation,
        examples,
        synonyms,
        rules,
      });

      const fields = {
        title: item.title.trim(),
        keyword_type: KEYWORD_TYPES.includes(item.keyword_type ?? '') ? item.keyword_type : 'concept',
        status: KEYWORD_STATUSES.includes(item.status ?? '') ? item.status : 'active',
        definition: item.definition?.trim() || null,
        explanation: item.explanation?.trim() || null,
        examples,
        synonyms,
        rules,
        labels_json: item.labels_json ?? {},
        completeness_score: score,
      };

      const existingId = idBySlug.get(slug);
      if (existingId) {
        const { error } = await ctx.supabase
          .from('keywords')
          .update(fields)
          .eq('id', existingId)
          .eq('organization_id', ctx.org.id);
        if (error) errors.push(`${slug}: ${error.message}`);
        else updated++;
      } else {
        const { data: inserted, error } = await ctx.supabase
          .from('keywords')
          .insert({ ...fields, slug, organization_id: ctx.org.id, created_by: ctx.user.id })
          .select('id, slug')
          .single();
        if (error) {
          errors.push(`${slug}: ${error.message}`);
        } else {
          idBySlug.set(inserted.slug, inserted.id);
          created++;
        }
      }
    }

    // Pass 2: resolve parent links by slug
    let linked = 0;
    for (const item of items) {
      const slug = slugify(item.slug || item.title);
      const parentSlug = item.parent_slug ? slugify(item.parent_slug) : '';
      if (!parentSlug) continue;
      const childId = idBySlug.get(slug);
      const parentId = idBySlug.get(parentSlug);
      if (!childId || !parentId || childId === parentId) {
        if (!parentId) errors.push(`${slug}: parent "${parentSlug}" not found`);
        continue;
      }
      const { error } = await ctx.supabase
        .from('keywords')
        .update({ parent_id: parentId })
        .eq('id', childId)
        .eq('organization_id', ctx.org.id);
      if (!error) linked++;
    }

    await audit(ctx, 'keyword.import', { type: 'keyword' }, {
      created,
      updated,
      linked,
      errors: errors.length,
    });

    return NextResponse.json({
      data: { created, updated, linked, errors: errors.slice(0, 20) },
      error: null,
    });
  } catch (error) {
    return apiError(error, 'Failed to import keywords');
  }
}
