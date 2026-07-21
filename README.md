# Company Brain — Keyword-Based Organizational AI

A multi-tenant company intelligence platform built around your company's keyword ontology. Define terms, create relationships, upload evidence and structured data, and get grounded answers from your AI assistant.

The full product design (architecture, schema, AI routing, security model, milestones) lives in [`docs/`](docs/).

## Features

### 🏢 Organizations, Auth & Roles (Milestone 1)
- Email/password sign-in (Supabase Auth), multi-organization workspaces
- Role-based access control: owner, admin, manager, analyst, editor, viewer, guest
- Member invites by email (claimed automatically at first sign-in)
- Every API route is organization-scoped and permission-checked
- Append-only audit log of keywords, relations, uploads, datasets, AI questions, and member changes
- Keyword version history captured automatically on every update

### 🌳 Keyword Tree (Ontology)
- Hierarchical organization of company concepts
- Expandable/collapsible tree navigation
- Drag-and-drop reorganization (coming soon)

### 📝 Keyword Management
- **Definitions**: Short 1-2 line explanations
- **Explanations**: Detailed context (voice or typed)
- **Examples**: Real-world usage examples
- **Synonyms**: Alternative names, multilingual labels
- **Rules**: Business constraints and requirements

### 🎤 Voice Input
- Press the mic button and speak to add definitions
- Automatic transcription using OpenAI Whisper
- Works for definitions, explanations, and examples

### 🔗 Relationship Editor
- Connect keywords with semantic relations:
  - `is-a` (Invoice is-a Document)
  - `part-of` (Trade is part-of Project)
  - `requires` (Invoice requires Approval)
  - `depends-on` (Payment depends-on Approval)
  - And 10+ more relation types
- Visual relationship display
- Bidirectional relationship support

### 📎 Evidence Upload
- Upload PDFs, images, Excel, Word, and text files
- Automatic text extraction
- Link files to keywords as evidence
- Files are chunked and embedded for RAG

### 🤖 AI Assistant
- Ask questions in natural language
- Hybrid retrieval from:
  - Keyword definitions (structured knowledge)
  - Relationships (semantic connections)
  - Document chunks (evidence)
- Sources cited in responses
- Context-aware conversations

### Grounded Analytics (MVP)
- Upload Excel/CSV as structured tables (not just text chunks)
- Compute aggregations/trends via a query tool (not “LLM math”)
- Analytics chat that calls tools and returns row-level evidence (traceable IDs)
- UI at `/analytics`

### Grounded Projects & Business Objects
- Project cockpit at `/projects` combines delivery, cost, risks, decisions, tasks, stakeholders, and evidence
- Stable identities for projects, customers, employees, suppliers, invoices, products, and other real business objects
- Append-only, time-valid facts: corrections close the old fact instead of erasing history
- Every fact carries a truth status and provenance (`manual`, dataset row, document, metric, integration, or calculation)
- Immutable event ledger separates what happened from the object's current state
- AI context explicitly distinguishes approved/verified facts, derived facts, asserted input, and disputed data

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL + pgvector)
- **AI**: OpenAI GPT-4 + Whisper + Ada-002 Embeddings
- **Storage**: Supabase Storage

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase account
- OpenAI API key

### Installation

1. **Clone and install dependencies**
   ```bash
   cd keywords
   npm install
   ```

2. **Set up Supabase**
   - Create a new Supabase project
   - In the SQL Editor, run **`supabase/setup_complete.sql`** — the idempotent base schema and platform migrations.
   - Then run **`supabase/migrations/0008_business_object_layer.sql`** to enable stable business identities, sourced facts, events, and the grounded AI object context.
   - Enable the `pgvector` extension (the script enables it, but confirm under Database → Extensions)
   - Create a storage bucket named `assets` (set it Private — the app serves files via signed URLs)
   - Enable email/password auth under Authentication → Providers
   - Optional: run `supabase/seed.sql` for demo construction data. `schema.sql` + `migrations/*` are also available individually if you prefer to run them step by step.

