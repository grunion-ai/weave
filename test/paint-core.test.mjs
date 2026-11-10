import test from 'node:test';
import assert from 'node:assert/strict';
await import('../public/paint.js');
const P = globalThis.WeavePaint;

const el = (tag, { id = '', classes = [], parent = null } = {}) => ({ nodeType: 1, tagName: tag.toUpperCase(), id, classList: classes, parentElement: parent });
const rect = (x, y, width, height) => ({ x, y, width, height });

test('the route keeps its structural words and strips workspace names, record ids and queries', () => {
  assert.equal(P.routeOf('/w/acme-sales/', '#/table/9f1c2b7a-1111-4222-8333-444455556666/view/v_abc?row=12'), '/w/:id/#/table/:id/view/:id');
  assert.equal(P.routeOf('/', '#/entity/ada-lovelace'), '/#/entity/:id');
  assert.equal(P.routeOf('/', ''), '/');
  assert.equal(P.routeOf('/s/wvs_secret-token', '#/space/Finance'), '/s/:id#/space/:id');
  assert.ok(P.routeOf('/', `#/${'x/'.repeat(200)}`).length <= 120);
});

test('the selector names tags and plain class names, never ids or classes that carry numbers', () => {
  const body = el('body');
  const dock = el('aside', { classes: ['entity-dock', 'open'], parent: body });
  const card = el('section', { id: 'e-9f1c2b7a', classes: ['dock-body', 'row-12345', 'x'], parent: dock });
  const text = { nodeType: 3, parentElement: card };
  assert.equal(P.selectorOf(text), 'aside.entity-dock.open > section.dock-body.x');
  assert.equal(P.selectorOf(el('div', { id: 'app', parent: body })), 'div#app');
  assert.equal(P.selectorOf(null), null);
});

test('the largest moved source wins and its move is measured in px', () => {
  const small = { node: el('span'), previousRect: rect(0, 0, 10, 10), currentRect: rect(0, 40, 10, 10) };
  const big = { node: el('div', { classes: ['dock-frame'] }), previousRect: rect(0, 0, 800, 600), currentRect: rect(0, 1346, 800, 600) };
  assert.equal(P.largest([small, big]), big);
  assert.equal(P.moveOf(big), 1346);
  assert.equal(P.largest([]), null);
});

test('a shift session over 0.1 reports once with its biggest shift, and input-led shifts never count', () => {
  const out = [];
  const s = P.createShiftSession((r) => out.push(r));
  const node = el('div', { classes: ['dock-frame'] });
  const entry = (startTime, value, hadRecentInput = false) => ({ startTime, value, hadRecentInput, sources: [{ node, previousRect: rect(0, 0, 100, 100), currentRect: rect(0, 300, 100, 100) }] });
  s.add(entry(0, 0.5, true), '/');
  s.close();
  assert.deepEqual(out, [], 'a shift right after input is the user\'s own');
  s.add(entry(100, 0.06), '/#/table/:id');
  s.add(entry(400, 0.07), '/#/entity/:id');
  s.close();
  assert.deepEqual(out, [{ kind: 'shift', score: 0.13, selector: 'div.dock-frame', move: 300, route: '/#/table/:id' }]);
  s.add(entry(2000, 0.05), '/');
  s.add(entry(3500, 0.08), '/');
  s.close();
  assert.equal(out.length, 1, 'a one second gap splits the session and neither half passes 0.1');
});

test('a long animation frame of 200 ms or more is reported with its blocking time', () => {
  assert.deepEqual(P.frameOf({ duration: 240.6, blockingDuration: 180.2 }, '/'), { kind: 'frame', ms: 241, blocking: 180, route: '/' });
  assert.equal(P.frameOf({ duration: 120, blockingDuration: 60 }, '/'), null);
});

test('the payload carries build, engine family and viewport, and nothing else about the person', () => {
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const reports = [{ kind: 'shift', score: 0.2, selector: 'div.x', move: 10, route: '/' }];
  assert.deepEqual(P.payload({ build: '0.4.120', ua: chrome, vw: 1280.4, vh: 860, reports }), { build: '0.4.120', engine: 'blink', vw: 1280, vh: 860, reports });
  assert.equal(P.engineOf('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'), 'gecko');
  assert.equal(P.engineOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'webkit');
  assert.equal(P.engineOf(''), 'other');
});
