import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tempDir } from './lib/temp.mjs';

const SRC = new URL('../src/', import.meta.url).pathname;
const RECORD = 8;

function reorderedFont(original) {
  const font = Buffer.from(original);
  const tables = font.readUInt16BE(4);
  let cmap = 0;
  for (let i = 0; i < tables; i++) {
    const o = 12 + i * 16;
    if (font.toString('ascii', o, o + 4) === 'cmap') cmap = font.readUInt32BE(o + 8);
  }
  const at = (i) => cmap + 4 + i * RECORD;
  const rec = (i) => ({ pid: font.readUInt16BE(at(i)), eid: font.readUInt16BE(at(i) + 2), off: font.readUInt32BE(at(i) + 4) });
  const [bmp, symbolic, wide, win, winWide] = [0, 1, 2, 3, 4].map(rec);
  const order = [bmp, win, { ...symbolic, pid: 2 }, { ...winWide, pid: 2 }, { ...wide, pid: 0, eid: 0 }];
  order.forEach((r, i) => {
    font.writeUInt16BE(r.pid, at(i));
    font.writeUInt16BE(r.eid, at(i) + 2);
    font.writeUInt32BE(r.off, at(i) + 4);
  });
  return font;
}

async function fontPair() {
  const dir = tempDir('weave-pdf-cmap-');
  mkdirSync(join(dir, 'src', 'vendor', 'fonts'), { recursive: true });
  for (const f of ['pdf.js', 'markdown.js']) cpSync(join(SRC, f), join(dir, 'src', f));
  const fontPath = join(dir, 'src', 'vendor', 'fonts', 'DejaVuSans.ttf');
  const original = readFileSync(join(SRC, 'vendor', 'fonts', 'DejaVuSans.ttf'));
  writeFileSync(fontPath, original);
  const url = pathToFileURL(join(dir, 'src', 'pdf.js')).href;
  const pristine = (await import(`${url}?pristine`)).unicodeFont();
  writeFileSync(fontPath, reorderedFont(original));
  const reordered = (await import(`${url}?reordered`)).unicodeFont();
  return { pristine, reordered };
}

test('a font whose only usable table is format 4 resolves BMP code points through it', async () => {
  const { pristine, reordered } = await fontPair();
  assert.ok(pristine.gidFor(0x41) > 0);
  assert.equal(reordered.gidFor(0x41), pristine.gidFor(0x41));
  assert.equal(reordered.gidFor(0x0416), pristine.gidFor(0x0416));
});

test('a format 6 subtable under the Unicode platform is not taken for the format 4 table', async () => {
  const { pristine, reordered } = await fontPair();
  for (const cp of [0x41, 0x7a, 0x0416, 0x2192]) {
    assert.equal(reordered.gidFor(cp), pristine.gidFor(cp), `glyph for U+${cp.toString(16)}`);
  }
});

test('code points above the BMP never resolve through the format 4 table', async () => {
  const { reordered } = await fontPair();
  assert.equal(reordered.gidFor(0x1f600), 0);
});
