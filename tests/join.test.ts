import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinTables, runTableQuery, DatasetRow } from '../src/lib/analytics';

const sales: DatasetRow[] = [
  { id: 's1', row_index: 1, data: { item_code: 'PIZ-MARG', quantity: 10, net_revenue_eur: 139.3 } },
  { id: 's2', row_index: 2, data: { item_code: 'DES-TIRA', quantity: 5, net_revenue_eur: 36.9 } },
  { id: 's3', row_index: 3, data: { item_code: 'UNKNOWN', quantity: 2, net_revenue_eur: 20 } },
];

const economics: DatasetRow[] = [
  { id: 'e1', row_index: 1, data: { item_code: 'piz-marg', recipe_cost_eur: 3.42, contribution_margin_eur: 10.51 } },
  { id: 'e2', row_index: 2, data: { item_code: 'DES-TIRA', recipe_cost_eur: 2.6, contribution_margin_eur: 4.78 } },
];

test('inner join matches case-insensitively and prefixes right fields', () => {
  const { rows, stats } = joinTables(sales, economics, {
    left_key: 'item_code',
    right_key: 'item_code',
  });
  assert.equal(stats.left_rows, 3);
  assert.equal(stats.matched, 2);
  assert.equal(rows.length, 2); // UNKNOWN dropped on inner join
  assert.equal(rows[0].data.r_recipe_cost_eur, 3.42);
  // evidence ids stay with the left rows
  assert.deepEqual(rows.map((r) => r.id), ['s1', 's2']);
});

test('left join keeps unmatched rows with null right fields', () => {
  const { rows, stats } = joinTables(sales, economics, {
    left_key: 'item_code',
    right_key: 'item_code',
    join_type: 'left',
  });
  assert.equal(rows.length, 3);
  assert.equal(stats.unmatched, 1);
  const unknown = rows.find((r) => r.data.item_code === 'UNKNOWN')!;
  assert.equal(unknown.data.r_recipe_cost_eur, null);
});

test('aggregation over joined rows: total recipe cost of sold items', () => {
  // Cross-table math the single-table engine could never do:
  // sum(quantity × unit cost) requires the per-row multiplication…
  // …but sum of the joined cost column per sale line works directly:
  const { rows } = joinTables(sales, economics, { left_key: 'item_code', right_key: 'item_code' });
  const result = runTableQuery(rows, {
    metrics: [{ op: 'sum', field: 'r_contribution_margin_eur', as: 'total_margin_per_line' }],
  });
  assert.equal(result.rows[0].total_margin_per_line, 10.51 + 4.78);
  assert.ok(result.evidence.used_row_ids.includes('s1'));
});

test('group by person over a joined task log (skill-matrix shape)', () => {
  const taskLog: DatasetRow[] = [
    { id: 't1', row_index: 1, data: { person: 'Ali', subtask: 'Fliesen' } },
    { id: 't2', row_index: 2, data: { person: 'Ali', subtask: 'Fliesen' } },
    { id: 't3', row_index: 3, data: { person: 'Ali', subtask: 'Putz' } },
    { id: 't4', row_index: 4, data: { person: 'Ben', subtask: 'Putz' } },
  ];
  const result = runTableQuery(taskLog, {
    group_by: ['person', 'subtask'],
    metrics: [{ op: 'count', as: 'times_done' }],
    order_by: [{ field: 'times_done', direction: 'desc' }],
  });
  assert.equal(result.rows[0].person, 'Ali');
  assert.equal(result.rows[0].subtask, 'Fliesen');
  assert.equal(result.rows[0].times_done, 2);
  assert.equal(result.rows.length, 3);
});
