# Implementation Milestones

Existing prototype gives a head start on M2 (keyword CRUD/tree/definitions), M4 (upload→extract→chunk→embed), M5 (dataset import + grounded query engine), and a seed of M6 (analytics chat with tools + evidence). The plan below upgrades everything to production grade in order.

## M1 — Core Platform Foundation ✅ (done)
- [x] Design docs (this package)
- [x] Migration 0002: organizations, profiles, members, invites, audit_logs, keyword_versions, keyword type/status/completeness, extended relation types, org_id everywhere + backfill, intelligence foundation tables, RLS
- [x] Supabase Auth: login/signup, session middleware, auth callback
- [x] Onboarding (create org), org switcher, invites (email-claim flow)
- [x] `requireOrgContext` + permission map + audit writer
- [x] All existing API routes org-scoped + permission-checked + audited
- [x] App shell with final navigation; Dashboard v1; Admin (members) page; Audit page

## M2 — Keyword Ontology ✅ (done)
- [x] Full keyword detail page (`/keywords/[id]`): overview, relations, files, history tabs
- [x] Type & status editing (15 keyword types, draft/active/archived)
- [x] Completeness scoring: pure engine (`src/lib/ontology/completeness.ts`), recompute on save/relation/asset changes, bulk recompute endpoint; version trigger skips score-only updates (migration 0003)
- [x] Version history UI with restore; versions attributed to the editing user
- [x] AI-assisted definition suggestions grounded in parent/children/relations context, applied only after user approval
- [x] Missing-definition detection filter + completeness badges in the explorer
- [x] Import/export: JSON + CSV, upsert by slug, parent linking by slug

## M3 — Relations & Graph ✅ (done)
- [x] Traversal engine `src/lib/ontology/graph.ts`: BFS with depth limits, per-intent relation-type allowlists, relevance scoring (strength × depth decay × completeness), hard node caps
- [x] `POST /api/graph/context` — the `get_dependency_context` primitive; `GET /api/graph` — full org graph
- [x] Relation-aware AI context: `/api/ask` expands matched keywords through the dependency graph (depth ≤ 2) and widens document retrieval to the dependency neighbourhood; keyword sources carry relevance scores
- [x] Visual graph view (`/graph`): force-directed layout, relation-category filters, hierarchy toggle, focus mode with depth control, neighbor highlighting, node side panel
- [x] Relation versioning (migration 0004: `keyword_relation_versions` + trigger, attributed deletions)
- [x] Full 27-type relation vocabulary in the relation editor

## M4 — Assets & Ingestion hardening ✅ (done)
- [x] Unified pipeline (`src/lib/ingestion/process.ts`): pending → processing → processed/failed lifecycle
- [x] Real Excel text extraction (per-sheet CSV), UTF-8 text decode, PDF (existing), image OCR via vision model
- [x] One-call enrichment: language detection + auto-summary + keyword-link suggestions against the org's real keyword list
- [x] Signed URLs: org-scoped storage paths, `GET /api/assets/[id]/url` (permission-checked, 5-min expiry, private-bucket ready), UI opens files through it
- [x] `POST /api/assets/[id]/reprocess`; `POST/DELETE /api/assets/link` for accepting suggestions
- [x] Provenance in meta_json (storage path, language, summary, suggested keywords, processed_at)
- Deferred: Word/.docx extraction; queued background jobs (M11)

## M5 — Structured Data Engine hardening ✅ (done)
- [x] Migration 0005: semantic_name / description / is_required / validation_rules on dataset_columns
- [x] Heuristic semantic mapping at import (amount, quantity, date, period, status, identifier, currency, entity, dimension) + `PATCH /api/datasets/columns` for manual refinement
- [x] Quality engine (`src/lib/datasets/quality.ts`): missing values, type violations, full-row duplicates, duplicate identifiers, negative amounts, inconsistent status spellings — persisted to `data_quality_issues` via `POST /api/datasets/tables/[id]/validate`, with Data Hub quality panel
- [x] `compare_periods` in the analytics engine + tool in analytics chat
- Deferred: cross-table joins; import versioning

