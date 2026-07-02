# System Architecture

## Stack

- **Frontend**: Next.js (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes (Node runtime). Python FastAPI microservice added at M9 for statistics/forecasting; until then all computation is in TypeScript.
- **Database**: Supabase PostgreSQL + pgvector (single database, multi-tenant via `organization_id` + RLS)
- **Auth**: Supabase Auth (email/password now; SSO later) via `@supabase/ssr` cookie sessions
- **Storage**: Supabase Storage, private bucket `assets`, signed URLs only
- **AI providers**: abstraction in `src/lib/ai/` — OpenAI today (GPT-4 class + Whisper + embeddings), Anthropic pluggable
- **Background jobs**: Postgres-backed job table + poller now; upgradeable to a queue (M11). Long uploads process inline with status flags until then.
- **Observability**: structured logs per request id; error mapping in `supabase-errors.ts`; tracing at M11

## Topology

```
Browser (Next.js UI)
  │  cookie session (Supabase Auth)
  ▼
Next.js middleware ──► refresh session, gate /app routes
  ▼
Next.js API routes ("/api/*")
  │   1. requireOrgContext(): user → org membership → role → permission check
  │   2. all queries scoped by organization_id (service client) + RLS backstop
  │   3. audit log write on every mutation
  ├──► Postgres (keywords, relations, assets, chunks, datasets, metrics, …)
  ├──► Supabase Storage (files, signed URLs)
  ├──► AI provider (chat, embeddings, transcription)
  └──► Structured Data Engine (src/lib/analytics.ts — filter/group/aggregate over dataset_rows)
```

## Backend modules (directory = module)

```
src/lib/
  auth.ts              # org context, RBAC, permission map, audit helper
  supabase/            # server (cookie) client, browser client, service client
  ai/                  # provider abstraction: chat(), embed(), transcribe()
  ai/router.ts         # intent detection + keyword routing            (M6)
  ai/context-builder.ts# assembles grounded context envelope           (M6)
  ai/tools/            # tool registry: keyword/asset/dataset/metric/… (M6+)
  ontology/            # keyword tree/graph traversal, completeness    (M2–3)
  ingestion/           # extract, ocr, chunk, embed, suggest keywords  (M4)
  datasets.ts          # import, schema inference, row storage         (M5)
  analytics.ts         # grounded query engine (filters/aggregates)    (M5/M7)
  metrics/             # metric catalog + compute_metric               (M7)
  reports/             # report generation + export                    (M8)
  forecasting/         # calls Python service                          (M9)
  workflows/           # tasks, dependencies, blocked detection        (M10)
  audit.ts             # audit_logs writer
src/app/api/           # thin HTTP handlers over the modules above
```

## Multi-tenancy model

- Every domain table carries `organization_id uuid not null` with an index.
- API routes resolve `{ user, org, role }` once per request (`requireOrgContext`), then every query filters by `org.id`. Service-role client is used server-side for performance, so **application-level scoping is mandatory**; RLS policies exist as a second line of defense for any anon/browser access.
- Users belong to many orgs via `organization_members`; active org is a cookie (`active_org`), switchable in the shell.

## Data ingestion pipeline (M4/M5 target)

```
Upload → store file (private bucket)
      → create asset row (processing_status=pending)
      → extract text (pdf-parse / xlsx / plain) — OCR fallback (M4)
      → detect language, generate summary (M4)
      → chunk → embed → chunks rows (exists)
      → suggest keyword links (M4)
      → if tabular: dataset import → tables/columns/rows + type inference (exists, harden M5)
      → mark processed, write provenance to meta_json, audit log
```

## AI request lifecycle (M6 target)

```
question → router (intent, candidate keywords, needs_data?, needs_docs?, skill?)
        → context builder (definitions → rules → dependencies (depth≤2, relevance-scored)
                           → metric definitions → dataset schemas → doc chunks)
        → plan: tool calls (query_table / compute_metric / …) executed server-side
        → answer assembly: answer + sources + calculations + missing data + next action
        → persist ai_messages + ai_context_logs (what was loaded and why)
```

Graph explosion is prevented by: relation-type allowlist per intent, depth limit (default 2), per-node relevance score (relation strength × keyword completeness × usage), and a hard cap on context tokens.
