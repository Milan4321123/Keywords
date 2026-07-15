import { Keyword, KeywordRelation, Asset } from '@/types';

/**
 * Vault compiler — renders the ontology as an Obsidian-style folder of
 * markdown "skill" files that any LLM agent (Claude Code, Obsidian AI, …)
 * can be pointed at directly.
 *
 * Token-efficiency contract:
 * - INDEX.md is a one-line-per-keyword map — the only file an agent must read.
 * - Each keyword is one small file, loaded on demand, with [[wiki-links]]
 *   for every dependency so the agent can walk the graph selectively.
 * - Uploaded files (Excel, photos, audio) appear as links plus their
 *   already-extracted text, so agents never parse binaries.
 */

export interface VaultFile {
  path: string;
  content: string;
}

export interface VaultDatasetTable {
  id: string;
  name: string;
  row_count: number;
  columns: Array<{ name: string; normalized_name: string; data_type: string }>;
}

export interface VaultDataset {
  id: string;
  title: string;
  description: string | null;
  keyword_id: string | null;
  tables: VaultDatasetTable[];
}

export interface VaultMetric {
  name: string;
  description: string | null;
  formula: string | null;
  aggregation: string | null;
  value_column: string | null;
  date_column: string | null;
  time_grain: string | null;
  caveats: string | null;
  keyword_id: string | null;
}

export interface VaultTask {
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  keyword_id: string | null;
}

export interface VaultInput {
  orgName: string;
  keywords: Keyword[];
  relations: KeywordRelation[];
  /** keyword_id → linked assets */
  assetsByKeyword: Map<string, Asset[]>;
  worldModelMarkdown?: string | null;
  datasets?: VaultDataset[];
  metrics?: VaultMetric[];
  tasks?: VaultTask[];
}

function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/(^-|-$)/g, '') || 'unnamed';
}

/** Canonical CSV path for a dataset table — compiler and sync script must agree. */
export function tableCsvPath(dataset: VaultDataset, table: VaultDatasetTable): string {
  return `data/${slugifyName(dataset.title)}--${slugifyName(table.name)}.csv`;
}

function slugOf(k: Keyword): string {
  return (
    k.slug ||
    k.title.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/(^-|-$)/g, '') ||
    k.id.slice(0, 8)
  );
}

function safeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}

