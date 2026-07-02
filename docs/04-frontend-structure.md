# Frontend Structure

App Router layout. Authenticated product lives in the `(app)` route group behind middleware; auth pages outside it.

```
src/app/
  login/page.tsx            # sign in / sign up (email+password)
  onboarding/page.tsx       # create first organization
  auth/callback/route.ts    # Supabase code exchange
  (app)/
    layout.tsx              # shell: sidebar nav + org switcher + user menu
    dashboard/page.tsx      # KPIs, missing definitions, recent activity, quality warnings
    keywords/page.tsx       # ontology explorer (v1 UI moved here)
    graph/page.tsx          # graph view (M3)
    data/page.tsx           # Data Hub (v1 /analytics moved here)
    chat/page.tsx           # AI chat with modes + scope picker (M6)
    reports/page.tsx        # saved reports + generator (M8)
    metrics/page.tsx        # metric catalog (M7)
    tasks/page.tsx          # tasks/workflows (M10)
    admin/page.tsx          # org settings + members + invites
    admin/audit/page.tsx    # audit log
```

## Shell

- Left sidebar: Dashboard, Keyword Map, Graph, Data Hub, AI Chat, Reports, Metrics, Tasks, Admin (role-gated), Audit (role-gated).
- Top of sidebar: organization switcher (memberships from `/api/orgs`), create-org action.
- Bottom: user email + sign out.
- Pages not yet implemented render as labeled placeholders with the milestone number — the information architecture is final from M1.

## Page contracts (later milestones)

**Dashboard**: most-used keywords, undefined/incomplete keywords, data-quality warnings, recent uploads, recent reports, open tasks, AI suggestions.
**Keyword Detail** (drawer/modal today → full page M2): definition, explanation, children, parents, relations, assets, datasets, skills, reports, tasks, activity history, completeness warnings.
**AI Chat** modes: Ask / Analyze / Report / Forecast / Explain / Improve data / Generate workflow; scope: whole org, keyword(s), project, dataset, report.
**Data Hub**: datasets list, table schemas, import wizard, quality reports.

## Conventions

- Client components fetch via `/api/*` with the shared `{data,error}` envelope.
- All fetches include cookies (same-origin default) — no client-side service keys ever.
- Tailwind design system already established in the prototype (slate/blue, rounded-2xl cards) — keep it.
