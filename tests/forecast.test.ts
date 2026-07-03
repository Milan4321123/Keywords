import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastSeries, nextPeriod, MIN_HISTORY_POINTS } from '../src/lib/forecasting/forecast';

test('refuses to forecast with too little history', () => {
  const result = forecastSeries(
    [
      { period: '2026-01', value: 100 },
      { period: '2026-02', value: 110 },
    ],
    3
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', new RegExp(String(MIN_HISTORY_POINTS)));
  assert.equal(result.forecasts.length, 0);
});

test('projects a linear trend with ordered intervals and assumptions', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({
    period: `2026-${String(i + 1).padStart(2, '0')}`,
    value: 100 + i * 10,
  }));
  const result = forecastSeries(history, 3);
  assert.equal(result.ok, true);
  assert.equal(result.forecasts.length, 3);
  assert.equal(result.forecasts[0].period, '2026-09');
  // Perfectly linear input → forecast continues the line
  assert.ok(Math.abs(result.forecasts[0].value - 180) < 0.01);
  for (const point of result.forecasts) {
    assert.ok(point.lower <= point.value && point.value <= point.upper);
  }
  assert.ok(result.assumptions.length >= 3);
});

test('nextPeriod handles month, quarter, and year rollovers', () => {
  assert.equal(nextPeriod('2026-12', 1), '2027-01');
  assert.equal(nextPeriod('2026-11', 3), '2027-02');
  assert.equal(nextPeriod('2026-Q4', 1), '2027-Q1');
  assert.equal(nextPeriod('2026', 2), '2028');
  assert.equal(nextPeriod('2026-12-31', 1), '2027-01-01');
});
