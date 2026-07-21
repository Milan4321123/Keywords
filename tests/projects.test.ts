import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectAttention, classifyProjectTable, isProjectKeyword } from '../src/lib/projects';

test('identifies explicitly labelled projects without treating all seeded concepts as projects', () => {
  assert.equal(isProjectKeyword({ id: '1', title: 'Atlas', slug: 'atlas', parent_id: null, labels_json: { is_project: true } }), true);
  assert.equal(isProjectKeyword({ id: '2', title: 'Atlas Risk', slug: 'atlas-risk', parent_id: '1', labels_json: { project: 'atlas' } }), false);
  assert.equal(isProjectKeyword({ id: '3', title: 'Project Phoenix', slug: 'project-phoenix', parent_id: null }), true);
});

test('classifies project control tables', () => {
  assert.equal(classifyProjectTable('Project Atlas Risk Register'), 'risk');
  assert.equal(classifyProjectTable('Decision Log'), 'decision');
  assert.equal(classifyProjectTable('project_atlas_control'), 'control');
});

test('attention list is grounded in blocked tasks, material risks, and open decisions', () => {
  const attention = buildProjectAttention(
    [{ id: 't1', title: 'UAT', status: 'blocked', priority: 'high', due_date: '2026-08-03' }],
    [
      { id: 'risk', name: 'Risk Register', rows: [{ title: 'Migration', status: 'open', exposure_eur: 56000, owner: 'David' }] },
      { id: 'dec', name: 'Decision Log', rows: [{ title: 'API semantics', status: 'open', impact: 'Blocks UAT' }] },
    ],
    new Date('2026-07-21T12:00:00Z')
  );
  assert.deepEqual(attention.map((item) => item.kind), ['blocker', 'risk', 'decision']);
  assert.equal(attention[1].owner, 'David');
});

