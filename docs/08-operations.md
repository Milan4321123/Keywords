# Operations Runbook (Milestone 11)

## Deployment

**Vercel / Node host**: `npm run build && npm start`. Set env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, optional `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, `ANTHROPIC_FAST_MODEL`).

**Docker**:
```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -t company-brain .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=... -e NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... -e OPENAI_API_KEY=... \
  company-brain
```
Health probe: `GET /api/health` (checks DB reachability; 503 when degraded). The Docker image has a built-in HEALTHCHECK.

## Database migrations
Apply in order in the Supabase SQL editor: `supabase/schema.sql` (fresh installs) → `migrations/0002` → `0003` → `0004` → `0005`. All are safe to re-run. After 0002, first sign-up claims any pre-existing single-tenant data.

## Backups
- Enable Supabase PITR (paid) or rely on daily automated backups; verify restore quarterly.
- Logical export: `pg_dump` the project via the Supabase connection string; store off-site.
- Per-org keyword export exists in-app (Keyword Map → Tools → Export). Storage bucket `assets` must be backed up separately (S3 sync or Supabase storage replication).
- Deleting an organization cascades; there is no soft-delete yet — snapshot before honoring deletion requests.

## Rate limits
In-memory per-user buckets (`src/lib/rate-limit.ts`): AI 30/min, uploads 60/min, reports/forecasts 20/min. Per-instance only — move to Redis/Upstash when scaling beyond one instance.

## Tests
`npm test` — unit tests for the deterministic engines (analytics aggregation/period comparison, completeness scoring, data quality checks, forecasting). Extend with API integration tests against a Supabase branch database as the team grows.

## Security checklist (review before go-live)
- [ ] `assets` bucket set to **private** (signed URLs are already the only in-app access path)
- [ ] RLS enabled and policies applied (migration 0002/0004 do this)
- [ ] Service role key present only in server env; never in `NEXT_PUBLIC_*`
- [ ] Email confirmation required in Supabase Auth settings
- [ ] Invite role ceilings: only owners/admins can manage members (enforced in API)
- [ ] Audit log reviewed for anomalies (Admin → Audit Log; append-only)
- [ ] AI provider keys scoped/limited; rate limits active
- [ ] `docs/06-security-model.md` permission matrix matches `src/lib/auth.ts`

## Observability
- All mutations write `audit_logs`; every AI answer writes `ai_context_logs` (what was known and where from).
- Route errors log to stdout with a stable fallback message; pipe container logs to your aggregator.
- Suggested next step: request-id middleware + Sentry (error tracking) when traffic warrants.

## Known deferrals
- Word/.docx text extraction; DOCX report export (use HTML → print to PDF)
- Background job queue for ingestion (currently inline, non-blocking)
- Cross-table joins in the query engine
- Workflow templates UI (tables exist; tasks/dependencies/checklists shipped)
- Redis-backed rate limiting; keyword-embedding routing fallback
