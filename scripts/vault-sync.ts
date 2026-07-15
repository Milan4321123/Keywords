/**
 * Vault sync — the file connector for LLMs.
 *
 * Compiles the ontology (keywords, relations, rules, uploaded files) into an
 * Obsidian-style markdown vault that Claude Code or any agent can be pointed
 * at directly:
 *
 *   npm run vault                        # writes ./vault
 *   npm run vault -- --out ~/CompanyVault
 *   npm run vault -- --org my-org-slug
 *
 * Then: `cd <vault>` and start Claude Code there — CLAUDE.md tells the agent
 * how to navigate token-efficiently — or open the folder in Obsidian.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import {
  compileVault,
  compileInsightSeeds,
  tableCsvPath,
  VaultDataset,
  VaultMetric,
  VaultTask,
} from '../src/lib/vault/compile';
import { Keyword, KeywordRelation, Asset } from '../src/types';

const MAX_CSV_ROWS = 50_000;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function loadEnv() {
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function safeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }
  // supabase-js insists on a WebSocket constructor for its (unused) realtime client
  if (!(globalThis as any).WebSocket) {
    (globalThis as any).WebSocket = class {} as any;
  }
  const supabase = createClient(url, key);

  // Pick the organization
  let orgQuery = supabase.from('organizations').select('id, name, slug').order('created_at').limit(1);
  const orgSlug = arg('org');
  if (orgSlug) orgQuery = supabase.from('organizations').select('id, name, slug').eq('slug', orgSlug).limit(1);
  const { data: orgs, error: orgError } = await orgQuery;
  if (orgError || !orgs?.length) {
    console.error('Organization not found.', orgError?.message ?? '');
    process.exit(1);
  }
  const org = orgs[0];

  const [
    { data: keywords },
    { data: relations },
    { data: links },
    { data: worldModelRow },
    { data: datasetRows },
    { data: metricRows },
    { data: taskRows },
  ] = await Promise.all([
    supabase
      .from('keywords')
      .select('*')
      .eq('organization_id', org.id)
      .neq('status', 'archived')
      .order('sort_order')
      .order('title'),
    supabase.from('keyword_relations').select('*').eq('organization_id', org.id),
    supabase.from('keyword_assets').select('keyword_id, asset:assets(*)'),
    supabase
      .from('ai_skills')
      .select('prompt_template')
      .eq('organization_id', org.id)
      .eq('name', '__world_model__')
      .maybeSingle(),
    supabase
      .from('datasets')
      .select('id, title, description, keyword_id, tables:dataset_tables(id, name, row_count, columns:dataset_columns(name, normalized_name, data_type))')
      .eq('organization_id', org.id),
    supabase
      .from('metrics')
      .select('name, description, formula, aggregation, value_column, date_column, time_grain, caveats, keyword_id')
      .eq('organization_id', org.id),
    supabase
      .from('tasks')
      .select('title, status, priority, due_date, keyword_id')
      .eq('organization_id', org.id)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const datasets: VaultDataset[] = ((datasetRows ?? []) as any[]).map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    keyword_id: d.keyword_id,
    tables: (d.tables ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      row_count: t.row_count ?? 0,
      columns: t.columns ?? [],
    })),
  }));

  const kws = (keywords ?? []) as Keyword[];
  const keywordIds = new Set(kws.map((k) => k.id));
  const assetsByKeyword = new Map<string, Asset[]>();
  for (const row of (links ?? []) as any[]) {
    if (!row.asset || !keywordIds.has(row.keyword_id)) continue;
    assetsByKeyword.set(row.keyword_id, [...(assetsByKeyword.get(row.keyword_id) ?? []), row.asset as Asset]);
  }

  const files = compileVault({
    orgName: org.name,
    keywords: kws,
    relations: (relations ?? []) as KeywordRelation[],
    assetsByKeyword,
    worldModelMarkdown: worldModelRow?.prompt_template ?? null,
    datasets,
    metrics: (metricRows ?? []) as VaultMetric[],
    tasks: (taskRows ?? []) as VaultTask[],
  });

  const out = resolve(process.cwd(), arg('out') ?? './vault');
  // Only wipe what we own — INSIGHTS/ (loop memory) and anything else stays.
  for (const owned of ['keywords', 'assets', 'data', '.claude', 'INDEX.md', 'WORLD_MODEL.md', 'CLAUDE.md']) {
    rmSync(join(out, owned), { recursive: true, force: true });
  }
  for (const file of files) {
    const target = join(out, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
  }
  // Insight-loop state: seed only when missing so iterations build on each other.
  for (const seed of compileInsightSeeds()) {
    const target = join(out, seed.path);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, seed.content, 'utf8');
    }
  }

  // Stream dataset rows into CSVs (paged; agents compute on these with bash)
  let csvTables = 0;
  for (const d of datasets) {
    for (const t of d.tables) {
      const columns = t.columns.map((c) => c.normalized_name);
      if (!columns.length) continue;
      const lines: string[] = [columns.map(csvEscape).join(',')];
      for (let offset = 0; offset < MAX_CSV_ROWS; offset += 1000) {
        const { data: rows, error } = await supabase
          .from('dataset_rows')
          .select('data')
          .eq('dataset_table_id', t.id)
          .order('row_index')
          .range(offset, offset + 999);
        if (error || !rows?.length) break;
        for (const r of rows as any[]) {
          lines.push(columns.map((c) => csvEscape(r.data?.[c])).join(','));
        }
        if (rows.length < 1000) break;
      }
      const target = join(out, tableCsvPath(d, t));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, lines.join('\n') + '\n', 'utf8');
      csvTables += 1;
    }
  }

  // Download the original uploaded files next to their extracted text
  const slugById = new Map(kws.map((k) => [k.id, k.slug]));
  let downloaded = 0;
  let failed = 0;
  for (const [keywordId, assets] of assetsByKeyword) {
    const slug = slugById.get(keywordId);
    if (!slug) continue;
    for (const asset of assets) {
      const storagePath = (asset.meta_json as any)?.storage_path;
      if (!storagePath) continue;
      const { data, error } = await supabase.storage.from('assets').download(storagePath);
      if (error || !data) {
        failed += 1;
        continue;
      }
      const target = join(out, 'assets', slug, safeFileName(asset.file_name));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(await data.arrayBuffer()));
      downloaded += 1;
    }
  }

  console.log(`✓ Vault für „${org.name}“ → ${out}`);
  console.log(
    `  ${kws.length} Begriffe, ${(relations ?? []).length} Verknüpfungen, ${csvTables} Daten-Tabelle(n), ${downloaded} Datei(en) heruntergeladen${failed ? `, ${failed} fehlgeschlagen` : ''}`
  );
  console.log('');
  console.log('  Verbinden mit einem LLM:');
  console.log(`    cd ${out} && claude        # Claude Code liest CLAUDE.md + INDEX.md`);
  console.log('    /insight-loop              # eine Iteration Erkenntnis-Schleife');
  console.log('    /loop 30m /insight-loop    # Hintergrundbetrieb, iteriert selbstständig');
  console.log('    oder den Ordner als Obsidian-Vault öffnen.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
