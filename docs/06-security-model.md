# Security Model

## Authentication
- Supabase Auth, email/password (SSO/SAML later). Cookie sessions via `@supabase/ssr`; middleware refreshes tokens and gates all `(app)` routes and `/api/*`.
- No Supabase service key ever reaches the browser. `NEXT_PUBLIC_*` keys are anon-only.

## Tenancy & RBAC
- Roles per organization: `owner > admin > manager > analyst > editor > viewer > guest`.
- Permission map (code, `src/lib/auth.ts`):

| Permission | owner | admin | manager | analyst | editor | viewer | guest |
|---|---|---|---|---|---|---|---|
| view_keywords / view_assets / view_datasets | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| run_ai | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| edit_keywords / upload_assets | ✓ | ✓ | ✓ | – | ✓ | – | – |
| generate_reports | ✓ | ✓ | ✓ | ✓ | – | – | – |
| edit_workflows | ✓ | ✓ | ✓ | – | – | – | – |
| export_data | ✓ | ✓ | ✓ | ✓ | – | – | – |
| manage_members / view_audit | ✓ | ✓ | – | – | – | – | – |
| manage_org / delete_org | ✓ | – | – | – | – | – | – |

- Enforcement is layered: (1) `requireOrgContext(req, permission)` in every API route; (2) RLS policies on all tenant tables keyed on `organization_members`; (3) UI hides what the role can't do (cosmetic only, never relied on).

## Permission-aware AI retrieval
Context builder and every AI tool receive the caller's org context; retrieval functions take `organization_id` as a required parameter (v1 `match_chunks*` RPCs already accept an org filter — it becomes mandatory). A user can never get an AI answer derived from data their role can't view.

## Files
Private bucket; uploads keyed `org/{org_id}/assets/{asset_id}/{filename}`; access via short-lived signed URLs generated after a permission check. No public URLs.

## Audit
Append-only `audit_logs` (no update/delete policies): keyword/relation/asset/dataset mutations, report generation, AI questions, exports, member/permission changes. Each row: actor, action, entity type/id, details jsonb, IP/user-agent when available.

## API hygiene
- Input validation on every route (types + length caps); slugs and filenames sanitized.
- Rate limiting (M11): per-user and per-org buckets on AI + upload routes.
- Secrets only in server env (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); `.env` git-ignored.
- Signed invite tokens; invites expire; role in invite capped at inviter's role.

## Backups & retention (M11)
Supabase PITR/daily dumps; export tooling per org; delete-org performs cascading purge with a grace window.