3. **Configure environment**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your credentials:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   # Free hosted open-weight models for table/metric design and AI reasoning
   AI_PROVIDER=groq
   GROQ_API_KEY=gsk_your-groq-key

   # Still optional for embeddings, image OCR, and OpenAI-only legacy routes
   OPENAI_API_KEY=sk-your-openai-key
   ```

   The default Groq models are `openai/gpt-oss-120b` for strong reasoning and
   `openai/gpt-oss-20b` for fast routing. Override them with `GROQ_MODEL` and
   `GROQ_FAST_MODEL`. Groq is OpenAI-compatible, but its chat provider is kept
   separate here so changing it cannot accidentally redirect embedding calls.

4. **Run development server**
   ```bash
   npm run dev
   ```

5. **Open the app**
   Navigate to [http://localhost:3000](http://localhost:3000), sign up, and create your organization.

### Demo businesses (recommended first step)

Two fully modeled example businesses — a construction contractor and a restaurant — with layered keyword definitions, business rules, semantic relations, real datasets, metrics, and open tasks:

```bash
npm run seed:demo                        # attaches the oldest account as owner
npm run seed:demo -- --email you@x.com   # or a specific account
npm run seed:demo -- --reset             # wipe + recreate the demo orgs
```

This creates **Demo Bau GmbH** (`demo-bau`) and **Ristorante Bella Vista** (`demo-restaurant`). Log in and switch organizations to explore them, or use them as templates for your own business.

Add a realistic employee-level work-time schedule with editable date, time,
number, and EUR fields plus six computable metrics. This seed is additive and
does not replace manually edited rows:

```bash
npm run seed:operations
npm run seed:operations -- --org demo-restaurant
```

Seed a connected project-management scenario (project plan, risks, decisions,
stakeholders, evidence, dependent tasks, exact metrics, and—when migration 0008
is installed—a linked Project Atlas business object with current facts):

```bash
npm run seed:project -- --org milan
```

## LLM Vault Connector (Obsidian-style)

Compile any organization into a plain markdown folder that Claude Code — or any file-reading agent — can be pointed at directly. Token-efficient by design: the agent reads a one-line-per-keyword `INDEX.md`, then opens only the keyword files it needs, following `[[wiki-links]]` for dependencies and computing numbers from `data/*.csv` with shell tools instead of loading data into context.

```bash
npm run vault -- --org demo-bau --out ./vault-bau
cd vault-bau && claude       # CLAUDE.md tells the agent how to navigate
```

The vault contains: `CLAUDE.md` (agent contract), `INDEX.md` (map of content), `WORLD_MODEL.md` (compiled org summary), `keywords/*.md` (one skill file per keyword with frontmatter, rules, relations), `data/` (dataset CSVs, schema cards, metric catalog, open tasks), `assets/` (uploaded files + extracted text), and `INSIGHTS/` (see below). The folder also opens directly as an Obsidian vault with a working link graph. Re-running the sync refreshes everything except `INSIGHTS/`.

### Insight loop (background analysis)

The vault ships with a Claude Code skill, `/insight-loop`: one iteration picks the next focus area, digs into keyword files and CSVs, writes evidence-graded insight notes to `INSIGHTS/`, and re-tests earlier insights. State persists in `INSIGHTS/LEDGER.md`, so every run builds on the last. For continuous background operation:

```bash
cd vault-bau && claude
> /loop 30m /insight-loop
```

## Zero API Cost: Use Your Claude Subscription (MCP Connector)

You don't need a paid API key to run the AI layer — a normal Claude Pro/Max subscription covers both paths:

**1. Claude Code on the vault (offline snapshot).** `npm run vault`, then `cd vault && claude`. Claude Code is included in the subscription and reads the folder token-efficiently (see above). Best for insights, the background `/insight-loop`, and analysis.

**2. Live MCP connector (real-time data + actions).** `scripts/mcp-server.ts` exposes the organization to Claude Desktop or Claude Code as tools: `list_keywords`, `get_keyword`, `search_keywords`, `get_world_model`, `list_datasets`, `get_dataset_rows` (CSV), and — for doing actual work — `create_keyword` and `update_keyword`. Claude searches your data itself and presses the buttons, exactly like the API-driven assistant, but billed to your flat subscription.

Claude Desktop → Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "company-brain": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/keywords/scripts/mcp-server.ts"],
      "env": { "COMPANY_BRAIN_ORG": "demo-bau" }
    }
  }
}
```

Claude Code: `claude mcp add company-brain --env COMPANY_BRAIN_ORG=demo-bau -- npx tsx scripts/mcp-server.ts`. The server reads credentials from the project `.env` and runs locally — nothing is exposed to the network. ChatGPT Plus has no local-connector equivalent; there, upload the exported vault folder to a ChatGPT Project instead.

## Human Feedback & Open-Model Fine-Tuning

The AI improves from human feedback without retraining: every answer in the AI chat has 👍/👎, and a 👎 with a correction becomes **standing guidance** injected into all future answers immediately (run migration `supabase/migrations/0007_ai_feedback.sql` once). Facts always stay in retrieval — the ontology, world model, and vault — so the knowledge is never stale.

All feedback also accumulates into a training dataset for open models:

```bash
npm run export:finetune -- --org demo-bau
# → finetune/demo-bau/sft.jsonl  (chat-format samples from ontology + 👍 answers)
# → finetune/demo-bau/dpo.jsonl  (preference pairs from 👎 corrections)
```

Train a LoRA on Llama/Mistral (unsloth/axolotl instructions are in the exported README), serve it with Ollama, and point the app at it — the whole AI stack runs on any OpenAI-compatible endpoint:

```
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_CHAT_MODEL=your-finetuned-model
```

Rule of thumb: fine-tune for tone, format, and company vocabulary once a few hundred feedback pairs exist; never fine-tune for facts.

## Production Deployment

`npm run build` produces a standalone Next.js server. Three supported paths:

- **Vercel:** import the repo, set the four env vars from `.env.example`, deploy.
- **Render:** use the included `render.yaml` blueprint (New + → Blueprint). If you configure the service manually instead, you **must** add the env var `HOSTNAME=0.0.0.0` (Render pods set `HOSTNAME` to the pod name, Next binds to it, and the proxy answers 502) and use `npx next start -H 0.0.0.0 -p $PORT` as the start command.
- **Docker:** the included `Dockerfile` builds a hardened standalone image with a `/api/health` healthcheck:
  ```bash
  docker build -t company-brain \
    --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... .
  docker run -p 3000:3000 -e SUPABASE_SERVICE_ROLE_KEY=... -e OPENAI_API_KEY=... company-brain
  ```

Checklist: Supabase `setup_complete.sql` applied, `assets` bucket private, email auth enabled, env vars set, `npm run build` green, `/api/health` returns 200.

## Database Schema

### Keywords Table
Stores your ontology nodes with definitions, examples, and metadata.

### Keyword Relations Table
Stores relationships between keywords (is-a, part-of, requires, etc.)

### Assets Table
Stores uploaded files with extracted text.

### Chunks Table
Stores document chunks with vector embeddings for RAG retrieval.

## Usage Guide

### Creating a Keyword
1. Click "+" in the sidebar or right-click → "Add sub-keyword"
2. Enter a title (e.g., "Invoice")
3. Add a short definition
4. Use the mic button to speak a detailed explanation
5. Add examples and rules
6. Save

### Adding Relations
1. Select a keyword
2. Go to the "Relations" tab
3. Click "Add Relation"
4. Choose relation type (e.g., "requires")
5. Select target keyword (e.g., "Approval")
6. Save

### Uploading Evidence
1. Select a keyword
2. Go to the "Files" tab
3. Drag & drop files or click to upload
4. Files are automatically processed and linked

### Asking Questions
1. Go to "Ask AI" tab
2. Optionally select context keywords
3. Type your question
4. AI responds using your knowledge base

## Example Domain Structure

```
Projects
├── Trade
│   ├── Electrical
│   ├── Plumbing
│   └── HVAC
├── Defect
│   ├── Major Defect
│   └── Minor Defect
└── Phase
    ├── Planning
    ├── Construction
    └── Completion

Documents
├── Invoice
│   └── requires → Approval
├── Contract
└── Approval
    └── owned-by → Bauleiter

Roles
├── Bauleiter (Site Manager)
├── Project Manager
└── Quality Inspector

Properties
├── Tenant
└── Unit
    └── part-of → Building
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/keywords` | GET | List all keywords |
| `/api/keywords` | POST | Create keyword |
| `/api/keywords/[id]` | GET | Get keyword with relations/assets |
| `/api/keywords/[id]` | PUT | Update keyword |
| `/api/keywords/[id]` | DELETE | Delete keyword |
| `/api/relations` | GET | List relations |
| `/api/relations` | POST | Create relation |
| `/api/relations` | DELETE | Delete relation |
| `/api/assets/upload` | POST | Upload file |
| `/api/assets/upload` | GET | List assets |
| `/api/transcribe` | POST | Transcribe audio |
| `/api/ask` | POST | Ask AI question |
| `/api/datasets` | GET | List datasets + tables |
| `/api/datasets/upload` | POST | Upload Excel/CSV as tables |
| `/api/analytics/query` | POST | Run aggregations with evidence |
| `/api/analytics/ask` | POST | Tool-grounded analytics chat |
| `/api/orgs` | GET/POST | List / create organizations |
| `/api/orgs/active` | POST | Switch active organization |
| `/api/orgs/members` | GET/POST/PATCH/DELETE | Members, invites, roles |
| `/api/audit` | GET | Paged audit log (admins) |

All routes require a signed-in member of the active organization; roles gate mutations (see `docs/06-security-model.md`).

## Roadmap

- [x] User authentication & permissions (Milestone 1)
- [x] Audit log / version history (Milestone 1)
- [x] Keyword typing, status & completeness scoring (Milestone 2)
- [x] Full keyword detail page with version history & restore (Milestone 2)
- [x] AI-assisted definition suggestions with user approval (Milestone 2)
- [x] Keyword import/export (JSON & CSV) (Milestone 2)
- [x] Visual knowledge graph view with dependency focus mode (Milestone 3)
- [x] Graph traversal API with depth limits & relevance scoring (Milestone 3)
- [x] Relation-aware AI context loading (Milestone 3)
- [x] Ingestion hardening: OCR, summaries, keyword suggestions, signed URLs (Milestone 4)
- [x] Semantic column mapping & data quality reports (Milestone 5)
- [x] AI router with intent detection, context builder & grounded chat (Milestone 6)
- [x] Metric catalog with grounded computation & anomaly flags (Milestone 7)
- [x] Report generator with KPI tables, evidence & exports (Milestone 8)
- [x] Forecasting with confidence intervals & assumptions (Milestone 9)
- [x] Tasks, dependencies, blocked detection & AI checklists (Milestone 10)
- [x] Rate limits, provenance guard, tests, Docker, ops runbook (Milestone 11)

All 11 milestones from [`docs/07-milestones.md`](docs/07-milestones.md) are implemented; remaining refinements are listed under "Known deferrals" in [`docs/08-operations.md`](docs/08-operations.md).

## License

MIT
