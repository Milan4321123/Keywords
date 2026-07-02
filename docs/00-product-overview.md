# Product Overview — Keyword-Based Organizational AI (Company Brain)

## What this product is

A multi-tenant company intelligence platform in which **every business concept is a keyword node** and the keyword map is the operating system of company knowledge. It is not a RAG chatbot, not a notes app, and not a document search tool.

A keyword node is an intelligent organizational unit carrying:

1. Meaning (short definition, long explanation, examples, non-examples)
2. Company-specific definition (per-organization, versioned)
3. Sub-keywords (tree hierarchy)
4. Typed dependencies and relations (graph)
5. Attached documents and evidence (assets)
6. Structured datasets (queryable rows, not text blobs)
7. AI skills (reusable, tool-grounded capabilities)
8. Workflows and tasks
9. Reports
10. Metrics (formula + source datasets + computation logic)
11. Access permissions
12. Audit history
13. Business rules
14. LLM reasoning context

## How the AI answers

For every question the system:

1. Detects intent (definition | analysis | report | forecast | workflow | search).
2. Routes to relevant keywords via the graph (not embeddings-first).
3. Loads keyword definitions and business rules as the first context layer.
4. Follows typed relations to load required dependencies (depth-limited, relevance-scored).
5. Retrieves cited document evidence (hybrid vector + full-text).
6. **Calls structured-data tools for every number** — the LLM never does arithmetic and never invents figures.
7. Computes metrics from the metric catalog definitions.
8. Produces a grounded answer with: answer, data used, keywords used, calculations performed, missing data, recommended next action.

## Hard product rules (non-negotiable)

- Every number in an answer is computed by a tool from stored rows.
- Every answer cites its sources (keywords, definitions, relations, assets, dataset rows, metrics).
- Missing data is stated explicitly ("cannot compute unpaid income: no payment_status column on any dataset linked to Payment").
- Forecasts require sufficient history, always show assumptions and uncertainty, and are labeled separately from facts.
- Retrieval is permission-aware: no user ever receives content their role cannot access.
- Company meaning is versioned: definitions, relations, metrics, and reports keep history.

## Difference from traditional RAG

| Traditional RAG | This product |
|---|---|
| Chunk + embed documents | Structured company ontology first, documents as evidence |
| Similarity search routes context | Keyword graph routes context; embeddings assist |
| LLM answers from chunks | LLM plans; tools compute; answer assembled from grounded parts |
| Numbers come from the model | Numbers come from the structured data engine |
| No notion of meaning drift | Versioned definitions, relations, metrics |
| Flat permissions | Org tenancy + RBAC + permission-aware retrieval |

## Current state (gap analysis of the existing prototype in this repo)

Already working (keep and evolve):
- Keyword CRUD + tree UI, definitions/explanations/examples/synonyms/rules, voice input via Whisper
- Typed keyword relations (14 types) with strength + bidirectionality
- Asset upload → text extraction → chunking → pgvector embeddings, hybrid retrieval RPCs (`match_chunks_hybrid`)
- Grounded analytics MVP: datasets/tables/columns/rows, tool-based aggregation with row-level evidence IDs, analytics chat
- AI-assisted keyword generation

Missing (this is the roadmap):
- **Multi-tenancy** — no organizations; all data global (M1)
- **Auth + RBAC** — no login, all APIs use service role unauthenticated (M1)
- **Audit logs, versioning** (M1 foundation, M2 keyword versions)
- Keyword type/status/completeness scoring (M2)
- Graph traversal context builder with depth limits + relevance (M3)
- Ingestion pipeline hardening: OCR, language detection, keyword suggestion on upload (M4)
- Semantic column mapping, validation, data quality engine (M5, M7)
- AI router with intent detection + permission-aware context assembly (M6)
- Metric catalog + computed metrics (M7)
- Report generator with exports (M8)
- Forecasting with confidence intervals (M9)
- Tasks/workflows (M10)
- Production hardening: rate limits, observability, backups (M11)

See `07-milestones.md` for the full plan.