## M6 — AI Router ✅ (done)
- [x] Provider abstraction (`src/lib/ai/provider.ts`): OpenAI + Anthropic (env-switchable, fast/strong tiers); embeddings/Whisper stay on OpenAI; data tool loop uses OpenAI native tool-calling for now
- [x] Intent detection (`src/lib/ai/router.ts`): heuristics + fast-model fallback → definition/analysis/report/forecast/workflow/search
- [x] Context builder (`src/lib/ai/context-builder.ts`): keyword match → intent-filtered graph expansion → business rules → dataset schemas (semantic-annotated, keyword-linked first) → hybrid doc retrieval; token-budgeted; envelope persisted to `ai_context_logs`
- [x] Unified `POST /api/ai/ask`: grounded tool loop (`query_table`, `compare_periods` with per-table row loading) for analytical intents; provider synthesis otherwise; sessions in `chat_sessions/chat_messages`; explicit missing-data reporting
- [x] Real AI Chat page (`/chat`): Auto/Ask/Analyze/Report/Forecast/Explain/Workflow modes, keyword + dataset scope picker, intent chip, calculations drawer, source chips, missing-data callouts
- Deferred: keyword-embedding routing fallback; numeric-provenance regex guard (M11 hardening)

## M7 — Metrics & Analytics ✅ (done)
- [x] Metric catalog CRUD (`/api/metrics`) with app-level version snapshots on update
- [x] `compute_metric` engine: definition-driven aggregation, period filters, time-grain series with z-score anomaly flags, row-level evidence
- [x] Metric definitions in the AI context + `compute_metric` tool in the router
- [x] Metrics page: create/compute/trend bars/forecast per metric
- [x] Dashboard banner for open data quality issues

## M8 — Reports ✅ (done)
- [x] Generator (`src/lib/reports/generate.ts`): computes every catalog metric (value + trend + anomalies), collects open quality issues and ontology context, then the LLM writes ONLY the narrative around the computed facts
- [x] All spec sections: executive summary, scope, keywords, data sources, KPI table, trends, anomalies, risks, missing data, recommended actions, evidence references
- [x] Saved + versioned (`reports`/`report_versions`); exports: Markdown, CSV, styled HTML (print → PDF)
- [x] Reports page: generate with type/period/keyword scope, full detail view
- Deferred: DOCX export (use HTML → print)

## M9 — Forecasting ✅ (done)
- [x] TypeScript engine (`src/lib/forecasting/forecast.ts`): OLS trend + 95% prediction intervals; refuses below 6 history points; explicit assumptions on every result
- [x] History always comes from the metric engine — never estimated
- [x] `/api/forecasts` persists `forecasts`/`forecast_runs`; `forecast_metric` tool in the AI router; forecast cards on the metrics page
- Deferred: Python service with seasonal models & scenario runs (swap-in behind the same interface)

## M10 — Workflows & Tasks ✅ (done)
- [x] Task CRUD with keyword links, subtasks, assignees, due dates, priorities
- [x] Dependencies with cycle guard; blocked-task detection (open dependency ⇒ blocked)
- [x] AI checklist generation grounded in keyword definition/rules/process relations, user-approved before creation
- [x] Tasks board (todo / in progress / blocked / done) with dependency chips
- [x] Workflow context (open tasks) injected into AI answers for workflow/report intents
- Deferred: workflow template UI (tables exist)

## M11 — Production Hardening ✅ (done)
- [x] Rate limiting (per-user buckets: AI 30/min, uploads 60/min, heavy jobs 20/min) on all expensive routes
- [x] Numeric-provenance guard: answers with numbers not traceable to tool outputs get an explicit warning
- [x] `/api/health` liveness + DB probe
- [x] Unit test suite (`npm test`, 14 tests) covering the deterministic engines: analytics, completeness, quality, forecasting
- [x] Dockerfile (standalone output, non-root, healthcheck) + `.dockerignore`
- [x] Operations runbook (`docs/08-operations.md`): deploy, migrations, backups, security checklist, known deferrals

## Definition of done (every milestone)
Typecheck clean; permissions enforced on all new routes; audit events for all mutations; docs updated; no unguarded AI numbers.
