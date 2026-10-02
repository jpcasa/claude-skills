import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickRoles, loopRoles, aggregate, nextLoopAction, scopeCheck, canMoveStatus, canSpawn,
  BUILD_ORDER, buildSequence,
} from '../lib/policy.mjs';
import { globMatch } from '../lib/glob.mjs';

const jevRoles = (p) => ({
  degraded: false,
  answers: Object.fromEntries(
    ['data-engineer', 'designer', 'content-creator', 'observability-engineer', 'docs-writer', 'test-engineer',
      'auditor', 'security-advisor', 'accessibility-auditor', 'performance-engineer']
      .map((r) => [`needs_${r}`, { type: 'noul', noul: p[r] ?? 0.1 }]),
  ),
});

const rep = (role, verdict, findings = []) => ({ role, verdict, findings, item: 'I', loop: 1, summary: '', files_touched: [], commits: [] });
const bug = (owner, blocking = true, text = 'x') => ({ severity: 'bug', blocking, owner_role: owner, text });

test('glob matcher', () => {
  assert.ok(globMatch('**', 'a/b/c.ts'));
  assert.ok(globMatch('**/*.test.*', 'src/a/b.test.ts'));
  assert.ok(globMatch('**/*.test.*', 'b.test.ts'));
  assert.ok(globMatch('docs/**', 'docs/x/y.md'));
  assert.ok(!globMatch('docs/**', 'src/docs.md'));
  assert.ok(globMatch('**/*.{tsx,css}', 'app/x.css'));
  assert.ok(globMatch('CHANGELOG*', 'CHANGELOG.md'));
  assert.ok(!globMatch('**/*.sql', 'a/b.ts'));
});

test('live: core always, jev over threshold, path rule forces security even at p=0.1', () => {
  const r = pickRoles({
    mode: 'live', jev: jevRoles({ designer: 0.9, 'performance-engineer': 0.3 }),
    planFiles: ['app/api/auth/session.ts', 'app/page.tsx'],
  });
  for (const c of ['investigator', 'worker', 'tester', 'designer', 'security-advisor']) assert.ok(r.roles.includes(c), c);
  assert.ok(!r.roles.includes('performance-engineer'));
  assert.match(r.reasons['security-advisor'], /path/);
});

test('path rules add migrations -> data-engineer; never remove a jev-picked role', () => {
  const r = pickRoles({ mode: 'live', jev: jevRoles({ 'docs-writer': 0.95 }), planFiles: ['db/migrations/0042_x.sql'] });
  assert.ok(r.roles.includes('data-engineer'));
  assert.ok(r.roles.includes('docs-writer'));
});

test('shadow: fallback decides (path rules + auditor), jev picks logged', () => {
  const r = pickRoles({ mode: 'shadow', jev: jevRoles({ designer: 0.99 }), planFiles: ['x.ts'] });
  assert.ok(!r.roles.includes('designer'));
  assert.ok(r.roles.includes('auditor'));
  assert.ok(r.shadow.jev_roles.includes('designer'));
});

test('degraded: path rules + auditor + core', () => {
  const r = pickRoles({ mode: 'degraded', jev: { degraded: true, answers: {} }, planFiles: ['supabase/rls/policy.sql'] });
  assert.deepEqual(
    [...r.roles].sort(),
    ['auditor', 'data-engineer', 'investigator', 'security-advisor', 'tester', 'worker'].sort(),
  );
});

test('build sequence follows fixed order', () => {
  assert.deepEqual(buildSequence(['tester', 'test-engineer', 'designer', 'worker', 'data-engineer']), ['data-engineer', 'worker', 'designer', 'test-engineer']);
  assert.equal(BUILD_ORDER[0], 'integrator');
  assert.equal(BUILD_ORDER[1], 'data-engineer');
});

test('aggregate: tester fail or blocking security finding => not passing', () => {
  assert.equal(aggregate([rep('tester', 'pass'), rep('auditor', 'pass')]).pass, true);
  assert.equal(aggregate([rep('tester', 'fail', [bug('worker')])]).pass, false);
  const a = aggregate([rep('tester', 'pass'), rep('security-advisor', 'blocked', [bug('worker')])]);
  assert.equal(a.pass, false);
  assert.equal(a.securityBlock, true);
  // non-blocking nit from a passing reviewer does not fail
  assert.equal(aggregate([rep('tester', 'pass'), rep('auditor', 'pass', [bug('worker', false)])]).pass, true);
});

