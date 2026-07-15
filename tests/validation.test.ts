import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileSizeError, keywordPayloadError, MAX_UPLOAD_BYTES, MAX_AUDIO_BYTES } from '../src/lib/validation';

test('normal files pass the size check', () => {
  assert.equal(fileSizeError({ size: 1024 }), null);
  assert.equal(fileSizeError({ size: MAX_UPLOAD_BYTES }), null);
});

test('empty and oversized files are rejected with a message', () => {
  assert.match(fileSizeError({ size: 0 }) ?? '', /Empty file/);
  assert.match(fileSizeError({ size: MAX_UPLOAD_BYTES + 1 }) ?? '', /too large/i);
  assert.match(fileSizeError({ size: MAX_AUDIO_BYTES + 1 }, MAX_AUDIO_BYTES) ?? '', /max 20 MB/);
});

test('reasonable keyword payloads pass', () => {
  assert.equal(
    keywordPayloadError({
      title: 'Rechnung',
      definition: 'Ein Dokument, das eine Zahlungsforderung festhält.',
      examples: ['R-1001', 'R-1002'],
      rules: ['Zahlungsziel 14 Tage'],
      labels_json: { en: 'Invoice', it: 'Fattura' },
    }),
    null
  );
});

test('oversized text fields are rejected', () => {
  assert.match(keywordPayloadError({ title: 'x'.repeat(201) }) ?? '', /title/);
  assert.match(keywordPayloadError({ definition: 'x'.repeat(2001) }) ?? '', /definition/);
  assert.match(keywordPayloadError({ explanation: 'x'.repeat(10001) }) ?? '', /explanation/);
});

test('oversized lists and labels are rejected', () => {
  assert.match(keywordPayloadError({ examples: Array(51).fill('a') }) ?? '', /examples/);
  assert.match(keywordPayloadError({ rules: ['x'.repeat(501)] }) ?? '', /rules/);
  const labels: Record<string, string> = {};
  for (let i = 0; i < 21; i += 1) labels[`l${i}`] = 'x';
  assert.match(keywordPayloadError({ labels_json: labels }) ?? '', /labels/i);
});

test('non-string and missing fields are ignored by the size guard', () => {
  assert.equal(keywordPayloadError({}), null);
  assert.equal(keywordPayloadError({ examples: 'not-an-array', labels_json: null }), null);
});
