import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DO_SHIT_STATE_DIR = mkdtempSync(join(tmpdir(), 'doshit-qa-'));
const M = await import('../lib/merge.mjs');

function mkRun(mode) {
  return {
    run_id: `qa-${mode}`, mode, dry_run: true, phase: 'qa', pending: {}, flags: {}, tracker: 'clickup',
    items: [
      { id: 'P', ref: 'CU-P', title: 'Parent', leaf: false, status_history: [] },
      { id: 'A', ref: 'CU-A', title: 'Widgets', leaf: true, parent: 'P', acceptance_criteria: ['x'], plan: { summary: 's' }, pr: { number: 1, url: 'u' }, status_history: [] },
    ],
    merge_plan: [{ leaf: 'A', pr: 1, state: 'merged' }],
    qa: { enabled: true, env: 'local', base_url: 'http://localhost:3000', signed_in: true, items: {} },
  };
}

const ctx = (regressionP) => ({
  spawnQa: (run, role, item, { extra }) => ({ action: 'spawn', role, leaf: item.id, extra }),
  jevAsk: async () => ({ degraded: false, answers: { failure_is_regression_of_item: { type: 'noul', noul: regressionP } } }),
});

const steps = [
  { action: 'open /widgets', expected: 'list', actual: 'list', result: 'pass', screenshot: '/s/1.png' },
  { action: 'click add', expected: 'form', actual: '500 error', result: 'fail', screenshot: '/s/2.png' },
];

test('QA: planner -> tester (one at a time) -> regression files bug child + reopens', async () => {
  const run = mkRun('live');
  let a = await M.nextMergeQa(run, ctx(0.9));
  assert.equal(a[0].role, 'qa-planner');
  M.recordQa(run, run.items[1], 'qa-planner', { plan: { test_plan: ['open /widgets', 'click add'] } });
  a = await M.nextMergeQa(run, ctx(0.9));
  assert.equal(a[0].role, 'qa-tester');
  assert.match(a[0].extra, /1\. open \/widgets/);
  M.recordQa(run, run.items[1], 'qa-tester', { verdict: 'fail', summary: 's', qa: { env: 'local', sha: 'abc', steps, walkthrough: 'how it works' } });
  a = await M.nextMergeQa(run, ctx(0.9));
  const t = a[0];
  assert.equal(t.action, 'tracker');
  assert.deepEqual(t.ops.map((o) => o.op), ['attach', 'comment', 'status', 'create_child']);
  assert.equal(t.ops.find((o) => o.op === 'status').to_type, 'reopened');
  assert.deepEqual(t.ops[0].files, ['/s/1.png', '/s/2.png']);
});

test('QA: non-regression failure is noted only; item done', async () => {
  const run = mkRun('live');
  await M.nextMergeQa(run, ctx(0.1));
  M.recordQa(run, run.items[1], 'qa-planner', { plan: { test_plan: ['a'] } });
  await M.nextMergeQa(run, ctx(0.1));
  M.recordQa(run, run.items[1], 'qa-tester', { verdict: 'fail', summary: 's', qa: { steps } });
  const a = await M.nextMergeQa(run, ctx(0.1));
  assert.ok(!a[0].ops.some((o) => o.op === 'create_child'));
  assert.equal(a[0].ops.find((o) => o.op === 'status').to_type, 'done');
});

test('QA: shadow mode treats every failure as a regression (conservative)', async () => {
  const run = mkRun('shadow');
  await M.nextMergeQa(run, ctx(0.1));
  M.recordQa(run, run.items[1], 'qa-planner', { plan: { test_plan: ['a'] } });
  await M.nextMergeQa(run, ctx(0.1));
  M.recordQa(run, run.items[1], 'qa-tester', { verdict: 'fail', summary: 's', qa: { steps } });
  const a = await M.nextMergeQa(run, ctx(0.1));
  assert.ok(a[0].ops.some((o) => o.op === 'create_child'));
});
