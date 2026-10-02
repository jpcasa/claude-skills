// SKILL.md must document every action type and ask kind the harness can emit,
// and the Jev catalog must be in sync with questions.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = ['scripts/harness.mjs', 'scripts/lib/merge.mjs'].map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
const skill = readFileSync(join(root, 'SKILL.md'), 'utf8');
const DECISIONS = new Set(['ship', 'fix', 'draft_flagged', 'replan']);

test('frontmatter', () => {
  assert.match(skill, /^---\nname: do-shit\n/);
  assert.match(skill, /\nargument-hint: /);
  assert.match(skill, /\ndescription: /);
});

test('every emitted action is documented', () => {
  const actions = [...new Set([...src.matchAll(/action: '([a-z_]+)'/g)].map((m) => m[1]))].filter((a) => !DECISIONS.has(a));
  for (const a of actions) assert.ok(skill.includes(`\`${a}\``), `SKILL.md missing action ${a}`);
});

test('every ask_user kind is documented', () => {
  const kinds = [...new Set([...src.matchAll(/kind: '([a-z_]+)'/g)].map((m) => m[1]))].filter((k) => k !== 'merge_fix');
  for (const k of kinds) assert.ok(skill.includes(`\`${k}\``), `SKILL.md missing kind ${k}`);
});

test('every tracker op is documented', () => {
  const ops = [...new Set([...src.matchAll(/op: '([a-z_]+)'/g)].map((m) => m[1]))];
  for (const o of ops) assert.ok(skill.includes(`\`${o}\``), `SKILL.md missing op ${o}`);
});

test('jev catalog is regenerated from questions.mjs', () => {
  const before = readFileSync(join(root, 'references/jev-questions.md'), 'utf8');
  execFileSync('node', [join(root, 'scripts/gen-jev-doc.mjs')]);
  assert.equal(readFileSync(join(root, 'references/jev-questions.md'), 'utf8'), before, 'jev-questions.md was stale');
});
