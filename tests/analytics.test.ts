import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTableQuery, comparePeriods, DatasetRow } from '../src/lib/analytics';

const rows: DatasetRow[] = [
  { id: 'r1', row_index: 1, data: { project: 'A', amount: 100, status: 'paid', date: '2026-01-15' } },
  { id: 'r2', row_index: 2, data: { project: 'A', amount: 200, status: 'unpaid', date: '2026-01-20' } },
  { id: 'r3', row_index: 3, data: { project: 'B', amount: 300, status: 'paid', date: '2026-02-10' } },
  { id: 'r4', row_index: 4, data: { project: 'B', amount: 400, status: 'paid', date: '2026-02-25' } },
];

test('sum with filter and evidence row ids', () => {
  const result = runTableQuery(rows, {
    filters: [{ field: 'status', op: 'eq', value: 'paid' }],
    metrics: [{ op: 'sum', field: 'amount', as: 'total' }],
  });
  assert.equal(result.rows[0].total, 800);
  assert.equal(result.stats.matched_rows, 3);
  assert.deepEqual([...result.evidence.used_row_ids].sort(), ['r1', 'r3', 'r4']);
});

test('group by with avg and count', () => {
  const result = runTableQuery(rows, {
    group_by: ['project'],
    metrics: [
      { op: 'avg', field: 'amount', as: 'avg_amount' },
      { op: 'count', as: 'n' },
    ],
    order_by: [{ field: 'project', direction: 'asc' }],
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].project, 'A');
  assert.equal(result.rows[0].avg_amount, 150);
  assert.equal(result.rows[1].n, 2);
});

test('comparePeriods computes delta and percent change', () => {
  const result = comparePeriods(rows, {
    date_field: 'date',
    metric: { op: 'sum', field: 'amount', as: 'total' },
    period_a: { from: '2026-02-01', to: '2026-02-28' },
    period_b: { from: '2026-01-01', to: '2026-01-31' },
  });
  assert.equal(result.period_a.value, 700);
  assert.equal(result.period_b.value, 300);
  assert.equal(result.delta, 400);
  assert.equal(result.pct_change, 133.33);
  assert.ok(result.evidence.period_a_row_ids.includes('r3'));
});

test('empty match returns null sum, zero count', () => {
  const result = runTableQuery(rows, {
    filters: [{ field: 'status', op: 'eq', value: 'nonexistent' }],
    metrics: [
      { op: 'sum', field: 'amount', as: 'total' },
      { op: 'count', as: 'n' },
    ],
  });
  assert.equal(result.rows[0].total, null);
  assert.equal(result.rows[0].n, 0);
});
