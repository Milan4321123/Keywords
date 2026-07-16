/**
 * Company Brain MCP server — the zero-API-cost connector.
 *
 * Lets your Claude subscription (Claude Desktop / Claude Code) work on the
 * live organization data itself: search keywords, read skill cards and
 * datasets, and create/update keywords — paid by your flat subscription,
 * not by API tokens.
 *
 * Add to Claude Desktop (claude_desktop_config.json) or Claude Code
 * (`claude mcp add company-brain -- npx tsx scripts/mcp-server.ts`):
 *
 *   {
 *     "mcpServers": {
 *       "company-brain": {
 *         "command": "npx",
 *         "args": ["tsx", "/path/to/keywords/scripts/mcp-server.ts"],
 *         "env": { "COMPANY_BRAIN_ORG": "demo-bau" }
 *       }
 *     }
 *   }
 *
 * COMPANY_BRAIN_ORG selects the organization by slug (default: oldest org).
 * Credentials come from the project's .env (service role key — local only).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { compileKeywordSkill, Ontology } from '../src/lib/ai/skills';
import { computeCompleteness } from '../src/lib/ontology/completeness';
import { Keyword, KeywordRelation } from '../src/types';

function loadEnv() {
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

let supabase: SupabaseClient;
let ORG: { id: string; name: string; slug: string };

async function loadOntology(): Promise<Ontology> {
  const [{ data: keywords }, { data: relations }] = await Promise.all([
    supabase.from('keywords').select('*').eq('organization_id', ORG.id).neq('status', 'archived').order('sort_order').order('title'),
    supabase
      .from('keyword_relations')
      .select('*, from_keyword:keywords!keyword_relations_from_keyword_id_fkey(id, title), to_keyword:keywords!keyword_relations_to_keyword_id_fkey(id, title)')
      .eq('organization_id', ORG.id),
  ]);
  return { keywords: (keywords ?? []) as Keyword[], relations: (relations ?? []) as KeywordRelation[] };
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }
  if (!(globalThis as any).WebSocket) (globalThis as any).WebSocket = class {} as any;
  supabase = createClient(url, key);

  const slug = process.env.COMPANY_BRAIN_ORG;
  let orgQuery = supabase.from('organizations').select('id, name, slug').order('created_at').limit(1);
  if (slug) orgQuery = supabase.from('organizations').select('id, name, slug').eq('slug', slug).limit(1);
  const { data: orgs } = await orgQuery;
  if (!orgs?.length) {
    console.error(`Organization ${slug ?? '(first)'} not found`);
    process.exit(1);
  }
  ORG = orgs[0];

  const server = new McpServer({ name: `company-brain-${ORG.slug}`, version: '1.0.0' });

  server.tool(
    'list_keywords',
    `Index of all keywords of ${ORG.name} (one line each, hierarchical). Read this first, then load details with get_keyword.`,
    {},
    async () => {
      const { keywords } = await loadOntology();
      const byParent = new Map<string | null, Keyword[]>();
      for (const k of keywords) {
        const p = k.parent_id ?? null;
        byParent.set(p, [...(byParent.get(p) ?? []), k]);
      }
      const lines: string[] = [];
      const walk = (parentId: string | null, depth: number) => {
        for (const k of byParent.get(parentId) ?? []) {
          lines.push(`${'  '.repeat(depth)}- ${k.slug}: ${k.title} — ${k.definition?.split('.')[0] ?? '(no definition yet)'}`);
          walk(k.id, depth + 1);
        }
      };
      walk(null, 0);
      return text(lines.join('\n') || '(no keywords yet)');
    }
  );

  server.tool(
    'get_keyword',
    'Full skill card of one keyword: definition, explanation, rules, examples, relations, sub-concepts. Identify by slug or title.',
    { keyword: z.string().describe('slug or title') },
    async ({ keyword }) => {
      const ontology = await loadOntology();
      const q = keyword.toLowerCase();
      const found =
        ontology.keywords.find((k) => k.slug === q || k.title.toLowerCase() === q) ??
        ontology.keywords.find((k) => k.title.toLowerCase().includes(q) || k.synonyms?.some((s) => s.toLowerCase() === q));
      if (!found) return text(`No keyword found for "${keyword}". Use list_keywords to see available slugs.`);
      return text(compileKeywordSkill(found, ontology).markdown);
    }
  );

  server.tool(
    'search_keywords',
    'Search keywords by word (title, synonyms, definition, rules). Returns matching slugs with context.',
    { query: z.string() },
    async ({ query }) => {
      const { keywords } = await loadOntology();
      const q = query.toLowerCase();
      const hits = keywords.filter(
        (k) =>
          k.title.toLowerCase().includes(q) ||
          k.definition?.toLowerCase().includes(q) ||
          k.synonyms?.some((s) => s.toLowerCase().includes(q)) ||
          k.rules?.some((r) => r.toLowerCase().includes(q))
      );
      return text(
        hits.slice(0, 20).map((k) => `- ${k.slug}: ${k.title} — ${k.definition ?? '(no definition)'}`).join('\n') ||
          `No matches for "${query}".`
      );
    }
  );

  server.tool(
    'get_world_model',
    'The compiled world model of the organization (what the company is and how it works). Load once per conversation.',
    {},
    async () => {
      const { data } = await supabase
        .from('ai_skills')
        .select('prompt_template')
        .eq('organization_id', ORG.id)
        .eq('name', '__world_model__')
        .maybeSingle();
      return text(data?.prompt_template ?? '(world model not compiled yet — use list_keywords instead)');
    }
  );

  server.tool(
    'list_datasets',
    'All structured datasets (tables) with columns and row counts.',
    {},
    async () => {
      const { data } = await supabase
        .from('datasets')
        .select('title, description, tables:dataset_tables(id, name, row_count, columns:dataset_columns(normalized_name, data_type))')
        .eq('organization_id', ORG.id);
      const lines: string[] = [];
      for (const d of (data ?? []) as any[]) {
        for (const t of d.tables ?? []) {
          lines.push(
            `- table_id ${t.id}: "${t.name}" (${d.title}), ${t.row_count} rows. Columns: ${(t.columns ?? [])
              .map((c: any) => `${c.normalized_name}:${c.data_type}`)
              .join(', ')}`
          );
        }
      }
      return text(lines.join('\n') || '(no datasets)');
    }
  );

  server.tool(
    'get_dataset_rows',
    'Rows of a dataset table as CSV (compute numbers from this — never estimate).',
    {
      table_id: z.string().describe('id from list_datasets'),
      limit: z.number().int().min(1).max(2000).default(500),
      offset: z.number().int().min(0).default(0),
    },
    async ({ table_id, limit, offset }) => {
      const { data: cols } = await supabase
        .from('dataset_columns')
        .select('normalized_name')
        .eq('dataset_table_id', table_id);
      const columns = (cols ?? []).map((c) => c.normalized_name);
      if (!columns.length) return text('Table not found or has no columns.');
      const { data: rows } = await supabase
        .from('dataset_rows')
        .select('data')
        .eq('dataset_table_id', table_id)
        .order('row_index')
        .range(offset, offset + limit - 1);
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [columns.join(','), ...(rows ?? []).map((r: any) => columns.map((c) => esc(r.data?.[c])).join(','))];
      return text(csv.join('\n'));
    }
  );

  server.tool(
    'create_keyword',
    `Create a new keyword in ${ORG.name}. Only title is required; parent by slug.`,
    {
      title: z.string().min(1).max(200),
      parent: z.string().optional().describe('parent keyword slug'),
      definition: z.string().max(2000).optional(),
      explanation: z.string().max(10000).optional(),
      examples: z.array(z.string().max(500)).max(50).optional(),
      synonyms: z.array(z.string().max(500)).max(50).optional(),
      rules: z.array(z.string().max(500)).max(50).optional(),
    },
    async ({ title, parent, ...fields }) => {
      let parentId: string | null = null;
      if (parent) {
        const { data: p } = await supabase
          .from('keywords')
          .select('id')
          .eq('organization_id', ORG.id)
          .eq('slug', parent)
          .maybeSingle();
        if (!p) return text(`Parent slug "${parent}" not found. Use list_keywords.`);
        parentId = p.id;
      }
      const kwSlug = title.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/(^-|-$)/g, '') || `kw-${Date.now()}`;
      const { score } = computeCompleteness(fields);
      const { data, error } = await supabase
        .from('keywords')
        .insert({
          organization_id: ORG.id,
          title,
          slug: kwSlug,
          parent_id: parentId,
          keyword_type: 'concept',
          status: 'active',
          access_level: 'worker',
          definition: fields.definition ?? null,
          explanation: fields.explanation ?? null,
          examples: fields.examples ?? [],
          synonyms: fields.synonyms ?? [],
          rules: fields.rules ?? [],
          labels_json: {},
          completeness_score: score,
        })
        .select('slug, title')
        .single();
      if (error) return text(`Create failed: ${error.message}`);
      return text(`Created keyword "${data.title}" (slug ${data.slug}).`);
    }
  );

  server.tool(
    'update_keyword',
    'Update fields of an existing keyword (by slug). Only provided fields change.',
    {
      slug: z.string(),
      definition: z.string().max(2000).optional(),
      explanation: z.string().max(10000).optional(),
      examples: z.array(z.string().max(500)).max(50).optional(),
      synonyms: z.array(z.string().max(500)).max(50).optional(),
      rules: z.array(z.string().max(500)).max(50).optional(),
    },
    async ({ slug: kwSlug, ...fields }) => {
      const updates = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      if (!Object.keys(updates).length) return text('Nothing to update — provide at least one field.');
      const { data, error } = await supabase
        .from('keywords')
        .update(updates)
        .eq('organization_id', ORG.id)
        .eq('slug', kwSlug)
        .select('title')
        .maybeSingle();
      if (error) return text(`Update failed: ${error.message}`);
      if (!data) return text(`Keyword slug "${kwSlug}" not found.`);
      return text(`Updated "${data.title}" (${Object.keys(updates).join(', ')}).`);
    }
  );

  await server.connect(new StdioServerTransport());
  console.error(`company-brain MCP server ready — org "${ORG.name}" (${ORG.slug})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
