import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'doshit-state-'));
process.env.DO_SHIT_STATE_DIR = dir;
const { validate } = await import('../lib/validate.mjs');
const S = await import('../lib/state.mjs');

const report = (over = {}) => ({
  role: 'tester', item: 'CU-1', loop: 1, verdict: 'fail', summary: 's',
  findings: [{ severity: 'bug', blocking: true, owner_role: 'worker', text: 't', file: 'a.ts', line: 3 }],
  files_touched: [], commits: [], ...over,
});

test('valid report passes', () => {
  assert.deepEqual(validate('report', report()), { ok: true, errors: [] });
});

test('missing verdict fails with path', () => {
  const r = report();
  delete r.verdict;
  const v = validate('report', r);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('$.verdict')), v.errors.join());
});

test('bad severity and missing owner_role fail with item paths', () => {
  const v = validate('report', report({ findings: [{ severity: 'meh', blocking: true, text: 't' }] }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('$.findings[0].severity')), v.errors.join());
  assert.ok(v.errors.some((e) => e.includes('$.findings[0].owner_role')), v.errors.join());
});

test('wrong primitive types fail', () => {
  const v = validate('report', report({ loop: '1', findings: 'x' }));
  assert.ok(v.errors.some((e) => e.includes('$.loop')));
  assert.ok(v.errors.some((e) => e.includes('$.findings')));
});

test('run state round-trips and validates', () => {
  const run = S.newRun({ repo: '/r/acme', base: 'main', tracker: 'clickup', dryRun: true });
  assert.match(run.run_id, /^acme--\d{8}-\d{4}-[a-z0-9]{4}$/);
  assert.equal(run.mode, 'shadow');
  S.saveRun(run);
  const back = S.loadRun(run.run_id);
  assert.deepEqual(back, run);
  assert.equal(validate('state', back).ok, true, validate('state', back).errors.join());
});

test('team state round-trips and validates', () => {
  const run = S.newRun({ repo: '/r/x', base: 'main', tracker: 'github' });
  S.saveRun(run);
  const team = S.newTeam(run.run_id, { leaves: ['#2', '#3'], roles: ['investigator', 'worker', 'tester'] });
  S.saveTeam(run.run_id, team);
  assert.deepEqual(S.loadTeam(run.run_id, team.team_id), team);
  assert.equal(validate('team', team).ok, true, validate('team', team).errors.join());
});

test('writes are atomic (no tmp files left) and events append as JSONL', () => {
  const run = S.newRun({ repo: '/r/y', base: 'main', tracker: 'linear' });
  S.saveRun(run);
  S.appendEvent(run.run_id, { type: 'a' });
  S.appendEvent(run.run_id, { type: 'b', n: 2 });
  const files = readdirSync(join(dir, run.run_id));
  assert.ok(!files.some((f) => f.includes('.tmp')), files.join());
  const lines = readFileSync(join(dir, run.run_id, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((l) => l.type), ['a', 'b']);
  assert.ok(lines.every((l) => typeof l.ts === 'string'));
});

test('loadRun on unknown id throws a clear error', () => {
  assert.throws(() => S.loadRun('nope--x'), /unknown run/);
});
