import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCompleteness } from '../src/lib/ontology/completeness';

test('empty keyword scores 0 with all gaps listed', () => {
  const { score, missing } = computeCompleteness({});
  assert.equal(score, 0);
  assert.ok(missing.includes('No definition'));
  assert.ok(missing.includes('No relations to other keywords'));
  assert.ok(missing.includes('No attached evidence'));
});

test('fully documented keyword scores 100', () => {
  const { score, missing } = computeCompleteness({
    definition: 'A billing document from a supplier requesting payment.',
    explanation:
      'Invoices arrive from suppliers, must reference an order, and require approval before payment is released to the supplier.',
    examples: ['INV-1001 from Volt GmbH', 'INV-1002 from PipeWorks', 'INV-1003 from CoolAir'],
    synonyms: ['bill', 'Rechnung'],
    rules: ['Must have date, amount, and supplier'],
    relationCount: 2,
    assetCount: 1,
  });
  assert.equal(score, 100);
  assert.equal(missing.length, 0);
});

test('short definition earns partial credit', () => {
  const withShort = computeCompleteness({ definition: 'A bill.' });
  const withLong = computeCompleteness({ definition: 'A billing document requesting payment.' });
  assert.ok(withShort.score < withLong.score);
  assert.ok(withShort.missing.includes('Definition is very short'));
});