test('never ship on failure even when jev says ship', () => {
  const agg = aggregate([rep('tester', 'fail', [bug('worker')])]);
  const jev = { degraded: false, answers: {
    same_failure_as_last_loop: { type: 'noul', noul: 0.1 }, plan_is_wrong: { type: 'noul', noul: 0.1 },
    next_action: { type: 'choice', choice: 'ship', confidence: 0.99 } } };
  const d = nextLoopAction({ loop: 1, maxLoops: 3, agg, jev, mode: 'live' });
  assert.equal(d.action, 'fix');
});

test('pass => ship', () => {
  assert.equal(nextLoopAction({ loop: 1, maxLoops: 3, agg: aggregate([rep('tester', 'pass')]), mode: 'live' }).action, 'ship');
});

test('cap: failing at loop 3 => draft_flagged, never loop 4', () => {
  const agg = aggregate([rep('tester', 'fail', [bug('worker')])]);
  assert.equal(nextLoopAction({ loop: 3, maxLoops: 3, agg, mode: 'live', jev: { degraded: true, answers: {} } }).action, 'draft_flagged');
});

test('live: stuck => draft_flagged early; plan wrong => replan', () => {
  const agg = aggregate([rep('tester', 'fail', [bug('worker')])]);
  const mk = (same, wrong) => ({ degraded: false, answers: {
    same_failure_as_last_loop: { type: 'noul', noul: same }, plan_is_wrong: { type: 'noul', noul: wrong },
    next_action: { type: 'choice', choice: 'fix', confidence: 0.9 } } });
  assert.equal(nextLoopAction({ loop: 2, maxLoops: 3, agg, jev: mk(0.95, 0.1), mode: 'live' }).action, 'draft_flagged');
  assert.equal(nextLoopAction({ loop: 1, maxLoops: 3, agg, jev: mk(0.1, 0.9), mode: 'live' }).action, 'replan');
  // stuck detection needs a previous loop
  assert.equal(nextLoopAction({ loop: 1, maxLoops: 3, agg, jev: mk(0.95, 0.1), mode: 'live' }).action, 'fix');
});

test('shadow: fallback fix, jev decision logged', () => {
  const agg = aggregate([rep('tester', 'fail', [bug('worker')])]);
  const jev = { degraded: false, answers: {
    same_failure_as_last_loop: { type: 'noul', noul: 0.1 }, plan_is_wrong: { type: 'noul', noul: 0.95 },
    next_action: { type: 'choice', choice: 'replan', confidence: 0.9 } } };
  const d = nextLoopAction({ loop: 1, maxLoops: 3, agg, jev, mode: 'shadow' });
  assert.equal(d.action, 'fix');
  assert.equal(d.shadow.jev_action, 'replan');
});

test('loop 2+ roles: owners of failures + failed reviewers + tester', () => {
  const agg = aggregate([
    rep('tester', 'fail', [bug('worker')]),
    rep('accessibility-auditor', 'fail', [bug('designer')]),
    rep('auditor', 'pass'),
    rep('security-advisor', 'pass', [bug('tester', true, 'owner is a reviewer')]),
  ]);
  const roles = loopRoles(agg);
  assert.deepEqual([...roles].sort(), ['accessibility-auditor', 'designer', 'tester', 'worker'].sort());
});

test('scope check', () => {
  assert.deepEqual(scopeCheck({ role: 'tester', readOnly: true, changedFiles: [], dirty: false }).ok, true);
  assert.equal(scopeCheck({ role: 'tester', readOnly: true, changedFiles: [], dirty: true }).ok, false);
  assert.equal(scopeCheck({ role: 'auditor', readOnly: true, changedFiles: ['a.ts'], dirty: false }).ok, false);
  const c = scopeCheck({ role: 'docs-writer', readOnly: false, allowedPaths: ['docs/**', '**/*.md'], changedFiles: ['docs/a.md', 'src/x.ts'], dirty: false });
  assert.equal(c.ok, false);
  assert.deepEqual(c.outside, ['src/x.ts']);
  assert.equal(scopeCheck({ role: 'worker', readOnly: false, allowedPaths: ['**'], changedFiles: ['a/b.ts'], dirty: true }).ok, false);
});

test('status never moves backward; reopen only from qa/done', () => {
  assert.equal(canMoveStatus('open', 'in_progress'), true);
  assert.equal(canMoveStatus('review', 'in_progress'), false);
  assert.equal(canMoveStatus('done', 'review'), false);
  assert.equal(canMoveStatus('review', 'review'), false);
  assert.equal(canMoveStatus('qa', 'reopened'), true);
  assert.equal(canMoveStatus('review', 'reopened'), false);
  assert.equal(canMoveStatus(null, 'in_progress'), true);
});

test('spawn cap', () => {
  assert.equal(canSpawn({ spawns_used: 58, spawn_cap: 60 }, 2), true);
  assert.equal(canSpawn({ spawns_used: 59, spawn_cap: 60 }, 2), false);
});
