import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const MOVES = /^(opacity|visibility|display|(min-|max-)?(width|height)|margin|padding|position|top|left|right|bottom|inset|transform|translate|scale|rotate|flex|grid|gap|content|font-size|line-height)/;

const rules = () => {
  const out = [];
  const media = [];
  const tok = /([^{}]+)\{|\}/g;
  let m;
  while ((m = tok.exec(CSS))) {
    if (m[0] === '}') { media.pop(); continue; }
    const head = m[1].trim();
    if (head.startsWith('@')) { media.push(head); continue; }
    const end = CSS.indexOf('}', tok.lastIndex);
    out.push({ selector: head, body: CSS.slice(tok.lastIndex, end), media: media.join(' '), line: CSS.slice(0, m.index).split('\n').length });
    tok.lastIndex = end + 1;
  }
  return out;
};

test('a :hover rule that shows, hides or moves content sits behind @media (hover: hover) (Issue #728)', () => {
  const loose = rules().filter((r) => r.selector.includes(':hover')
    && r.body.split(';').some((d) => MOVES.test(d.split(':')[0].trim()))
    && !/\(hover: hover\)/.test(r.media)).map((r) => `style.css:${r.line} ${r.selector}`);
  assert.deepEqual(loose, [], 'iOS turns the first tap into a hover when a :hover rule reveals content, so a row needs a second tap');
});

test('on touch screens the row menus and add buttons stay visible instead of waiting for a hover (Issue #728)', () => {
  const shown = rules().filter((r) => /\(hover: none\)/.test(r.media) && /opacity:\s*1/.test(r.body)).map((r) => r.selector).join(', ');
  for (const q of ['.nav-db .nav-db-menu', '.nav-add-table']) assert.ok(shown.includes(q), `${q} shows on touch`);
});

test('icons animate on mouseover only where the pointer can hover (Issue #728)', () => {
  const at = APP.indexOf("document.addEventListener('mouseover'");
  assert.ok(at > 0);
  assert.match(APP.slice(at, at + 160), /if \(!canHover\.matches\) return;/);
  assert.match(APP, /const canHover = matchMedia\('\(hover: hover\)'\);/);
});
