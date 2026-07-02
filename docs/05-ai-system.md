# AI Router, Context Builder, Skills, and Grounding

## System instructions (constitution for every AI call)

You are a company organizational intelligence AI. You answer ONLY from: keyword definitions, keyword relations, company documents, structured dataset results, metric definitions, workflow data, user-approved business rules. You must not invent company facts. When data is missing, say exactly what is missing. When calculations are needed, call tools. When prediction is needed, call forecasting tools and explain uncertainty. Always include: Answer, Data used, Keywords used, Calculations performed, Missing data, Recommended next action. Provide concise reasoning summaries only.

## Router (M6)

Input: `{ question, active_keyword?, org, member, history, available: {datasets, skills} }`

Stage 1 — intent classification (small/fast model call + heuristics):
`definition | analysis | report | forecast | workflow | search | data_quality`

Stage 2 — keyword routing:
1. Exact/synonym match against org keywords (SQL, cheap).
2. Embedding similarity over keyword name+definition (fallback).
3. Expand via relations with per-intent allowlists:
   - analysis → `calculated-from, measured-by, depends-on, part-of`
   - workflow → `requires, blocks, precedes, succeeds, depends-on`
   - definition → `is-a, part-of, related-to` (depth 1)
4. Depth ≤ 2, relevance score = relation strength × target completeness × recency of use; keep top N under a token budget.

Stage 3 — capability selection: does the intent need document retrieval? structured data? a registered skill? clarification (ambiguous keyword collision)?

## Context envelope (persisted to `ai_context_logs`)

```json
{
  "organization": {}, "user": {}, "question": "...",
  "intent": "analysis",
  "selected_keyword": {}, "relevant_keywords": [], "dependency_keywords": [],
  "business_rules": [], "metric_definitions": [],
  "assets": [], "structured_data_results": [],
  "workflow_context": [], "sources": [], "missing_data": [],
  "system_instructions": "Answer only from grounded company context and computed data."
}
```

Priority order when the token budget bites: selected keyword definition → business rules → dependency definitions → metric definitions → structured data results → document chunks → history.

## Tool execution model

The LLM plans tool calls; the server executes them (registry in `src/lib/ai/tools/`), injecting `orgContext` so the model can never widen scope. Numeric answers must reference a tool result id; the answer assembler rejects numbers with no provenance (regexp sweep over the draft vs. tool outputs — violations trigger one repair round, then the number is replaced with "unverified" and flagged).

## Skills (M6+)

A skill = named, permission-gated recipe: `{ keyword_id, skill_type, required_data, tools_used, prompt_template, output_schema }`. Router prefers a matching skill over free-form planning. Examples: Income → "Compare income by month" (tools: `query_table`, `compare_periods`); Task → "Find blocked tasks" (tool: `find_blocked_tasks`).

## Grounding & citations

Every answer stores and displays: keywords used (with version), definitions used, relations followed, chunks used (asset + index), dataset tables + row-id evidence (`used_row_ids` — already implemented in the analytics MVP), metrics computed (formula + inputs), missing data, assumptions. Prediction answers additionally: history length used, model, confidence interval, "forecast, not fact" label.

## Provider abstraction

`src/lib/ai/provider.ts`: `chat(messages, tools?, opts)`, `embed(texts)`, `transcribe(audio)`. Implementations: OpenAI (current), Anthropic (config-switchable). Model choice per stage: cheap model for routing/classification, strong model for planning/answering.
