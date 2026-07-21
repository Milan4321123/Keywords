import assert from 'node:assert/strict';
import test from 'node:test';
import { computeContextQuality } from '../src/lib/ai/context-quality';
import { compactContextSections } from '../src/lib/ai/context-builder';

const complete = {
  matchedKeywordCount: 7,
  averageKeywordCompleteness: 90,
  businessRuleCount: 12,
  relationCount: 9,
  tableCount: 4,
  metricCount: 10,
  taskCount: 10,
  documentCount: 3,
  businessObjectCount: 1,
  factCount: 8,
  sourcedFactCount: 8,
  assertedFactCount: 0,
  unresolvedFactConflicts: 0,
  operationalRecordCount: 18,
  openQualityErrors: 0,
  openQualityWarnings: 0,
  graphTruncated: false,
  latestRecordedAt: '2026-07-21T00:00:00Z',
};

test('high-quality context reports traceable strengths', () => {
  const result = computeContextQuality(complete);
  assert.equal(result.grade, 'high');
  assert.ok(result.score >= 90);
  assert.equal(result.coverage.metrics, 10);
  assert.ok(result.strengths.some((value) => value.includes('source evidence')));
});

test('missing scope, rules, evidence, and metric definitions lower confidence', () => {
  const result = computeContextQuality({
    ...complete,
    matchedKeywordCount: 0,
    averageKeywordCompleteness: 0,
    businessRuleCount: 0,
    tableCount: 2,
    metricCount: 0,
    documentCount: 0,
    factCount: 0,
    sourcedFactCount: 0,
    operationalRecordCount: 0,
    openQualityErrors: 2,
  });
  assert.equal(result.grade, 'low');
  assert.ok(result.warnings.length >= 4);
});

test('context compaction preserves schemas and metrics ahead of oversized ontology text', () => {
  const result = compactContextSections([
    '## Company Ontology\n' + 'definition '.repeat(2000),
    '## Available Structured Data\n- Table project_control with status and owner',
    '## Metric Catalog\n- Approved Budget: sum(budget_eur)',
    '## Current Operational Records\n- UAT blocked; owner=Elena',
  ], 2_500);
  assert.ok(result.length <= 2_500);
  assert.match(result, /Available Structured Data/);
  assert.match(result, /Metric Catalog/);
  assert.match(result, /UAT blocked/);
});
