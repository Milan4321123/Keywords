import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTable, QualityColumn, QualityRow } from '../src/lib/datasets/quality';

const columns: QualityColumn[] = [
  { name: 'Invoice Number', normalized_name: 'invoice_number', data_type: 'text', semantic_name: 'identifier' },
  { name: 'Amount', normalized_name: 'amount', data_type: 'number', semantic_name: 'amount', is_required: true },
  { name: 'Status', normalized_name: 'status', data_type: 'text', semantic_name: 'status' },
];

const rows: QualityRow[] = [
  { id: 'a', row_index: 1, data: { invoice_number: 'INV-1', amount: 100, status: 'Paid' } },
  { id: 'b', row_index: 2, data: { invoice_number: 'INV-1', amount: -50, status: 'paid' } },
  { id: 'c', row_index: 3, data: { invoice_number: 'INV-2', amount: null, status: 'unpaid' } },
  { id: 'd', row_index: 4, data: { invoice_number: 'INV-3', amount: 100, status: 'Paid' } },
];

test('detects duplicate identifiers as errors', () => {
  const issues = validateTable(columns, rows);
  const dupe = issues.find((i) => i.issue_type === 'duplicate_identifier');
  assert.ok(dupe);
  assert.equal(dupe!.severity, 'error');
  assert.equal(dupe!.column, 'invoice_number');
});

test('detects missing required values as errors', () => {
  const issues = validateTable(columns, rows);
  const missing = issues.find((i) => i.issue_type === 'missing_values' && i.column === 'amount');
  assert.ok(missing);
  assert.equal(missing!.severity, 'error');
  assert.equal(missing!.affected_count, 1);
});

test('detects negative amounts and inconsistent status spellings', () => {
  const issues = validateTable(columns, rows);
  assert.ok(issues.some((i) => i.issue_type === 'negative_amount'));
  const status = issues.find((i) => i.issue_type === 'inconsistent_status');
  assert.ok(status);
  assert.match(status!.description, /Paid/);
});

test('clean table produces no issues', () => {
  const clean: QualityRow[] = [
    { id: 'x', row_index: 1, data: { invoice_number: 'A-1', amount: 10, status: 'paid' } },
    { id: 'y', row_index: 2, data: { invoice_number: 'A-2', amount: 20, status: 'paid' } },
  ];
  assert.equal(validateTable(columns, clean).length, 0);
});
