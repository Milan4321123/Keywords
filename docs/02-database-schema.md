# Database Schema

Conventions: UUID PKs (`gen_random_uuid()`), `created_at`/`updated_at` everywhere, `organization_id` on every tenant table (indexed), soft evolution via `supabase/migrations/`. The authoritative DDL is `supabase/schema.sql` (v1, already applied) plus `supabase/migrations/0002_platform_foundation.sql` (this milestone).

## Table inventory by module

### Tenancy & identity (M1 — in migration 0002)
| Table | Purpose |
|---|---|
| `organizations` | id, name, slug, industry, timezone, default_language, settings jsonb |
| `profiles` | mirror of `auth.users` (id FK, email, full_name, avatar) maintained by trigger |
| `organization_members` | org_id, user_id, role (`owner\|admin\|manager\|analyst\|editor\|viewer\|guest`), unique(org,user) |
| `organization_invites` | email, role, token, invited_by, accepted_at — claimed at first login |
| `audit_logs` | org_id, actor_id, action, entity_type, entity_id, details jsonb — append-only |

### Ontology (v1 tables, extended in 0002)
| Table | Purpose |
|---|---|
| `keywords` | + org_id, `keyword_type` (concept/process/metric/dataset/document_type/role/task_type/workflow_step/department/entity/kpi/report_type/risk/rule/skill), `status` (draft/active/archived), `completeness_score`, `owner_member_id` |
| `keyword_versions` | snapshot on every update (trigger): full row jsonb, version_no, changed_by |
| `keyword_relations` | + org_id, extended `relation_type` enum (adds produces, affects, enables, uses, generated-by, measured-by, reported-in, calculated-from, validated-by, conflicts-with, replaces, derived-from, belongs-to) |

### Evidence (v1, extended)
`assets` (+ org_id, title, description, source, processing_status), `keyword_assets`, `chunks` (+ org_id), `voice_recordings` (+ org_id).

### Structured data (v1, extended)
`datasets` (+ org_id, keyword_id, status), `dataset_tables`, `dataset_columns` (+ semantic_name, description, is_required, validation_rules — M5), `dataset_rows`.

### Intelligence (foundation tables created in 0002, features land M6–M10)
| Table | Purpose |
|---|---|
| `metrics` | keyword_id, formula, aggregation, source table/column refs, time_grain, dimensions, caveats |
| `metric_versions` | snapshot history |
| `ai_skills` | keyword_id, skill_type, required_data, tools_used, prompt_template, output_schema |
| `ai_conversations` / `ai_messages` | replaces v1 chat_sessions/chat_messages going forward (org-scoped, mode, scope refs) |
| `ai_context_logs` | per-answer record of keywords/definitions/relations/chunks/rows/tools used |
| `reports` / `report_versions` | type, period, sections jsonb, export refs |
| `tasks` / `task_dependencies` | keyword-linked tasks, parent_task_id, status, priority, assignee, due_date |
| `workflows` / `workflow_steps` | templates whose steps reference keywords |
| `data_quality_issues` | org_id, entity refs, issue_type, severity, status |
| `forecasts` / `forecast_runs` | metric_id, horizon, assumptions, intervals, model info |

## Key decisions

1. **`organization_id` denormalized onto every table** (even children like `chunks`, `dataset_rows` get it via their parents at the app layer; direct column on hot tables: keywords, relations, assets, chunks, datasets). This keeps RLS policies simple and queries index-friendly.
2. **Backfill strategy**: migration creates a "Default Organization" only if pre-existing rows are found, assigns them, then sets columns `not null`. Fresh installs skip it.
3. **Versioning via triggers**, not app code — `keyword_versions` gets a snapshot before update/delete; same pattern reused for metrics/reports later.
4. **RLS**: enabled on all tenant tables. Policies grant members read where role permits; writes restricted by role tier. Server routes use the service client (bypasses RLS) *after* enforcing the same rules in `requireOrgContext` — RLS protects direct/browser access paths.
5. **Roles are an enum, permissions a code-level map** (`src/lib/auth.ts`). A `permissions` table is deferred until custom roles are needed; the map covers: view/edit keywords, upload assets, view datasets, run AI, generate reports, manage members, edit workflows, export data.
6. **Relation enum keeps v1 hyphen style** (`depends-on`), spec's snake_case names map 1:1 in the API layer.
7. Indexes: every FK, `(organization_id)`, `(organization_id, slug)` unique on keywords, GIN on `dataset_rows.data`, ivfflat on `chunks.embedding`, GIN tsvector on chunks, `(org_id, created_at desc)` on audit_logs.