function firstSentence(text: string | null | undefined, max = 140): string {
  if (!text) return '';
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Compile the whole ontology into vault files (markdown only — binaries are the sync step's job). */
export function compileVault(input: VaultInput): VaultFile[] {
  const { orgName, keywords, relations, assetsByKeyword, datasets = [], metrics = [], tasks = [] } = input;
  const files: VaultFile[] = [];
  const byId = new Map(keywords.map((k) => [k.id, k]));
  const slugById = new Map(keywords.map((k) => [k.id, slugOf(k)]));
  const childrenByParent = new Map<string | null, Keyword[]>();
  for (const k of [...keywords].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))) {
    const key = k.parent_id ?? null;
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), k]);
  }

  // --- keywords/<slug>.md ---
  for (const k of keywords) {
    const slug = slugById.get(k.id)!;
    const parent = k.parent_id ? byId.get(k.parent_id) : null;
    const children = childrenByParent.get(k.id) ?? [];
    const outgoing = relations.filter((r) => r.from_keyword_id === k.id && byId.has(r.to_keyword_id));
    const incoming = relations.filter((r) => r.to_keyword_id === k.id && byId.has(r.from_keyword_id));
    const assets = assetsByKeyword.get(k.id) ?? [];

    const fm: string[] = ['---'];
    fm.push(`name: ${slug}`);
    fm.push(`title: "${k.title.replace(/"/g, '\\"')}"`);
    if (k.definition) fm.push(`description: "${firstSentence(k.definition).replace(/"/g, '\\"')}"`);
    fm.push(`type: ${k.keyword_type ?? 'concept'}`);
    fm.push(`status: ${k.status ?? 'active'}`);
    if (k.synonyms?.length) fm.push(`aliases: [${k.synonyms.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(', ')}]`);
    fm.push('---');

    const body: string[] = [`# ${k.title}`, ''];
    if (k.definition) body.push(`**Definition:** ${k.definition}`, '');
    if (k.explanation) body.push(k.explanation, '');
    const labels = Object.entries(k.labels_json ?? {});
    if (labels.length) body.push(`**Übersetzungen:** ${labels.map(([l, v]) => `${l}: ${v}`).join(' · ')}`, '');

    if (k.rules?.length) {
      body.push('## Regeln (verbindlich)', '');
      for (const rule of k.rules) body.push(`- ${rule}`);
      body.push('');
    }
    if (k.examples?.length) {
      body.push('## Beispiele', '');
      for (const ex of k.examples) body.push(`- ${ex}`);
      body.push('');
    }

    const links: string[] = [];
    if (parent) links.push(`- Gehört zu: [[${slugById.get(parent.id)}|${parent.title}]]`);
    if (children.length) {
      links.push(`- Unterbegriffe: ${children.map((c) => `[[${slugById.get(c.id)}|${c.title}]]`).join(', ')}`);
    }
    for (const r of outgoing) {
      const to = byId.get(r.to_keyword_id)!;
      links.push(`- ${r.relation_type} → [[${slugById.get(to.id)}|${to.title}]]${r.note ? ` — ${r.note}` : ''}`);
    }
    for (const r of incoming) {
      const from = byId.get(r.from_keyword_id)!;
      links.push(`- [[${slugById.get(from.id)}|${from.title}]] ${r.relation_type} → dieser Begriff${r.note ? ` — ${r.note}` : ''}`);
    }
    if (links.length) {
      body.push('## Verknüpfungen', '', ...links, '');
    }

    const linkedDatasets = datasets.filter((d) => d.keyword_id === k.id);
    if (linkedDatasets.length) {
      body.push('## Daten', '');
      for (const d of linkedDatasets) {
        for (const t of d.tables) {
          body.push(`- Tabelle „${t.name}" (${t.row_count} Zeilen): [${tableCsvPath(d, t)}](../${tableCsvPath(d, t)})`);
        }
      }
      body.push('');
    }

    if (assets.length) {
      body.push('## Dateien & Belege', '');
      for (const a of assets) {
        const fileName = safeFileName(a.file_name);
        const line = `- [${a.file_name}](../assets/${slug}/${encodeURI(fileName)}) (${a.file_type})`;
        const extracted = a.extracted_text?.trim()
          ? ` — Text: [extrahiert](../assets/${slug}/${encodeURI(fileName)}.extracted.md)`
          : '';
        body.push(line + extracted);
      }
      body.push('');
    }

    files.push({ path: `keywords/${slug}.md`, content: [...fm, '', ...body].join('\n').trimEnd() + '\n' });

    // Extracted text as its own small file — agents read this instead of the binary.
    for (const a of assets) {
      if (a.extracted_text?.trim()) {
        const fileName = safeFileName(a.file_name);
        files.push({
          path: `assets/${slug}/${fileName}.extracted.md`,
          content: `# Extrahierter Text: ${a.file_name}\n(Quelle: [[../../keywords/${slug}|${k.title}]])\n\n${a.extracted_text.trim()}\n`,
        });
      }
    }
  }

  // --- INDEX.md — the map of content (one line per keyword) ---
  const indexLines: string[] = [
    `# ${orgName} — Begriffs-Index`,
    '',
    'Eine Zeile pro Begriff. Öffne nur die `keywords/`-Dateien, die zur Frage passen.',
    '',
  ];
  const walk = (parentId: string | null, depth: number) => {
    for (const k of childrenByParent.get(parentId) ?? []) {
      const slug = slugById.get(k.id)!;
      const assets = assetsByKeyword.get(k.id) ?? [];
      const hook = firstSentence(k.definition) || '(noch keine Definition)';
      const extras: string[] = [];
      if (assets.length) extras.push(`${assets.length} Datei(en)`);
      indexLines.push(`${'  '.repeat(depth)}- [[${slug}|${k.title}]] — ${hook}${extras.length ? ` _(${extras.join(', ')})_` : ''}`);
      walk(k.id, depth + 1);
    }
  };
  walk(null, 0);

  // --- data/ — every dataset as schema card + CSV pointer ---
  for (const d of datasets) {
    for (const t of d.tables) {
      const csv = tableCsvPath(d, t);
      const owner = d.keyword_id ? byId.get(d.keyword_id) : null;
      const card: string[] = [
        `# Tabelle: ${t.name}`,
        '',
        `Dataset: ${d.title}${d.description ? ` — ${d.description}` : ''}`,
        owner ? `Begriff: [[../keywords/${slugById.get(owner.id)}|${owner.title}]]` : '',
        `Zeilen: ${t.row_count} — Daten: [${csv}](../${csv})`,
        '',
        '## Spalten',
        '',
        ...t.columns.map((c) => `- \`${c.normalized_name}\` (${c.data_type})${c.name !== c.normalized_name ? ` — „${c.name}"` : ''}`),
        '',
        'Zahlen IMMER aus der CSV berechnen (awk/python), nie schätzen.',
      ].filter(Boolean);
      files.push({
        path: `data/${slugifyName(d.title)}--${slugifyName(t.name)}.md`,
        content: card.join('\n') + '\n',
      });
    }
  }

  if (metrics.length) {
    const lines = ['# Kennzahlen-Katalog', ''];
    for (const m of metrics) {
      const owner = m.keyword_id ? byId.get(m.keyword_id) : null;
      lines.push(`## ${m.name}`);
      if (m.description) lines.push(m.description);
      lines.push(
        `- Berechnung: ${m.aggregation ?? 'sum'}(${m.value_column ?? 'rows'})${m.date_column ? ` je ${m.time_grain ?? 'Monat'} über \`${m.date_column}\`` : ''}`
      );
      if (m.formula) lines.push(`- Formel: \`${m.formula}\``);
      if (m.caveats) lines.push(`- Vorsicht: ${m.caveats}`);
      if (owner) lines.push(`- Begriff: [[../keywords/${slugById.get(owner.id)}|${owner.title}]]`);
      lines.push('');
    }
    files.push({ path: 'data/metrics.md', content: lines.join('\n') });
  }

  if (tasks.length) {
    const lines = ['# Offene Aufgaben (Snapshot bei Sync)', ''];
    for (const status of ['blocked', 'in_progress', 'todo']) {
      const group = tasks.filter((t) => t.status === status);
      if (!group.length) continue;
      lines.push(`## ${status}`, '');
      for (const t of group) {
        const owner = t.keyword_id ? byId.get(t.keyword_id) : null;
        lines.push(
          `- ${t.title} (${t.priority}${t.due_date ? `, fällig ${t.due_date}` : ''})${owner ? ` — [[../keywords/${slugById.get(owner.id)}|${owner.title}]]` : ''}`
        );
      }
      lines.push('');
    }
    files.push({ path: 'data/tasks.md', content: lines.join('\n') });
  }

  // Data section in the index
  if (datasets.length || metrics.length || tasks.length) {
    indexLines.push('', '## Daten', '');
    for (const d of datasets) {
      for (const t of d.tables) {
        indexLines.push(`- \`${tableCsvPath(d, t)}\` — ${t.name}, ${t.row_count} Zeilen, ${t.columns.length} Spalten`);
      }
    }
    if (metrics.length) indexLines.push(`- [[data/metrics|Kennzahlen-Katalog]] — ${metrics.length} Kennzahl(en)`);
    if (tasks.length) indexLines.push(`- [[data/tasks|Offene Aufgaben]] — ${tasks.length} Aufgabe(n)`);
  }

  files.push({ path: 'INDEX.md', content: indexLines.join('\n') + '\n' });

  // --- .claude/skills/insight-loop — the iterative insight-mining protocol ---
  files.push({ path: '.claude/skills/insight-loop/SKILL.md', content: INSIGHT_LOOP_SKILL(orgName) });

  // --- WORLD_MODEL.md ---
  if (input.worldModelMarkdown?.trim()) {
    files.push({
      path: 'WORLD_MODEL.md',
      content: `# Weltmodell: ${orgName}\n\n${input.worldModelMarkdown.trim()}\n`,
    });
  }

  // --- CLAUDE.md — the harness contract for any agent opening this folder ---
  files.push({
    path: 'CLAUDE.md',
    content: `# ${orgName} — Company Brain Vault

Dieser Ordner ist das kompilierte Wissensmodell von ${orgName}. Jeder Begriff ist eine Datei in \`keywords/\`, Verknüpfungen sind [[Wiki-Links]], hochgeladene Belege liegen in \`assets/\`, Tabellendaten als CSV in \`data/\`.

## So beantwortest du Fragen (token-effizient)

1. Lies zuerst \`WORLD_MODEL.md\` (kurz) und \`INDEX.md\` (eine Zeile pro Begriff).
2. Öffne NUR die \`keywords/<slug>.md\`-Dateien, die zur Frage passen — nie alle.
3. Folge [[Wiki-Links]] im Abschnitt „Verknüpfungen", um Abhängigkeiten zu laden (z. B. requires, part-of, depends-on).
4. Abschnitte „Regeln (verbindlich)" sind harte Geschäftsregeln — sie gelten immer.
5. Belege: Lies \`assets/<slug>/<datei>.extracted.md\` statt der Binärdatei (Excel/PDF/Foto/Audio sind bereits als Text extrahiert).
6. Zahlen: IMMER aus \`data/*.csv\` berechnen (awk/python via Bash) — nie schätzen, nie ganze CSVs in den Kontext laden.
7. Erfinde keine Firmenfakten. Steht etwas nicht im Vault, sage genau, welche Datei/Definition fehlt.

## Insight-Loop (Hintergrund-Analyse)

Mit \`/insight-loop\` läuft EINE Iteration der Erkenntnis-Schleife: Fokus wählen → in Dateien/Daten graben → Erkenntnisse mit Belegen in \`INSIGHTS/\` festhalten → alte Erkenntnisse überprüfen. Für Dauerbetrieb im Hintergrund: \`/loop 30m /insight-loop\`. Der Zustand lebt in \`INSIGHTS/LEDGER.md\` — jede Iteration baut auf der letzten auf.

## Struktur

- \`INDEX.md\` — Inhaltskarte (immer zuerst lesen)
- \`WORLD_MODEL.md\` — kompaktes Weltmodell der Firma
- \`keywords/*.md\` — ein Begriff pro Datei (Frontmatter: name, description, aliases)
- \`assets/<slug>/\` — Original-Dateien + \`.extracted.md\`-Texte
- \`data/\` — Tabellen als CSV + Schema-Karten, Kennzahlen, Aufgaben
- \`INSIGHTS/\` — Erkenntnis-Notizen + Ledger (wird vom Insight-Loop gepflegt, überlebt Syncs)

Generiert aus Company Brain am ${new Date().toISOString().slice(0, 10)}. Änderungen bitte in der App machen und den Vault neu synchronisieren (\`npm run vault\`).
`,
  });

  return files;
}

