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

## M4 — Assets & Ingestion hardening
Processing status lifecycle; OCR fallback; language detection; auto-summary; keyword-link suggestions on upload; provenance metadata; signed-URL-only access.

## M5 — Structured Data Engine hardening
Semantic column mapping; validation rules + cleaning; quality checks (missing/duplicates/type violations); joins; period comparison; import versioning (`dataset imports` provenance).

## M6 — AI Router
Intent detection; keyword routing (exact→synonym→embedding→graph expansion); context builder with token budget + priority; tool registry with org-context injection; `ai_conversations/messages/context_logs`; provider abstraction (OpenAI + Anthropic); numeric-provenance guard.

## M7 — Metrics & Analytics
Metric catalog CRUD + versions; `compute_metric`; period comparison; trend analysis; anomaly detection; data-quality reports per dataset; keyword completeness on dashboard.

## M8 — Reports
Template-driven generator (sections: executive summary, scope, keywords, sources, KPI table, trends, anomalies, risks, missing data, actions, evidence); saved + versioned; export PDF/DOCX/MD/HTML/CSV.

## M9 — Forecasting
Python FastAPI service (statsmodels/prophet-class models); minimum-history guard; confidence intervals; assumptions surface; scenario runs; `forecasts/forecast_runs`.

## M10 — Workflows & Tasks
Task CRUD + subtasks + dependencies; blocked-task detection; workflow templates with keyword-linked steps; AI task summaries/checklists.

## M11 — Production Hardening
Rate limiting; observability (request ids, tracing, error reporting); test suite (unit for engine/permissions, integration for API); backup/restore runbook; Docker deployment; security review.

## Definition of done (every milestone)
Typecheck clean; permissions enforced on all new routes; audit events for all mutations; docs updated; no unguarded AI numbers.
