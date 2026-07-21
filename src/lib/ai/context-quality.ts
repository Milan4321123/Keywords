export interface ContextQualityInput {
  matchedKeywordCount: number;
  averageKeywordCompleteness: number;
  businessRuleCount: number;
  relationCount: number;
  tableCount: number;
  metricCount: number;
  taskCount: number;
  documentCount: number;
  businessObjectCount: number;
  factCount: number;
  sourcedFactCount: number;
  assertedFactCount: number;
  unresolvedFactConflicts: number;
  operationalRecordCount: number;
  openQualityErrors: number;
  openQualityWarnings: number;
  graphTruncated: boolean;
  latestRecordedAt: string | null;
}

export interface ContextQuality {
  score: number;
  grade: 'high' | 'medium' | 'low';
  strengths: string[];
  warnings: string[];
  latest_recorded_at: string | null;
  coverage: {
    keywords: number;
    relations: number;
    rules: number;
    tables: number;
    metrics: number;
    tasks: number;
    documents: number;
    business_objects: number;
    facts: number;
    operational_records: number;
  };
}

export function computeContextQuality(input: ContextQualityInput): ContextQuality {
  let score = 100;
  const strengths: string[] = [];
  const warnings: string[] = [];

  if (input.matchedKeywordCount === 0) {
    score -= 25;
    warnings.push('No exact company concept matched the question.');
  } else {
    strengths.push(`${input.matchedKeywordCount} relevant company concepts loaded.`);
  }
  const completeness = Math.max(0, Math.min(100, input.averageKeywordCompleteness));
  score -= Math.round((100 - completeness) * 0.2);
  if (completeness < 50 && input.matchedKeywordCount > 0) {
    warnings.push('Relevant concept definitions are incomplete.');
  }
  if (input.businessRuleCount === 0) {
    score -= 7;
    warnings.push('No approved business rules were found in this context.');
  } else {
    strengths.push(`${input.businessRuleCount} approved operating rules included.`);
  }
  if (input.tableCount > 0 && input.metricCount === 0) {
    score -= 12;
    warnings.push('Structured data exists but no registered metric definition covers it.');
  } else if (input.metricCount > 0) {
    strengths.push(`${input.metricCount} registered metric definitions available.`);
  }
  if (input.documentCount === 0 && input.sourcedFactCount === 0) {
    score -= 15;
    warnings.push('No document evidence or explicitly sourced business facts were retrieved.');
  } else {
    strengths.push('Traceable source evidence is available.');
  }
  if (input.factCount > 0 && input.sourcedFactCount < input.factCount) {
    score -= Math.min(12, (input.factCount - input.sourcedFactCount) * 3);
    warnings.push(`${input.factCount - input.sourcedFactCount} current facts have no source reference.`);
  }
  if (input.assertedFactCount > 0) {
    score -= Math.min(10, input.assertedFactCount * 2);
    warnings.push(`${input.assertedFactCount} current facts are asserted but not verified.`);
  }
  if (input.unresolvedFactConflicts > 0) {
    score -= Math.min(20, 8 + input.unresolvedFactConflicts * 4);
    warnings.push(`${input.unresolvedFactConflicts} business facts have conflicting current values.`);
  }
  if (input.openQualityErrors > 0) {
    score -= Math.min(20, 8 + input.openQualityErrors * 3);
    warnings.push(`${input.openQualityErrors} open data-quality errors affect this context.`);
  }
  if (input.openQualityWarnings > 0) {
    score -= Math.min(10, input.openQualityWarnings * 2);
    warnings.push(`${input.openQualityWarnings} open data-quality warnings affect this context.`);
  }
  if (input.graphTruncated) {
    score -= 5;
    warnings.push('The related-concept graph reached its context limit.');
  }
  if (input.operationalRecordCount > 0) {
    strengths.push(`${input.operationalRecordCount} current operational records included.`);
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    grade: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
    strengths: strengths.slice(0, 5),
    warnings,
    latest_recorded_at: input.latestRecordedAt,
    coverage: {
      keywords: input.matchedKeywordCount,
      relations: input.relationCount,
      rules: input.businessRuleCount,
      tables: input.tableCount,
      metrics: input.metricCount,
      tasks: input.taskCount,
      documents: input.documentCount,
      business_objects: input.businessObjectCount,
      facts: input.factCount,
      operational_records: input.operationalRecordCount,
    },
  };
}
