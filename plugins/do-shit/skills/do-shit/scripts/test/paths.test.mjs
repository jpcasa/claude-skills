// Path resolution must not depend on ~/.claude: the same files run hand-installed and as a plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '../lib');

test('bundled schema, redact lib and agents resolve', async () => {
  const P = await import('../lib/paths.mjs');
  assert.ok(existsSync(P.REPORT_SCHEMA));
  assert.ok(existsSync(join(P.REDACT_LIB, 'redact.jq')));
  assert.ok(existsSync(join(P.ROOT, 'agents/worker.md')));
});

const resolve = (env) =>
  JSON.parse(execFileSync('node', ['--input-type=module', '-e',
    `import { resolveAgent } from '${join(LIB, 'repo.mjs')}'; import { PLUGIN } from '${join(LIB, 'paths.mjs')}';
     console.log(JSON.stringify({ PLUGIN, r: resolveAgent('/nonexistent', 'worker') }))`],
  { env: { ...process.env, ...env } }).toString());

test('plugin install: bundled agent is namespaced, user-level agent wins', () => {
  const empty = mkdtempSync(join(tmpdir(), 'agents-'));
  const out = resolve({ DO_SHIT_AGENTS_DIR: empty });
  assert.deepEqual(out.r, out.PLUGIN ? { agent: 'do-shit:worker', source: 'plugin' } : { agent: 'worker', source: 'user' });
  writeFileSync(join(empty, 'worker.md'), '---\nname: worker\n---\n');
  assert.deepEqual(resolve({ DO_SHIT_AGENTS_DIR: empty }).r, { agent: 'worker', source: 'user' });
});
