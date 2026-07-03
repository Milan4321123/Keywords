import { AIProvider } from './provider';

export type Intent = 'definition' | 'analysis' | 'report' | 'forecast' | 'workflow' | 'search';

const HEURISTICS: Array<{ intent: Intent; pattern: RegExp }> = [
  { intent: 'forecast', pattern: /\b(forecast|predict|projection|next (month|quarter|year)|expect(ed)? (revenue|income|sales)|prognose)\b/i },
  { intent: 'report', pattern: /\b(report|zusammenfassung|monthly summary|weekly summary|executive summary|generate .{0,20}(report|overview))\b/i },
  { intent: 'workflow', pattern: /\b(task|todo|blocked|next step|checklist|workflow|who (should|needs to)|what (should|do) (i|we) do)\b/i },
  { intent: 'analysis', pattern: /\b(how (much|many)|total|sum|average|avg|count|compare|trend|top \d+|highest|lowest|revenue|income|expense|umsatz|cost|per (month|project|customer)|percentage|%)\b/i },
  { intent: 'definition', pattern: /\b(what is|what does .{0,30} mean|define|definition of|meaning of|explain (the )?(term|concept)|was ist|was bedeutet)\b/i },
];

/**
 * Intent detection: cheap regex heuristics first; ambiguous questions fall
 * back to a fast-model classification.
 */
export async function detectIntent(question: string, provider: AIProvider): Promise<Intent> {
  const matches = HEURISTICS.filter((h) => h.pattern.test(question));
  if (matches.length === 1) return matches[0].intent;
  // Forecast/report phrasing usually also matches analysis words — they win.
  if (matches.length > 1) {
    const priority: Intent[] = ['forecast', 'report', 'workflow', 'analysis', 'definition'];
    for (const intent of priority) {
      if (matches.some((m) => m.intent === intent)) return intent;
    }
  }

  try {
    const raw = await provider.chat(
      [
        {
          role: 'system',
          content:
            'Classify the user question for a company knowledge platform. Return ONLY JSON: {"intent": "definition" | "analysis" | "report" | "forecast" | "workflow" | "search"}. ' +
            'definition = asking what a concept means; analysis = numeric/data question; report = wants a structured summary document; forecast = future prediction; workflow = tasks/process steps; search = looking for documents/facts.',
        },
        { role: 'user', content: question.slice(0, 500) },
      ],
      { tier: 'fast', json: true, temperature: 0, maxTokens: 50 }
    );
    const parsed = JSON.parse(raw);
    const valid: Intent[] = ['definition', 'analysis', 'report', 'forecast', 'workflow', 'search'];
    if (valid.includes(parsed.intent)) return parsed.intent;
  } catch {
    // fall through
  }
  return 'search';
}

/** Map router intents to graph-traversal intents (relation-type allowlists). */
export function traversalIntentFor(intent: Intent): 'analysis' | 'workflow' | 'definition' | 'general' {
  if (intent === 'analysis' || intent === 'forecast' || intent === 'report') return 'analysis';
  if (intent === 'workflow') return 'workflow';
  if (intent === 'definition') return 'definition';
  return 'general';
}

/** Does this intent need the structured data engine? */
export function needsStructuredData(intent: Intent): boolean {
  return intent === 'analysis' || intent === 'forecast' || intent === 'report';
}
