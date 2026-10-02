import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ask, setTransport, resetTransport } from '../lib/jev.mjs';

const Q = {
  a: { type: 'noul', instructions: 'x' },
  b: { type: 'choice', instructions: 'y', criteria: { ship: null, fix: null } },
  c: { type: 'score', instructions: 'z', criteria: ['lo', 'mid', 'hi'] },
};

beforeEach(() => resetTransport());

test('parses noul, choice and score answers', async () => {
  setTransport(async () => ({
    status: 200,
    json: {
      model: 'jev-1.13.0',
      answers: {
        a: { type: 'noul', noul: 0.9 },
        b: { type: 'choice', choice: 'fix', probabilities: { ship: 0.2, fix: 0.8 }, confidence: 0.6 },
        c: { type: 'score', score: 1.5, legend: {}, probabilities: {}, confidence: 0.7 },
      },
    },
  }));
  const r = await ask({ state: { t: 1 }, questions: Q, key: 'k' });
  assert.equal(r.degraded, false);
  assert.equal(r.answers.a.noul, 0.9);
  assert.equal(r.answers.b.choice, 'fix');
  assert.equal(r.answers.c.score, 1.5);
  assert.equal(r.model, 'jev-1.13.0');
});

test('retries once on timeout/5xx, then degrades', async () => {
  let calls = 0;
  setTransport(async () => {
    calls++;
    return { status: 529, json: {} };
  });
  const r = await ask({ state: {}, questions: Q, key: 'k', retryDelayMs: 1 });
  assert.equal(calls, 2);
  assert.equal(r.degraded, true);
  assert.match(r.error, /529/);
});

test('does not retry 4xx validation errors', async () => {
  let calls = 0;
  setTransport(async () => {
    calls++;
    return { status: 422, json: { detail: 'bad' } };
  });
  const r = await ask({ state: {}, questions: Q, key: 'k', retryDelayMs: 1 });
  assert.equal(calls, 1);
  assert.equal(r.degraded, true);
});

test('missing or mistyped answer degrades', async () => {
  setTransport(async () => ({ status: 200, json: { answers: { a: { type: 'noul', noul: 0.1 } } } }));
  const r = await ask({ state: {}, questions: Q, key: 'k' });
  assert.equal(r.degraded, true);
  assert.match(r.error, /missing answer/);
});

test('no key degrades without calling the API', async () => {
  let calls = 0;
  setTransport(async () => {
    calls++;
    return { status: 200, json: {} };
  });
  const r = await ask({ state: {}, questions: Q, key: '' });
  assert.equal(calls, 0);
  assert.equal(r.degraded, true);
});

test('redacts the whole body before sending', async () => {
  let sent;
  setTransport(async (body) => {
    sent = body;
    return { status: 200, json: { answers: { a: { type: 'noul', noul: 0.5 } } } };
  });
  await ask({
    state: { item: { body: 'token ghp_abcdefghijklmnopqrstuvwxyz0123 in ticket' } },
    questions: { a: Q.a },
    key: 'k',
  });
  const text = JSON.stringify(sent);
  assert.ok(!text.includes('ghp_abcdef'), text);
  assert.ok(text.includes('ghp_[REDACTED]'));
  assert.equal(sent.model, 'jev-latest');
});
