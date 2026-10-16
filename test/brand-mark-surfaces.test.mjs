import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { H3, markPair } from '../src/mark.js';
import { fillMarks } from '../brand/build-logos.mjs';
import { renderAuthPage, renderRefusalPage } from '../src/auth-page.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const SURFACES = {
  'public/index.html': () => read('public/index.html'),
  'public/start.html': () => read('public/start.html'),
  'public/404.html': () => read('public/404.html'),
  'public/billing.html': () => read('public/billing.html'),
  'auth page': () => renderAuthPage({ workspace: 'acme' }),
  'refusal page': () => renderRefusalPage({ title: 'No access' }),
};

const ropeSvgs = (html) => (html.match(/<svg\b[\s\S]*?<\/svg>/g) ?? []).filter((svg) => svg.includes(H3.a) || svg.includes(H3.b));

test('every inline weave mark is the masked h3 rope: under strand cut, over segment whole (Issue #963)', () => {
  for (const [name, html] of Object.entries(SURFACES)) {
    for (const svg of ropeSvgs(html())) {
      assert.equal((svg.match(/<mask /g) ?? []).length, 2, `${name}: the mark cuts its under strands with two masks`);
      assert.ok(svg.includes(`d="${H3.overs[0]}"`), `${name}: the over segment is drawn whole`);
      assert.ok(!/stroke-dasharray|currentColor/.test(svg), `${name}: no painted crossing and no single-colour strand`);
    }
  }
});

test('the start page, the 404 and the sign-in pages carry the generated mark pair (Issue #963)', () => {
  for (const file of ['public/start.html', 'public/404.html']) {
    const html = read(file);
    assert.ok(/data-mark="/.test(html), `${file} has a mark host`);
    assert.equal(fillMarks(html), html, `${file} is stale, run node brand/build-logos.mjs`);
  }
  const start = read('public/start.html');
  assert.equal((start.match(/data-mark="/g) ?? []).length, 2, 'start.html: the header mark and the weave tile mark');
  for (const page of [renderAuthPage({ workspace: 'acme' }), renderRefusalPage({ title: 'No access' })]) {
    assert.ok(page.includes(markPair('a', { cls: 'mark' })), 'the sign-in card draws the brand pair');
  }
});

test('the app rail draws the generated pair', () => {
  const html = read('public/index.html');
  for (const svg of markPair('h', { attrs: 'role="img" aria-label="weave"' }).split(/(?=<svg )/)) assert.ok(html.includes(svg), svg.slice(0, 40));
});

test('start.js draws no mark of its own (Issue #963)', () => {
  const js = read('public/start.js');
  assert.doesNotMatch(js, /ropeD|strand cross|class: 'strand/, 'no hand-rolled rope');
  assert.doesNotMatch(read('public/start.html'), /\.strand\b/, 'no strand CSS left behind');
  assert.match(js, /getElementById\('weave-mark'\)/, 'the weave tile clones the generated mark');
});

test('no page shows the mark through an <img>, where WebKit smears its masks (Issue #116)', () => {
  for (const file of ['public/index.html', 'public/start.html', 'public/404.html', 'public/billing.html']) {
    assert.doesNotMatch(read(file), /<img[^>]+weave-mark-(light|dark)\.svg/, file);
  }
});
