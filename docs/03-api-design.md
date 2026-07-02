# API Design

All routes live under `/api`. Response envelope: `{ data, error }`. Every route (except auth) runs `requireOrgContext(req, permission)` which returns 401 (no session), 403 (no membership / insufficient role), or `{ user, org, member, supabase }`. Mutations write `audit_logs`.

## Auth & tenancy (M1)
| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/auth/callback` | GET | — | Supabase email-confirm / magic-link exchange |
| `/api/orgs` | GET | session | list my organizations |
| `/api/orgs` | POST | session | create org (creator becomes owner) |
| `/api/orgs/active` | POST | member | switch active org (sets cookie) |
| `/api/orgs/members` | GET | manage_members? admins else self-view | list members + pending invites |
| `/api/orgs/members` | POST | manage_members | invite by email (role) |
| `/api/orgs/members` | PATCH | manage_members | change role |
| `/api/orgs/members` | DELETE | manage_members | remove member / revoke invite |
| `/api/audit` | GET | view_audit | paged audit log |

## Ontology (v1 routes, now org-scoped)
| Route | Method | Permission |
|---|---|---|
| `/api/keywords` | GET / POST | view_keywords / edit_keywords |
| `/api/keywords/[id]` | GET / PUT / DELETE | view / edit / edit |
| `/api/keywords/[id]/versions` | GET | view_keywords (M2) |
| `/api/relations` | GET / POST / DELETE | view / edit / edit |
| `/api/generate-keywords` | POST | edit_keywords + run_ai |

## Evidence
| Route | Method | Permission |
|---|---|---|
| `/api/assets/upload` | POST / GET | upload_assets / view_assets |
| `/api/transcribe` | POST | upload_assets |

## Structured data & analytics
| Route | Method | Permission |
|---|---|---|
| `/api/datasets` | GET | view_datasets |
| `/api/datasets/upload` | POST | upload_assets |
| `/api/datasets/rows` | GET | view_datasets |
| `/api/analytics/query` | POST | view_datasets |
| `/api/analytics/ask` | POST | run_ai |
| `/api/analytics/recommend` | POST | run_ai |

## AI (M6)
`/api/ask` POST (run_ai) — will move to router: `{ question, scope: { keyword_ids?, dataset_id?, mode } }` → grounded envelope `{ answer, sources, keywords_used, calculations, missing_data, next_action }`.

## Later milestones
- M7: `/api/metrics` CRUD, `/api/metrics/[id]/compute`
- M8: `/api/reports` CRUD, `/api/reports/[id]/export?format=pdf|docx|md|html|csv`
- M9: `/api/forecasts` run/list
- M10: `/api/tasks`, `/api/workflows`

## AI tool interface (server-side registry, M6)

Keyword: `search_keywords, get_keyword, get_keyword_tree, get_keyword_relations, get_dependency_context, get_keyword_assets`
Asset: `search_assets, get_asset, retrieve_document_chunks, summarize_asset`
Dataset: `list_datasets, inspect_dataset_schema, query_table, filter_rows, aggregate_rows, group_by, compare_periods, detect_anomalies, validate_dataset, find_duplicates, find_missing_values`
Metric: `list_metrics, get_metric_definition, compute_metric, compare_metric, explain_metric_change`
Report: `generate_report, save_report, export_report`
Forecast: `forecast_metric, explain_forecast, run_scenario`
Workflow: `list_tasks, create_task, summarize_tasks, find_blocked_tasks, generate_checklist`

Every tool receives `(orgContext, args)` — org scoping is inside the tool, never trusted from the model.