/** The iterative insight-mining protocol, installed as a Claude Code skill inside the vault. */
function INSIGHT_LOOP_SKILL(orgName: string): string {
  return `---
name: insight-loop
description: One iteration of the insight-mining loop over this vault — pick the next focus area, dig into keyword files and CSV data, write evidence-graded insight notes to INSIGHTS/, and re-test earlier insights. Run repeatedly (e.g. /loop 30m /insight-loop) for background operation.
---

# Insight-Loop für ${orgName} — eine Iteration

Persistenter Zustand: \`INSIGHTS/LEDGER.md\` (Tabelle aller Erkenntnisse) und \`INSIGHTS/NNN-<slug>.md\` (eine Notiz pro Erkenntnis). Jede Iteration baut auf der letzten auf — dadurch werden die Erkenntnisse über Läufe hinweg besser statt redundant.

## Protokoll (jeder Aufruf = genau eine Iteration)

1. **Ledger lesen.** \`INSIGHTS/LEDGER.md\` öffnen. Fehlt es, aus der Vorlage unten anlegen. Dazu \`WORLD_MODEL.md\` + \`INDEX.md\` lesen.
2. **Fokus wählen.** Die Zeile „Nächster Fokus" im Ledger bestimmt den Start. Rotation: Definitionen → Regeln → Verknüpfungen → Datenqualität → Kennzahlen/Zahlen (aus \`data/*.csv\` rechnen!) → Prozessfluss → Querprüfung alter Erkenntnisse.
3. **Graben.** Nur die relevanten \`keywords/*.md\` öffnen, [[Links]] folgen. Zahlen mit Bash aus den CSVs berechnen (awk/python) — nie schätzen, CSVs nie komplett in den Kontext laden.
4. **Alte Erkenntnisse angreifen.** 1-2 bestehende Notizen gezielt zu widerlegen oder zu schärfen versuchen. Status/Konfidenz im Ledger aktualisieren. Eine widerlegte Erkenntnis ist ein Erfolg.
5. **Neue Erkenntnisse notieren.** Pro Erkenntnis eine Datei \`INSIGHTS/NNN-<slug>.md\` (max. ~40 Zeilen):
   - **Behauptung** (ein Satz)
   - **Belege** (Dateipfade + berechnete Zahlen mit Rechenweg)
   - **Konfidenz** (hoch/mittel/niedrig + warum)
   - **Empfohlene Aktion** (was in der App zu ändern wäre: Definition, Regel, Verknüpfung, Prozess)
   - **Nächster Test** (womit man sie widerlegen könnte)
6. **Ledger fortschreiben.** Neue Zeilen eintragen, Statuswechsel dokumentieren, „Nächster Fokus" für die kommende Iteration setzen.
7. **Kurz berichten:** neue Erkenntnisse, geänderte Status, nächster Fokus.

## Regeln

- Jede Behauptung ist in Vault-Dateien oder berechneten Zahlen verankert — sonst wird sie nicht notiert.
- Lieber eine alte Erkenntnis schärfen als eine schwache neue hinzufügen.
- Erkenntnisse, die drei Iterationen ohne Beleg bleiben, auf Status \`verworfen\` setzen.
- \`INSIGHTS/\` nie löschen — es ist das Gedächtnis der Schleife und überlebt Vault-Syncs.

## Ledger-Vorlage (falls INSIGHTS/LEDGER.md fehlt)

\`\`\`markdown
# Insight-Ledger

Nächster Fokus: Definitionen

| Nr. | Erkenntnis | Status | Konfidenz | Zuletzt geprüft |
|-----|-----------|--------|-----------|-----------------|
\`\`\`

Status-Werte: neu / bestätigt / geschärft / widerlegt / verworfen / umgesetzt.
`;
}

/** Seed files for INSIGHTS/ — written by the sync only when missing (agent state survives syncs). */
export function compileInsightSeeds(): VaultFile[] {
  return [
    {
      path: 'INSIGHTS/LEDGER.md',
      content: `# Insight-Ledger

Nächster Fokus: Definitionen

| Nr. | Erkenntnis | Status | Konfidenz | Zuletzt geprüft |
|-----|-----------|--------|-----------|-----------------|
`,
    },
    {
      path: 'INSIGHTS/README.md',
      content: `# INSIGHTS — Gedächtnis der Erkenntnis-Schleife

Dieser Ordner gehört dem Insight-Loop (\`/insight-loop\`), nicht dem Sync — er wird bei \`npm run vault\` NICHT überschrieben. \`LEDGER.md\` listet alle Erkenntnisse mit Status; jede Erkenntnis hat eine eigene Notiz mit Belegen. Hintergrundbetrieb: \`/loop 30m /insight-loop\` in Claude Code.
`,
    },
  ];
}
