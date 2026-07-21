import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, getToolRuntime } from '../src/lib/ai/provider';

test('selects Groq when configured', () => {
  const previousProvider = process.env.AI_PROVIDER;
  const previousKey = process.env.GROQ_API_KEY;
  try {
    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'test-key';
    assert.equal(getProvider().name, 'groq');
  } finally {
    if (previousProvider == null) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousKey == null) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});

test('fails clearly when the selected provider has no key', () => {
  const previousProvider = process.env.AI_PROVIDER;
  const previousKey = process.env.GROQ_API_KEY;
  try {
    process.env.AI_PROVIDER = 'groq';
    delete process.env.GROQ_API_KEY;
    assert.throws(() => getProvider(), /GROQ_API_KEY is not configured/);
  } finally {
    if (previousProvider == null) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousKey == null) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});

test('uses Groq for the native analytics tool loop', () => {
  const previousProvider = process.env.AI_PROVIDER;
  const previousKey = process.env.GROQ_API_KEY;
  try {
    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'test-key';
    const runtime = getToolRuntime();
    assert.equal(runtime.provider, 'groq');
    assert.match(runtime.model, /gpt-oss-20b/);
  } finally {
    if (previousProvider == null) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousKey == null) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  }
});
