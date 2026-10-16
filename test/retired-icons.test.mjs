import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
await import('../public/icon-registry.js');
await import('../public/vendor/lucide-moving.js');
await import('../public/field-dialog-core.js');
await import('../public/starter-core.js');

const ROOT = join(import.meta.dirname, '..');
const reg = globalThis.weaveIconRegistry;
const THIRD_PARTY = new Set(['public/vendor/cytoscape.min.js', 'public/vendor/mermaid.min.js', 'public/vendor/tabler.min.css', 'public/vendor/vditor', 'public/vendor/fonts']);
const TEXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg']);
const RETIRED_MAP = /^\s*const RETIRED = \{"layers":"folder-kanban"\};$/;
const ICON_USE = /lucide:layers\b|['"`]layers['"`]|\bmi-layers\b|\blayers-icon\b/;

function* files(dir) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (THIRD_PARTY.has(rel)) continue;
    if (e.isDirectory()) yield* files(rel);
    else if (TEXT.has(extname(e.name))) yield rel;
  }
}

test('layers is gone as an icon from public/ and src/ (Issue #948)', () => {
  const hits = [];
  for (const dir of ['public', 'src']) {
    for (const f of files(dir)) {
      readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
        if (ICON_USE.test(line) && !RETIRED_MAP.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(hits, [], 'the layers icon came back');
  assert.equal(existsSync(join(ROOT, 'public/vendor/icons/layers.svg')), false, 'layers.svg is still vendored');
});

test('the picker and the registry no longer offer layers', () => {
  assert.equal(reg.NAMES.includes('layers'), false);
  assert.equal('layers' in reg.CATEGORY || 'layers' in reg.MOTION, false);
  assert.equal(globalThis.LUCIDE_MOVING.layers, undefined);
  assert.equal(globalThis.fieldDialogCore.ICON_INVENTORY.includes('layers'), false);
});

test('a stored lucide:layers value draws as its replacement', () => {
  assert.equal(reg.resolve('lucide:layers'), 'folder-kanban');
  assert.equal(reg.canonical('lucide:layers'), 'lucide:folder-kanban');
  for (const twin of Object.values(reg.RETIRED)) assert.ok(reg.NAMES.includes(twin), `${twin} is vendored`);
});

test('every former layers slot names its object', () => {
  const S = globalThis.WeaveStarters;
  const projects = S.CATEGORIES.find((c) => c.id === 'projects');
  assert.equal(projects.icon, 'lucide:folder-kanban');
  const team = S.TEMPLATES.find((t) => t.id === 'projects');
  assert.equal(S.spec(team).spaces[0].tables.find((t) => t.name === 'Projects').icon, 'lucide:folder-kanban');
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.match(app, /tableControlButton\('table-group-btn', 'Group', 'group'\)/);
  assert.match(app, /rollup: 'sigma'/);
  assert.match(app, /deckBtn\('deck-promote', [^)]*'copy-plus'/);
  assert.match(app, /hit\.kind === 'workspace' \? 'house'/);
  for (const n of ['folder-kanban', 'group', 'sigma', 'copy-plus', 'house']) assert.ok(reg.NAMES.includes(n), `${n} is vendored`);
});
