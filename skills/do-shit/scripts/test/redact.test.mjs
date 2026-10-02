import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { REDACT_LIB as LIB } from '../lib/paths.mjs';
const redact = (s) =>
  execFileSync('jq', ['-Rjs', '-L', LIB, 'include "redact"; redact'], { input: s }).toString();
const redactJson = (o) =>
  JSON.parse(
    execFileSync('jq', ['-c', '-L', LIB, 'include "redact"; redact_strings'], {
      input: JSON.stringify(o),
    }).toString(),
  );

test('redacts credential-shaped strings', () => {
  const cases = [
    ['key sk-ant-abcdefghijklmnopqrstuv', 'sk-ant-[REDACTED]'],
    ['tok ghp_abcdefghijklmnopqrstuvwxyz0123', 'ghp_[REDACTED]'],
    ['jwt eyJhbGciOiJI.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4', '[REDACTED_JWT]'],
    ['db postgres://user:hunter2secret@db.example.com/x', 'postgres://user:[REDACTED]@'],
    ['password=abcdefghijklmnop1234', 'password=[REDACTED]'],
  ];
  for (const [input, expected] of cases) {
    const out = redact(input);
    assert.ok(out.includes(expected), `${input} -> ${out}`);
  }
});

test('leaves plain text unchanged, byte for byte', () => {
  const plain = 'Fix drawer route in apps/web\nsecond line with "quotes"';
  assert.equal(redact(plain), plain);
});

test('redacts nested JSON string values and keeps structure', () => {
  const out = redactJson({
    item: { title: 'Rotate key', body: 'old key ghp_abcdefghijklmnopqrstuvwxyz0123 leaked' },
    findings: [{ text: 'Bearer abcdefghijklmnopqrstuvwxyz in log', line: 12 }],
  });
  assert.equal(out.item.title, 'Rotate key');
  assert.equal(out.item.body, 'old key ghp_[REDACTED] leaked');
  assert.equal(out.findings[0].text, 'Bearer [REDACTED] in log');
  assert.equal(out.findings[0].line, 12);
});
