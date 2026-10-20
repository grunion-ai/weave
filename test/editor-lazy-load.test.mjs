import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

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
  assert.match(APP, /if \(window\.Vditor\) mount\(\);\s*else loadVditor\(\)\.then\(mount, /, 'a loaded editor mounts at once, a first one waits for its files');
});

test('the served page stamps the template files with immutable versions (Issue #989)', async () => {
  const { server } = await startServer(new Weave(), { port: 0 });
  try {
    const html = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
    const tpl = html.match(/<template id="vditor-assets">([\s\S]*?)<\/template>/)?.[1] ?? '';
    assert.match(tpl, /href="\/vendor\/vditor\/dist\/index\.css\?v=[0-9a-f]{12}"/);
    assert.match(tpl, /src="\/vendor\/vditor\/dist\/index\.min\.js\?v=[0-9a-f]{12}"/);
  } finally { server.close(); }
});
