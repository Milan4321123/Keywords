import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMetricValues } from '../src/lib/metrics/compare';

test('computes deterministic difference, percentage, and ratio', () => {
  assert.deepEqual(compareMetricValues(827300, 770000, ['difference', 'percent_difference', 'ratio']), {
    difference: 57300,
    percent_difference: 7.441558,
    ratio: 1.074416,
  });
});

test('returns null for division by zero and unavailable metrics', () => {
  assert.deepEqual(compareMetricValues(10, 0, ['percent_difference', 'ratio']), {
    percent_difference: null,
    ratio: null,
  });
  assert.deepEqual(compareMetricValues(null, 5, ['difference']), { difference: null });
});

