import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { createContext, runInContext } from 'node:vm';

const HTML = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('the document editor is not render-blocking: index.html names its files in a template, not as live tags (Issue #989)', () => {
  const live = HTML.replace(/<template id="vditor-assets">[\s\S]*?<\/template>/, '');
  assert.doesNotMatch(live, /vditor\/dist\/index\.(min\.js|css)/, 'no live script or stylesheet tag loads Vditor');
  const tpl = HTML.match(/<template id="vditor-assets">([\s\S]*?)<\/template>/)?.[1] ?? '';
  assert.match(tpl, /<link rel="stylesheet" href="\/vendor\/vditor\/dist\/index\.css">/);
  assert.match(tpl, /<script src="\/vendor\/vditor\/dist\/index\.min\.js"><\/script>/);
  assert.ok(HTML.indexOf('id="vditor-assets"') < HTML.indexOf('href="/style.css"'), 'the editor CSS lands before style.css, so the house rules still win the cascade');
});

test('the editor mounts only after its files load (Issue #989)', () => {
  assert.match(APP, /function loadVditor\(\)/);
  assert.match(APP, /loadVditor\(\)\.then\(mount, /, 'the editor waits for both assets');
});

function loadingContext() {
  const nodes = [];
  const context = createContext({
    window: {},
    document: { querySelector: () => null, head: { append() {} } },
    el: (tag) => {
      const node = { tag, handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; }, remove() { this.removed = true; } };
      nodes.push(node);
      return node;
    },
  });
  runInContext(APP.slice(APP.indexOf('let vditorLoading = null;'), APP.indexOf('function mountDocEditor(')), context);
  return { context, nodes };
}

test('concurrent editor loads still wait for CSS after the script defines Vditor', async () => {
  const { context, nodes } = loadingContext();
  const first = context.loadVditor();
  context.window.Vditor = function () {};
  nodes[1].handlers.load();
  const second = context.loadVditor();
  assert.equal(second, first);
  nodes[0].handlers.load();
  await second;
  assert.equal(nodes.length, 2);
  await context.loadVditor();
  assert.equal(nodes.length, 2);
});

test('a failed stylesheet can retry after the script has already loaded', async () => {
  const { context, nodes } = loadingContext();
  const first = context.loadVditor();
  context.window.Vditor = function () {};
  nodes[1].handlers.load();
  nodes[0].handlers.error();
  await assert.rejects(first, /editor did not load/);
  assert.equal(nodes[0].removed, true);
  const retry = context.loadVditor();
  assert.equal(nodes.length, 4);
  nodes[2].handlers.load();
  nodes[3].handlers.load();
  await retry;
});

for (const fail of [false, true]) {
  for (const dismissed of [false, true]) {
    test(`a ${dismissed ? 'dismissed' : 'current'} document handles a pending editor ${fail ? 'failure' : 'load'}`, async () => {
      let resolve, reject;
      const pending = new Promise((ok, no) => { resolve = ok; reject = no; });
      const calls = [];
      const context = createContext({
        window: {}, host: { isConnected: true }, entity: { docs: {} }, f: { name: 'Body' }, id: 'row', editors: [],
        loadVditor: () => pending, mountDocEditor: () => calls.push('editor'),
        mountSourceEditor: () => calls.push('source'), toast: () => calls.push('toast'),
      });
      const start = APP.indexOf('    const mountEditor = () => {');
      const end = APP.indexOf('    const mountSourceEditor = () => {', start);
      runInContext(`${APP.slice(start, end)}\nmountEditor();`, context);
      context.host.isConnected = !dismissed;
      if (fail) reject(new Error('asset failed')); else resolve();
      await pending.catch(() => {});
      assert.deepEqual(calls, dismissed ? [] : fail ? ['source', 'toast'] : ['editor']);
      assert.equal(context.editors.length, !dismissed && !fail ? 1 : 0);
    });
  }
}

test('the served page stamps the template files with immutable versions (Issue #989)', async () => {
  const { server } = await startServer(new Weave(), { port: 0 });
  try {
    const html = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
    const tpl = html.match(/<template id="vditor-assets">([\s\S]*?)<\/template>/)?.[1] ?? '';
    assert.match(tpl, /href="\/vendor\/vditor\/dist\/index\.css\?v=[0-9a-f]{12}"/);
    assert.match(tpl, /src="\/vendor\/vditor\/dist\/index\.min\.js\?v=[0-9a-f]{12}"/);
  } finally { server.close(); }
});
