import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { VERSION } from '../src/server.js';
import { withServer } from './lib/fixtures.mjs';

const report = (over = {}) => ({ build: '0.4.120', engine: 'blink', vw: 1280, vh: 860, reports: [{ kind: 'shift', score: 0.42, selector: 'aside.entity-dock > section.dock-body', move: 1346, route: '/w/:id/#/table/:id' }], ...over });
const post = (f, body, headers = {}) => f('/api/paint', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('a hosted shell loads paint.js with the build version and a report becomes one log line', async () => {
  const lines = [];
  await withServer(new Weave(), { paintLog: (line) => lines.push(line), limits: { paint: 100, paintAll: 100 } }, async ({ fetch }) => {
    const shell = await (await fetch('/')).text();
    assert.match(shell, new RegExp(`<script src="/paint\\.js\\?v=[0-9a-f]+" data-build="${VERSION.replace(/\./g, '\\.')}" defer></script>`));
    const two = report({ reports: [...report().reports, { kind: 'frame', ms: 240, blocking: 180, route: '/' }] });
    const res = await post(fetch, two);
    assert.equal(res.status, 204);
    assert.equal(lines.length, 2, 'one line per report');
    assert.ok(lines.every((l) => l.startsWith('weave: paint {')));
    assert.deepEqual(JSON.parse(lines[0].slice('weave: paint '.length)), { kind: 'shift', score: 0.42, move: 1346, selector: 'aside.entity-dock > section.dock-body', route: '/w/:id/#/table/:id', build: '0.4.120', engine: 'blink', vw: 1280, vh: 860 });
    assert.deepEqual(JSON.parse(lines[1].slice('weave: paint '.length)), { kind: 'frame', ms: 240, blocking: 180, route: '/', build: '0.4.120', engine: 'blink', vw: 1280, vh: 860 });
  });
});

test('the server keeps only the fields it knows and nulls any value outside its shape', async () => {
  const lines = [];
  await withServer(new Weave(), { paintLog: (line) => lines.push(line), limits: { paint: 100, paintAll: 100 } }, async ({ fetch }) => {
    const sneaky = report({ email: 'ada@example.com', engine: 'netscape', reports: [{ kind: 'shift', score: 0.3, selector: 'div[data-name="Ada Lovelace"]', route: '/#/entity/Ada Lovelace', name: 'Ada', move: 5 }] });
    assert.equal((await post(fetch, sneaky)).status, 204);
    const row = JSON.parse(lines[0].slice('weave: paint '.length));
    assert.equal(row.selector, null);
    assert.equal(row.route, null);
    assert.equal(row.engine, null);
    assert.ok(!lines[0].includes('Ada') && !lines[0].includes('example.com'), lines[0]);
  });
});

test('the endpoint refuses bad bodies, big bodies and a flood, and logs none of them', async () => {
  const lines = [];
  await withServer(new Weave(), { paintLog: (line) => lines.push(line), limits: { paint: 100, paintAll: 100 } }, async ({ fetch }) => {
    assert.equal((await fetch('/api/paint')).status, 405);
    assert.equal((await post(fetch, 'not json')).status, 400);
    assert.equal((await post(fetch, report({ reports: [{ kind: 'secret' }] }))).status, 400);
    assert.equal((await post(fetch, report({ reports: Array.from({ length: 11 }, () => report().reports[0]) }))).status, 400);
    assert.equal((await post(fetch, report({ pad: 'x'.repeat(9000) }))).status, 413);
    assert.equal(lines.length, 0);
  });
  await withServer(new Weave(), { paintLog: (line) => lines.push(line), limits: { paint: 2, paintAll: 100 } }, async ({ fetch }) => {
    assert.equal((await post(fetch, report())).status, 204);
    assert.equal((await post(fetch, report())).status, 204);
    const third = await post(fetch, report());
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('retry-after'), '60');
    assert.equal(lines.length, 2, 'a client past its rate writes no line');
  });
  lines.length = 0;
  await withServer(new Weave(), { paintLog: (line) => lines.push(line), limits: { paint: 100, paintAll: 1 } }, async ({ fetch }) => {
    assert.equal((await post(fetch, report())).status, 204);
    assert.equal((await post(fetch, report())).status, 429, 'the server-wide cap holds the log to a fixed rate');
    assert.equal(lines.length, 1);
  });
});

test('a local install loads no paint.js and answers 404 at /api/paint', async () => {
  await withServer(new Weave(), {}, async ({ fetch }) => {
    assert.doesNotMatch(await (await fetch('/')).text(), /paint\.js/);
    assert.equal((await post(fetch, report())).status, 404);
  });
});
