import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocaleNumber, validateAndCoerce } from '../src/lib/capture';
import { CaptureField } from '../src/lib/capture-types';

test('parses German and English currency formats without losing magnitude', () => {
  assert.equal(parseLocaleNumber('1.234,56'), 1234.56);
  assert.equal(parseLocaleNumber('€ 1.234,56'), 1234.56);
  assert.equal(parseLocaleNumber('EUR 1.234,56'), 1234.56);
  assert.equal(parseLocaleNumber('1,234.56 USD'), 1234.56);
  assert.equal(parseLocaleNumber("1'234.56"), 1234.56);
  assert.equal(parseLocaleNumber('(1.234,56 €)'), -1234.56);
});

test('parses ordinary decimals and rejects mixed text', () => {
  assert.equal(parseLocaleNumber('12,5'), 12.5);
  assert.equal(parseLocaleNumber('12.5'), 12.5);
  assert.equal(parseLocaleNumber('1.234'), 1234);
  assert.equal(parseLocaleNumber('0.125'), 0.125);
  assert.equal(parseLocaleNumber('twelve euros'), null);
  assert.equal(parseLocaleNumber('12.3.4'), null);
});

test('coercion applies numeric bounds after locale parsing', () => {
  const field: CaptureField = {
    field: 'amount',
    label: 'Betrag',
    data_type: 'number',
    semantic: 'amount',
    required: true,
    description: null,
    options: null,
    min: 0,
    max: 2000,
    auto: null,
  };

  const valid = validateAndCoerce([field], { amount: '1.234,56 €' }, {
    userEmail: 'worker@example.com',
    evidenceReference: null,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.amount, 1234.56);

  const tooHigh = validateAndCoerce([field], { amount: '2.500,00 €' }, {
    userEmail: 'worker@example.com',
    evidenceReference: null,
  });
  assert.equal(tooHigh.ok, false);
  assert.match(tooHigh.errors[0], /≤ 2000/);
});
