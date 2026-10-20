import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
import { APP } from './lib/source.mjs';
const CSS = read('style.css');

const rules = () => {
  const out = [];
  const tok = /([^{}]+)\{|\}/g;
  let m;
  while ((m = tok.exec(CSS))) {
    if (m[0] === '}') continue;
    const head = m[1].trim();
    if (head.startsWith('@')) continue;
    const end = CSS.indexOf('}', tok.lastIndex);
    out.push({ selector: head, body: CSS.slice(tok.lastIndex, end) });
    tok.lastIndex = end + 1;
  }
  return out;
};

const classesOf = (marker) => {
  const at = APP.indexOf(marker);
  assert.ok(at > 0, `app.js names ${marker}`);
  const start = APP.lastIndexOf("el('input', {", at);
  const attrs = APP.slice(start, APP.indexOf('})', at));
  assert.ok(start > 0 && !attrs.slice(13).includes("el('"), `${marker} sits in an input's attributes`);
  const cls = attrs.match(/class: '([^']*)'/);
  return cls ? cls[1].split(/\s+/) : [];
};

const SEARCHES = { picker: "picker-search', placeholder, type: 'text'", palette: "id: 'cmdk-input'", table: "table-search-input', type: 'search'" };

test('the picker, palette and table searches all carry the one bare search skin (Issue #785)', () => {
  for (const [name, marker] of Object.entries(SEARCHES)) {
    assert.ok(classesOf(marker).includes('search-bare'), `${name} search: ${classesOf(marker).join(' ')}`);
  }
});

test('the table search is no longer built as a form-control and then stripped (Issue #785)', () => {
  const cls = classesOf(SEARCHES.table);
  assert.deepEqual(cls.filter((c) => c.startsWith('form-control')), [], cls.join(' '));
});

test('only .search-bare drops the border, background and shadow of a search line (Issue #785)', () => {
  const all = rules();
  const base = all.filter((r) => r.selector === '.search-bare');
  assert.equal(base.length, 1, 'one .search-bare rule');
  for (const prop of ['border', 'background', 'box-shadow']) assert.match(base[0].body, new RegExp(`(^|;)\\s*${prop}\\s*:`), prop);
  const hosts = all.filter((r) => /\.picker-search|#cmdk-input|\.table-search-input/.test(r.selector) && !/::placeholder/.test(r.selector));
  assert.ok(hosts.length >= 3, `found ${hosts.length} host rules`);
  const strips = hosts.filter((r) => /(^|;)\s*(border|background|box-shadow)\s*:/.test(r.body));
  assert.deepEqual(strips.map((r) => r.selector), []);
});
