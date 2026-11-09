import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { applyHandbook } from '../src/handbook.js';
import { buildPresentation } from '../src/handbook/presentation.js';

function fixture() {
  const w = new Weave();
  applyHandbook(w);
  for (const name of ['Development', 'Quality', 'Showcase', 'Wiki', 'CRM', 'Money']) w.createSpace({ name });
  for (const [space, names] of [['Development', ['Issue', 'Feature', 'Release']], ['Quality', ['Suite', 'Case']], ['Showcase', ['Projects', 'Tasks', 'Notes', 'Expenses', 'Line Items']], ['Wiki', ['Article']]]) {
    for (const name of names) w.createTable({ space, name });
  }
  w.createEntity('Showcase/Projects', { name: 'Apollo Launch' });
  return w;
}

test('documentation navigation resolves actual workspace identities and retains public development and quality routes', () => {
  const w = fixture();
  const before = JSON.stringify(w.exportJSON());
  const p = buildPresentation(w);
  assert.equal(JSON.stringify(w.exportJSON()), before);
  const html = p.spaces.find(x => x.name === 'Handbook').html;
  for (const name of ['Development/Issue', 'Development/Feature', 'Development/Release', 'Quality/Suite', 'Quality/Case']) assert.ok(html.includes(w.getTable(name).id), name);
  assert.ok(p.guides.find(x => x.name === 'Connect an agent').html.includes('<details'));
  for (const item of [...p.spaces, ...p.tables, ...p.guides, ...p.releases]) {
    assert.match(readFileSync(item.bannerPath, 'utf8'), /<svg/);
    assert.ok(item.bannerPath.pathname.includes('/src/handbook/banners/'), 'runtime banners must ship in images that exclude brand/');
    assert.doesNotMatch(item.html, /<img|<iframe|fetch\(|https:\/\/fonts/);
    for (const [, href] of item.html.matchAll(/href="([^"]+)"/g)) assert.match(href, /^\/w\/weave\/(?:#\/(?:table|space)\/[a-f0-9-]+|e\/[a-f0-9-]+|mcp)|^\/docs$/);
  }
  assert.ok(new Set(p.spaces.map(x => String(x.bannerPath))).size >= 4);
});

test('missing optional showcase records and tables do not produce broken links or invented examples', () => {
  const w = new Weave();
  applyHandbook(w);
  const p = buildPresentation(w);
  assert.doesNotMatch(JSON.stringify(p), /undefined|null|Apollo Launch|Task Count/);
  for (const name of ['Quickstart', 'A project and its linked work', 'Connect an agent', 'Reading a release']) assert.ok(w.findEntity('Handbook/Guide', name));
});

test('the hosted connection walkthrough opens the native docs page and reserves the MCP endpoint for clients', () => {
  const guide = readFileSync(new URL('../src/handbook/guides/connect-an-agent.md', import.meta.url), 'utf8');
  assert.ok(guide.includes('https://<host>/w/<workspace>/docs'));
  assert.doesNotMatch(guide, /Open your workspace's MCP address in a browser/);
});
