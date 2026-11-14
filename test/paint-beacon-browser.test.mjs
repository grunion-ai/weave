import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { VERSION } from '../src/server.js';

const lines = [];
let table;
const s = await launch('paint beacon', (w) => {
  w.createSpace({ name: 'Sales' });
  table = w.createTable({ space: 'Sales', name: 'Contacts' });
  w.createEntity(table, { name: 'Ada Lovelace' });
}, { server: () => ({ paintLog: (line) => lines.push(line) }) });

const logged = async (match, timeout = 15000) => {
  const until = Date.now() + timeout;
  for (;;) {
    const hit = lines.map((l) => JSON.parse(l.slice('weave: paint '.length))).find(match);
    if (hit || Date.now() > until) return hit ?? null;
    await new Promise((r) => setTimeout(r, 100));
  }
};

if (s) {
  test('a forced layout shift on a page reaches the server log as one scrubbed line', async () => {
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const p = await ctx.newPage();
    p.on('pageerror', (err) => { throw err; });
    await p.goto(`${s.base}/#/table/${table.id}`);
    await p.waitForSelector('.wv-grid tr[data-eid]');
    await p.evaluate(() => new Promise((done) => {
      const probe = document.createElement('div');
      probe.className = 'paint-probe';
      probe.style.cssText = 'position:absolute;left:0;top:0;width:1000px;height:400px;background:#888;z-index:5';
      document.body.append(probe);
      requestAnimationFrame(() => requestAnimationFrame(() => { probe.style.top = '400px'; requestAnimationFrame(() => done()); }));
    }));
    const hit = await logged((r) => r.kind === 'shift' && r.selector === 'div.paint-probe');
    assert.ok(hit, `a shift line names the probe; saw ${lines.join('\n')}`);
    assert.ok(hit.score > 0.1, `score ${hit.score}`);
    assert.equal(hit.move, 400);
    assert.equal(hit.route, '/#/table/:id');
    assert.equal(hit.build, VERSION);
    assert.equal(hit.vw, 1280);
    assert.equal(hit.vh, 860);
    assert.ok(['blink', 'gecko', 'webkit'].includes(hit.engine), hit.engine);
    for (const line of lines) assert.ok(!/Ada|Lovelace|Contacts|Sales/.test(line), `no record content in ${line}`);
    await ctx.close();
  });
}
