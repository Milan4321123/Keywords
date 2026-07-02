# Implementation Milestones

Existing prototype gives a head start on M2 (keyword CRUD/tree/definitions), M4 (upload→extract→chunk→embed), M5 (dataset import + grounded query engine), and a seed of M6 (analytics chat with tools + evidence). The plan below upgrades everything to production grade in order.

## M1 — Core Platform Foundation (THIS MILESTONE)
- [x] Design docs (this package)
- [ ] Migration 0002: organizations, profiles, members, invites, audit_logs, keyword_versions, keyword type/status/completeness, extended relation types, org_id everywhere + backfill, intelligence foundation tables, RLS
- [ ] Supabase Auth: login/signup, session middleware, auth callback
- [ ] Onboarding (create org), org switcher, invites (email-claim flow)
- [ ] `requireOrgContext` + permission map + audit writer
- [ ] All existing API routes org-scoped + permission-checked + audited
- [ ] App shell with final navigation; Dashboard v1; Admin (members) page; Audit page

## M2 — Keyword Ontology (production grade)
Keyword detail as full page; type/status editing; version history UI; completeness scoring job; AI-assisted definition generation (exists — harden); missing-definition detection; import/export (CSV/JSON).

## M3 — Relations & Graph
Graph view page (visual); traversal API (`get_dependency_context`) with depth limits, relation-type filters, relevance scoring; relation versioning.

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
