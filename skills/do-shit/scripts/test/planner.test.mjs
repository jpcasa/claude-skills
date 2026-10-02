import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, cluster, dependencies, topoOrder, mergeOrder, estimateSpawns } from '../lib/planner.mjs';
import { gate, normalizeCi } from '../lib/merge.mjs';

const leaf = (id, extra = {}) => ({ id, ref: id, roles: ['investigator', 'worker', 'tester'], plan: { files: [], depends_on: [] }, links: {}, ...extra });

test('clustering is transitive above threshold', () => {
  const c = cluster(['a', 'b', 'c', 'd'], { 'a|b': 0.9, 'b|c': 0.8, 'c|d': 0.1, 'a|d': 0.2 }, 0.5);
  assert.deepEqual(c.map((x) => [...x].sort()), [['a', 'b', 'c'], ['d']]);
});

test('dependency needs evidence; jev alone is not enough; live needs jev agreement', () => {
  const leaves = [leaf('A'), leaf('B', { plan: { files: [], depends_on: ['A'] } }), leaf('C')];
  const jev = { 'A>B': 0.9, 'A>C': 0.95 }; // C has no evidence
  const live = dependencies(leaves, jev, 'live', 0.6);
  assert.deepEqual(live, [['A', 'B']]);
  const liveLow = dependencies(leaves, { 'A>B': 0.2 }, 'live', 0.6);
  assert.deepEqual(liveLow, []);
  const shadow = dependencies(leaves, {}, 'shadow', 0.6);
  assert.deepEqual(shadow, [['A', 'B']]);
  const linked = dependencies([leaf('A'), leaf('B', { links: { blocked_by: ['A'] } })], {}, 'shadow', 0.6);
  assert.deepEqual(linked, [['A', 'B']]);
});

test('topo order and cycle detection', () => {
  assert.deepEqual(topoOrder(['a', 'b', 'c'], [['c', 'a']]).order, ['b', 'c', 'a']);
  const t = topoOrder(['a', 'b', 'c'], [['c', 'a']]);
  assert.ok(t.order.indexOf('c') < t.order.indexOf('a'));
  const cyc = topoOrder(['a', 'b'], [['a', 'b'], ['b', 'a']]);
  assert.ok(cyc.cycle.length > 0);
});

test('computePlan: dependent leaves share a team, stacked in order; independent leaves split', () => {
  const leaves = [leaf('A'), leaf('B', { plan: { files: [], depends_on: ['A'] } }), leaf('C')];
  const p = computePlan({ leaves, overlap: {}, jevDeps: {}, mode: 'shadow' });
  const teamAB = p.teams.find((t) => t.leaves.includes('A'));
  assert.deepEqual(teamAB.leaves, ['A', 'B']);
  assert.equal(p.stacks.B, 'A');
  assert.ok(p.teams.find((t) => t.leaves.includes('C')).leaves.length === 1);
  assert.equal(p.warnings.length, 0);
});

test('computePlan: cycle edges dropped with a warning', () => {
  const leaves = [leaf('A', { plan: { files: [], depends_on: ['B'] } }), leaf('B', { plan: { files: [], depends_on: ['A'] } })];
  const p = computePlan({ leaves, overlap: {}, jevDeps: {}, mode: 'shadow' });
  assert.deepEqual(p.stacks, {});
  assert.match(p.warnings[0], /cycle/);
});

test('spawn estimate for 3 leaves', () => {
  const leaves = [leaf('A'), leaf('B', { roles: ['investigator', 'worker', 'tester', 'designer', 'auditor'] }), leaf('C')];
  // (2+2) + (4+2) + (2+2) = 14
  assert.equal(estimateSpawns(leaves), 14);
});

test('merge order: stack parents first, then lowest overlap first', () => {
  const plan = { stacks: { B: 'A' }, overlap: { 'A|C': 0.9, 'B|C': 0.8, 'A|D': 0.1 } };
  const o = mergeOrder(['B', 'C', 'A', 'D'], plan);
  assert.ok(o.indexOf('A') < o.indexOf('B'));
  assert.equal(o[0], 'D');
});

test('gate outcomes', () => {
  const base = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', ci: 'green', failed: [], reviewDecision: null, comments: [] };
  const e = { reran: false, picked_draft: false };
  const live = (a) => ({ degraded: false, answers: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { type: 'noul', noul: v }])) });
  assert.equal(gate(base, null, e, 'live').decision, 'merge');
  assert.equal(gate({ ...base, mergeable: 'CONFLICTING' }, null, e, 'live').fix, 'conflict');
  assert.equal(gate({ ...base, ci: 'red', failed: [{ name: 'test' }] }, live({ ci_failure_unrelated_to_pr: 0.9 }), e, 'live').decision, 'rerun');
  assert.equal(gate({ ...base, ci: 'red', failed: [{ name: 'test' }] }, live({ ci_failure_unrelated_to_pr: 0.9 }), { ...e, reran: true }, 'live').fix, 'ci');
  assert.equal(gate({ ...base, isDraft: true }, null, e, 'live').decision, 'skip');
  assert.equal(gate({ ...base, isDraft: true }, null, { ...e, picked_draft: true }, 'live').decision, 'merge');
  // degraded/shadow: ambiguity never merges
  assert.equal(gate({ ...base, ci: 'red', failed: [{ name: 't' }] }, { degraded: true, answers: {} }, e, 'degraded').decision, 'fix');
  assert.equal(gate({ ...base, comments: [{ body: 'nit' }] }, null, e, 'shadow').decision, 'skip');
  assert.equal(gate({ ...base, comments: [{ body: 'nit' }] }, live({ open_review_comments_blocking: 0.1 }), e, 'live').decision, 'merge');
  assert.equal(gate({ ...base, ci: 'pending' }, null, e, 'live').decision, 'defer');
  assert.equal(gate({ ...base, mergeStateStatus: 'BLOCKED' }, null, e, 'live').decision, 'skip');
});

test('normalizeCi', () => {
  assert.equal(normalizeCi([{ name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' }]).ci, 'green');
  assert.equal(normalizeCi([{ name: 'a', status: 'IN_PROGRESS' }]).ci, 'pending');
  assert.equal(normalizeCi([{ name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' }, { context: 'b', state: 'PENDING' }]).ci, 'red');
  assert.equal(normalizeCi([]).ci, 'none');
});

test('eval sweep picks best-F1 threshold', async () => {
  const { sweep } = await import('../eval/run.mjs');
  const pts = [{ p: 0.9, y: true }, { p: 0.7, y: true }, { p: 0.55, y: false }, { p: 0.2, y: false }];
  const b = sweep(pts);
  assert.equal(b.f1, 1);
  assert.ok(b.threshold > 0.55 && b.threshold <= 0.7, String(b.threshold));
});
