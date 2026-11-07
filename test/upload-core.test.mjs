import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

await import('../public/upload-core.js');
const U = globalThis.uploadCore;
const MB = 1024 * 1024;
const ROOT = join(import.meta.dirname, '..');

test('the file limit is 10 MiB of file bytes and reads as 10 MB', () => {
  assert.equal(U.LIMIT, 10 * MB);
  assert.equal(U.sizeText(U.LIMIT), '10 MB');
  assert.equal(U.sizeText(25 * MB), '25 MB');
  assert.equal(U.sizeText(10 * 1024), '10 KB');
  assert.equal(U.sizeText(U.LIMIT + 1), '10.1 MB', 'a file one byte over never reads as the limit itself');
  assert.equal(U.tooBig({ size: U.LIMIT }), false);
  assert.equal(U.tooBig({ size: U.LIMIT + 1 }), true);
});

test('a long name keeps its extension and loses its middle', () => {
  const long = `${'quarterly-board-pack-'.repeat(10)}final.pdf`;
  const short = U.shortName(long);
  assert.ok(short.length <= U.NAME_MAX, `${short.length} characters`);
  assert.ok(short.endsWith('final.pdf'), short);
  assert.ok(short.startsWith('quarterly-board'), short);
  assert.ok(short.includes('…'));
  assert.equal(U.shortName('deck.pdf'), 'deck.pdf');
  const wide = `${'日本語の資料'.repeat(12)}📄.pdf`;
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(U.shortName(wide)), 'a surrogate pair is never split');
});

test('every failure maps to its approved reason, message and retry rule', () => {
  const file = { name: 'deck.pdf', size: 25 * MB };
  const cases = [
    [{ kind: 'too-large' }, 'too-large', 'Over 10 MB', false, 'deck.pdf is 25 MB, over the 10 MB limit, so it was not saved.'],
    [{ status: 413 }, 'too-large', 'Over 10 MB', false, 'deck.pdf is 25 MB, over the 10 MB limit, so it was not saved.'],
    [{ status: 500 }, 'server', 'Server error', true, 'The server returned an error, so deck.pdf was not saved.'],
    [{ status: 502 }, 'unavailable', 'Server unavailable', true, 'The server is unavailable, so deck.pdf was not saved.'],
    [{ status: 503 }, 'unavailable', 'Server unavailable', true, 'The server is unavailable, so deck.pdf was not saved.'],
    [{ status: 504 }, 'unavailable', 'Server unavailable', true, 'The server is unavailable, so deck.pdf was not saved.'],
    [{ kind: 'offline' }, 'offline', 'No connection', true, 'Could not reach the server; deck.pdf was not saved. Check your connection.'],
    [{ kind: 'timeout' }, 'timeout', 'Timeout', true, 'deck.pdf took too long to upload and was not saved.'],
  ];
  for (const [err, reason, tile, retry, message] of cases) {
    const f = U.failure(file, err);
    assert.deepEqual({ reason: f.reason, tile: f.tile, retry: f.retry, message: f.message }, { reason, tile, retry, message }, JSON.stringify(err));
  }
});

test('a 413 that names its own limit is reported against that limit', () => {
  assert.equal(U.failure({ name: 'a.pdf', size: 3 * MB }, { status: 413, limit: 2 * MB }).message, 'a.pdf is 3 MB, over the 2 MB limit, so it was not saved.');
});

test('a refusal the table does not name keeps the server words and stays retryable', () => {
  const f = U.failure({ name: 'face.txt', size: 9 }, { status: 415, error: 'An avatar must be a PNG, JPEG, GIF or WebP image' });
  assert.equal(f.message, 'An avatar must be a PNG, JPEG, GIF or WebP image');
  assert.equal(f.tile, 'Not saved');
  assert.equal(f.retry, true);
});

test('a failed file name is trimmed in the message', () => {
  const long = `${'x'.repeat(196)}.pdf`;
  const m = U.failure({ name: long, size: 1 }, { status: 500 }).message;
  assert.ok(m.includes(U.shortName(long)) && !m.includes(long));
});

const ok = (name, size = 10) => ({ ok: true, name, size });
const bad = (name, err, size = 10) => ({ ok: false, name, size, ...U.failure({ name, size }, err) });

test('one file: no toast when it lands, red with its own message when it does not', () => {
  assert.equal(U.summary([ok('a.pdf')]), null);
  assert.deepEqual(U.summary([bad('a.pdf', { status: 500 })]), { kind: 'err', text: 'The server returned an error, so a.pdf was not saved.', action: 'retry' });
  assert.deepEqual(U.summary([bad('a.zip', { kind: 'too-large' }, 25 * MB)]), { kind: 'err', text: 'a.zip is 25 MB, over the 10 MB limit, so it was not saved.', action: 'choose' });
});

test('an empty file lands with an amber note', () => {
  assert.deepEqual(U.summary([ok('empty.txt', 0)]), { kind: 'warn', text: 'empty.txt is empty and was saved anyway. Remove it if that was a mistake.', action: null });
});

test('a batch that lands whole is a success toast naming the count', () => {
  assert.deepEqual(U.summary([ok('a'), ok('b'), ok('c')]), { kind: 'success', text: '3 files uploaded.', action: null });
});

test('a batch with one failure names it and its lowercase reason', () => {
  assert.deepEqual(U.summary([ok('a.pdf'), bad('b.pdf', { status: 500 }), ok('c.pdf')]),
    { kind: 'warn', text: '2 of 3 files uploaded. b.pdf was not saved: server error.', action: 'retry' });
  assert.deepEqual(U.summary([ok('a.pdf'), bad('b.zip', { kind: 'too-large' }, 25 * MB), ok('c.pdf')]),
    { kind: 'warn', text: '2 of 3 files uploaded. b.zip was not saved: over 10 MB.', action: 'choose' });
});

test('a batch with only over-limit files skipped counts them against the limit', () => {
  assert.deepEqual(U.summary([ok('a'), bad('b', { kind: 'too-large' }, 11 * MB), bad('c', { kind: 'too-large' }, 30 * MB)]),
    { kind: 'warn', text: '1 of 3 files uploaded. 2 files were over the 10 MB limit and not saved.', action: 'choose' });
});

test('a batch with several failures of mixed kinds counts them and retries when any can be', () => {
  assert.deepEqual(U.summary([ok('a'), bad('b', { kind: 'too-large' }, 11 * MB), bad('c', { status: 502 })]),
    { kind: 'warn', text: '1 of 3 files uploaded. 2 files were not saved.', action: 'retry' });
});

test('the page loads upload-core before app.js', () => {
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.match(html, /<script src="\/upload-core\.js" defer><\/script>/);
  assert.ok(html.indexOf('/upload-core.js') < html.indexOf('/app.js'));
});

test('the api() fallback names the status class, never a bare number', () => {
  assert.equal(U.statusText(502, 'GET'), 'The server is unavailable');
  assert.equal(U.statusText(504, 'POST'), 'The server is unavailable; nothing was saved');
  assert.equal(U.statusText(500, 'PATCH'), 'The server returned an error; nothing was saved');
  assert.equal(U.statusText(500, 'GET'), 'The server returned an error');
  assert.equal(U.statusText(404, 'GET'), 'The server refused the request (HTTP 404)');
  assert.equal(U.serverError(500, 'Internal error'), null, 'the generic 500 body gives way to the status message');
  assert.equal(U.serverError(400, 'Name is required'), 'Name is required');
});
