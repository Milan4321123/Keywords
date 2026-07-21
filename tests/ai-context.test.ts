import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPotentialKeywords } from '../src/lib/ai-context';
import { Keyword } from '../src/types';

function keyword(overrides: Partial<Keyword>): Keyword {
  return {
    id: 'keyword-1',
    title: 'Project Atlas',
    slug: 'project-atlas',
    parent_id: null,
    definition: null,
    explanation: null,
    examples: [],
    synonyms: [],
    labels_json: {},
    rules: [],
    icon: null,
    color: null,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    organization_id: 'org-1',
    keyword_type: 'concept',
    status: 'active',
    completeness_score: 0,
    owner_member_id: null,
    access_level: 'worker',
    ...overrides,
  } as Keyword;
}

test('keyword matching ignores non-text label metadata', () => {
  const result = extractPotentialKeywords('Give me the Project Atlas status', [
    keyword({ labels_json: { project: 'atlas', seeded: true } as any }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Project Atlas');
});
