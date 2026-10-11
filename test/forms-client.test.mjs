import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = readFileSync(new URL('../public/form.js', import.meta.url), 'utf8');

function client({ storage = new Map(), fetch, valid = true } = {}) {
  let submit;
  const classes = () => ({ add() {}, remove() {} });
  const input = { dataset: { field: 'title', type: 'text' }, value: 'Keep this' };
  const send = { disabled: false, textContent: 'Send' };
  const error = { classList: classes(), textContent: '' };
  const receipt = { textContent: '' };
  const form = {
    dataset: { kind: 'row', submit: '/api/forms/example/submit' }, classList: classes(),
    querySelector: () => send, querySelectorAll: () => [input],
    reportValidity: () => valid,
    addEventListener: (name, fn) => { if (name === 'submit') submit = fn; },
  };
  const win = {
    document: { documentElement: { dataset: {} }, readyState: 'complete', getElementById: (id) => ({ 'wv-form': form, 'wv-form-error': error, 'wv-form-receipt': receipt })[id] },
    localStorage: { getItem: () => 'dark' },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    crypto: { randomUUID }, fetch,
  };
  runInNewContext(source, { window: win, Date, JSON, Uint8Array });
  return { submit: () => submit({ preventDefault() {} }), input, send, error, receipt, win };
}

test('a lost reply retries the same payload with the same idempotency key', async () => {
  const requests = [];
  const c = client({ fetch: async (_url, options) => {
    requests.push(options);
    if (requests.length === 1) throw new Error('Connection lost');
    return { ok: true, json: async () => ({ table: 'Inbox', publicId: 12, replayed: true }) };
  } });
  await c.submit();
  assert.equal(c.send.disabled, false);
  await c.submit();
  assert.match(requests[0].headers['Idempotency-Key'], /^[a-f0-9-]{36}$/);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.equal(requests[0].body, requests[1].body);
  assert.match(c.receipt.textContent, /#12/);
  assert.equal(c.send.disabled, true);
});

test('pending retry survives a reload; edited answers get a fresh key', async () => {
  const storage = new Map();
  const requests = [];
  const fetch = async (_url, options) => { requests.push(options); throw new Error('Offline'); };
  const first = client({ storage, fetch });
  await first.submit();
  const second = client({ storage, fetch });
  await second.submit();
  assert.ok(requests[0].headers['Idempotency-Key']);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  second.input.value = 'Changed';
  await second.submit();
  assert.notEqual(requests[1].headers['Idempotency-Key'], requests[2].headers['Idempotency-Key']);
});

test('invalid fields stop before the network and theme preference survives', async () => {
  let calls = 0;
  const c = client({ valid: false, fetch: async () => { calls++; throw new Error('Unexpected request'); } });
  await c.submit();
  assert.equal(calls, 0);
  assert.equal(c.win.document.documentElement.dataset.bsTheme, 'dark');
});

test('a rate-limit response shows when the respondent may retry', async () => {
  const c = client({ fetch: async () => ({ ok: false, status: 429, headers: { get: () => '42' }, json: async () => ({ error: 'Too many submissions' }) }) });
  await c.submit();
  assert.match(c.error.textContent, /42/);
  assert.equal(c.send.disabled, false);
});
