/**
 * Fine-tuning dataset export — turns the ontology and accumulated human
 * feedback into training data for open models (Llama, Mistral, Qwen, …):
 *
 *   npm run export:finetune                  # first org, writes ./finetune/<slug>/
 *   npm run export:finetune -- --org demo-bau --out ./finetune
 *
 * Produces:
 *   sft.jsonl  — supervised samples (chat format): grounded Q&A generated
 *                deterministically from definitions, rules and relations,
 *                plus thumbs-up answers from ai_feedback.
 *   dpo.jsonl  — preference pairs (prompt/chosen/rejected) from thumbs-down
 *                feedback that includes a human correction.
 *   README.md  — how to train with the data (LoRA via unsloth/axolotl).
 *
 * Facts belong in retrieval — fine-tune to teach tone, format and the
 * company's vocabulary, and re-export as the ontology grows.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { Keyword, KeywordRelation } from '../src/types';

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
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}

interface ChatSample {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

interface DpoSample {
  prompt: string;
  chosen: string;
  rejected: string;
}

function groundedAnswer(k: Keyword): string {
  const parts: string[] = [];
  if (k.definition) parts.push(k.definition);
  if (k.explanation) parts.push(k.explanation);
  if (k.rules?.length) parts.push(`Dabei gilt: ${k.rules.join(' ')}`);
  if (k.examples?.length) parts.push(`Beispiele: ${k.examples.slice(0, 3).join('; ')}.`);
  return parts.join('\n\n');
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }
  if (!(globalThis as any).WebSocket) {
    (globalThis as any).WebSocket = class {} as any;
  }
  const supabase = createClient(url, key);

  let orgQuery = supabase.from('organizations').select('id, name, slug').order('created_at').limit(1);
  const orgSlug = arg('org');
  if (orgSlug) orgQuery = supabase.from('organizations').select('id, name, slug').eq('slug', orgSlug).limit(1);
  const { data: orgs } = await orgQuery;
  if (!orgs?.length) {
    console.error('Organization not found.');
    process.exit(1);
  }
  const org = orgs[0];

  const [{ data: keywords }, { data: relations }, feedbackResult, { data: worldModelRow }] = await Promise.all([
    supabase.from('keywords').select('*').eq('organization_id', org.id).neq('status', 'archived'),
    supabase
      .from('keyword_relations')
      .select('*, from_keyword:keywords!keyword_relations_from_keyword_id_fkey(id, title), to_keyword:keywords!keyword_relations_to_keyword_id_fkey(id, title)')
      .eq('organization_id', org.id),
    supabase
      .from('ai_feedback')
      .select('question, answer, rating, correction')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
      .limit(2000),
    supabase
      .from('ai_skills')
      .select('prompt_template')
      .eq('organization_id', org.id)
      .eq('name', '__world_model__')
      .maybeSingle(),
  ]);

  const kws = (keywords ?? []) as Keyword[];
  const rels = (relations ?? []) as KeywordRelation[];
  // ai_feedback may not exist yet (migration 0007) — export still works without it
  const feedback = feedbackResult.error ? [] : feedbackResult.data ?? [];
  if (feedbackResult.error) {
    console.log('Hinweis: ai_feedback-Tabelle fehlt (Migration 0007) — exportiere nur Ontologie-Samples.');
  }

  const system =
    `Du bist der Wissensassistent von ${org.name}. Antworte ausschließlich auf Basis des Firmenwissens, ` +
    `verwende die firmeneigenen Begriffe exakt wie definiert und nenne geltende Regeln.` +
    (worldModelRow?.prompt_template ? `\n\n${worldModelRow.prompt_template.slice(0, 2000)}` : '');

  // --- SFT samples from the ontology (deterministic, always in sync) ---
  const sft: ChatSample[] = [];
  const byId = new Map(kws.map((k) => [k.id, k]));
  for (const k of kws) {
    if (!k.definition?.trim()) continue;
    sft.push({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Was bedeutet „${k.title}" bei uns?` },
        { role: 'assistant', content: groundedAnswer(k) },
      ],
    });
    if (k.rules?.length) {
      sft.push({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Welche Regeln gelten für ${k.title}?` },
          { role: 'assistant', content: k.rules.map((r) => `- ${r}`).join('\n') },
        ],
      });
    }
    if (k.synonyms?.length) {
      sft.push({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Was ist ${k.synonyms[0]}?` },
          { role: 'assistant', content: `„${k.synonyms[0]}" nennen wir hier „${k.title}". ${k.definition}` },
        ],
      });
    }
  }
  for (const r of rels) {
    const from = byId.get(r.from_keyword_id);
    const to = byId.get(r.to_keyword_id);
    if (!from || !to) continue;
    if (r.relation_type === 'requires') {
      sft.push({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Was ist Voraussetzung für ${from.title}?` },
          { role: 'assistant', content: `${from.title} setzt ${to.title} voraus${r.note ? ` — ${r.note}` : '.'}` },
        ],
      });
    }
    if (r.relation_type === 'blocks') {
      sft.push({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Was kann ${to.title} verhindern?` },
          { role: 'assistant', content: `${from.title} blockiert ${to.title}${r.note ? ` — ${r.note}` : '.'}` },
        ],
      });
    }
  }
  // Thumbs-up answers are confirmed-good behavior
  for (const f of feedback) {
    if (f.rating === 1) {
      sft.push({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: f.question },
          { role: 'assistant', content: f.answer },
        ],
      });
    }
  }

  // --- DPO pairs from corrections (the RLHF-style preference data) ---
  const dpo: DpoSample[] = feedback
    .filter((f) => f.rating === -1 && f.correction?.trim())
    .map((f) => ({ prompt: f.question, chosen: f.correction!, rejected: f.answer }));

  const out = resolve(process.cwd(), arg('out') ?? './finetune', org.slug);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'sft.jsonl'), sft.map((s) => JSON.stringify(s)).join('\n') + '\n');
  writeFileSync(join(out, 'dpo.jsonl'), dpo.map((s) => JSON.stringify(s)).join('\n') + (dpo.length ? '\n' : ''));
  writeFileSync(
    join(out, 'README.md'),
    `# Fine-tuning-Daten: ${org.name}

Exportiert am ${new Date().toISOString().slice(0, 10)} — ${sft.length} SFT-Samples, ${dpo.length} DPO-Paare.

- \`sft.jsonl\` — Chat-Format (\`{"messages": [...]}\`), kompatibel mit unsloth, axolotl, LLaMA-Factory und dem OpenAI-Finetuning-Format.
- \`dpo.jsonl\` — Präferenzpaare (\`{"prompt", "chosen", "rejected"}\`) aus menschlichen Korrekturen, für DPO/ORPO.

## Open-Source-Modell trainieren (LoRA, Beispiel unsloth)

\`\`\`python
from unsloth import FastLanguageModel
from datasets import load_dataset
model, tokenizer = FastLanguageModel.from_pretrained("unsloth/Llama-3.1-8B-Instruct", load_in_4bit=True)
model = FastLanguageModel.get_peft_model(model, r=16)
dataset = load_dataset("json", data_files="sft.jsonl", split="train")
# SFTTrainer mit chat template, danach optional DPOTrainer mit dpo.jsonl
\`\`\`

Danach das Modell z. B. über Ollama servieren und die App darauf zeigen:

\`\`\`
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_CHAT_MODEL=firma-llama       # euer feingetuntes Modell
\`\`\`

**Wichtig:** Fakten gehören ins Retrieval (Weltmodell + Vault), nicht in die Gewichte —
fine-tunen lohnt sich für Ton, Format und Firmenvokabular, und erst ab einigen hundert
Feedback-Paaren. Regelmäßig neu exportieren, damit die Daten zur aktuellen Ontologie passen.
`
  );

  console.log(`✓ ${out}`);
  console.log(`  ${sft.length} SFT-Samples (sft.jsonl), ${dpo.length} DPO-Paare (dpo.jsonl)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
