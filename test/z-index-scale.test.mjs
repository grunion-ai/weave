import test from 'node:test';
import assert from 'node:assert/strict';
import { read, rulesFor, zOf } from './lib/source.mjs';

const FILES = ['public/style.css', 'public/chip.css'];
const LOCAL = /^-?\d$/;
const LOCAL_CEILING = 36;
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const declarations = FILES.flatMap((f) => [...strip(read(f)).matchAll(/(?:^|[;{\s])z-index\s*:\s*([^;{}]+)/g)].map((m) => ({ file: f, value: m[1].trim() })));
const scale = [...strip(read('public/style.css')).matchAll(/(--wv-z-[a-z-]+)\s*:\s*([^;{}]+)/g)].map((m) => ({ name: m[1], value: m[2].trim() }));
const zIndex = (selector) => rulesFor(selector)['z-index'];

test('the stacking scale is written once, in :root, in rising order (Issue #1460)', () => {
  assert.ok(scale.length >= 10, `style.css names ${scale.length} --wv-z layers`);
  assert.equal(new Set(scale.map((t) => t.name)).size, scale.length, 'each layer is named once');
  for (const t of scale) assert.match(t.value, /^\d+$/, `${t.name} is a plain integer`);
  for (let i = 1; i < scale.length; i++) {
    assert.ok(Number(scale[i].value) >= Number(scale[i - 1].value), `${scale[i].name} (${scale[i].value}) sits below ${scale[i - 1].name} (${scale[i - 1].value}): the scale is written in stacking order`);
  }
});

test('every z-index reads a --wv-z layer, or a single-digit local value under a ceiling that only falls (Issue #1460)', () => {
  const names = new Set(scale.map((t) => t.name));
  const raw = declarations.filter((d) => !/^var\(/.test(d.value));
  for (const d of declarations.filter((x) => /^var\(/.test(x.value))) {
    const name = d.value.match(/^var\((--wv-z-[a-z-]+)\)$/)?.[1];
    assert.ok(name && names.has(name), `${d.file}: z-index ${d.value} reads no layer of the scale`);
  }
  for (const d of raw) assert.match(d.value, LOCAL, `${d.file}: z-index ${d.value} is a page-wide layer written as a raw number; name it in the --wv-z scale`);
  assert.ok(raw.length <= LOCAL_CEILING, `${raw.length} raw local z-index values, ceiling ${LOCAL_CEILING}: move one onto the scale rather than adding one`);
  assert.ok(raw.length >= LOCAL_CEILING, `raw local z-index values fell to ${raw.length}: lower LOCAL_CEILING to ${raw.length}`);
});

test('a picker opened from a dialog or the palette stacks above it, and toasts stack above everything (Issues #45, #1460)', () => {
  for (const sel of ['.chip-pop', '.date-pop']) {
    for (const over of ['#modal-back', '#cmdk-back', '#tray-back']) {
      assert.ok(zOf(zIndex(sel)) > zOf(zIndex(over)), `${sel} (${zIndex(sel)}) stacks above ${over} (${zIndex(over)})`);
    }
  }
  assert.equal(zIndex('#wv-toasts'), `var(${scale.at(-1).name})`, 'toasts read the top layer');
});
