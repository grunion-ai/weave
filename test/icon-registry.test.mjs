/* The vendored icon set and its registry (moving icons, 2026-09-02).
   Three generated files have to agree with each other and with the app:
   every registered name draws, every legacy Iconly name weave ever stored
   still resolves, every state mark with a Lucide twin names one that exists,
   and the motion CSS is scoped so 595 icons' keyframes cannot collide — and
   never loops (Kyle: "fire on load but not loop"). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
await import('../public/icon-registry.js');
await import('../public/vendor/lucide-moving.js');
await import('../public/field-dialog-core.js');
await import('../public/mark-icons.js');
const reg = globalThis.weaveIconRegistry;
const svg = globalThis.LUCIDE_MOVING;
const core = globalThis.fieldDialogCore;
const CSS = readFileSync(new URL('../public/vendor/lucide-moving.css', import.meta.url), 'utf8');

/* The set weave shipped 2026-08-22 → 2026-09-02: Iconly free (101) plus the
   eight it drew for money. A row that stored any of these keeps drawing. */
const LEGACY = [
  '2user', '3user', 'activity', 'adduser', 'arrow-down', 'arrow-down2', 'arrow-down3', 'arrow-downcircle',
  'arrow-downsquare', 'arrow-left', 'arrow-left2', 'arrow-left3', 'arrow-leftcircle', 'arrow-leftsquare', 'arrow-right', 'arrow-right2',
  'arrow-right3', 'arrow-rightcircle', 'arrow-rightsquare', 'arrow-up', 'arrow-up2', 'arrow-up3', 'arrow-upcircle', 'arrow-upsquare',
  'bag', 'bag2', 'bookmark', 'bug', 'buy', 'calendar', 'call', 'calling', 'callmissed',
  'callsilent', 'camera', 'category', 'chart', 'chat', 'closesquare', 'danger', 'delete',
  'discount', 'discovery', 'document', 'download', 'edit', 'editsquare', 'filter', 'filter2',
  'folder', 'game', 'graph', 'heart', 'hide', 'home', 'image', 'image2',
  'infocircle', 'infosquare', 'location', 'lock', 'login', 'logout', 'message', 'morecircle',
  'moresquare', 'notification', 'paper', 'paperdownload', 'paperfail', 'papernegative', 'paperplus', 'paperupload',
  'password', 'play', 'plus', 'profile', 'scan', 'search', 'send', 'setting',
  'shielddone', 'shieldfail', 'show', 'star', 'swap', 'ticket', 'ticketstar', 'ticksquare',
  'timecircle', 'timesquare', 'unlock', 'upload', 'video', 'voice', 'voice2', 'volumedown',
  'volumeoff', 'volumeup', 'wallet', 'work',
  'dollar', 'euro', 'card', 'coins', 'invoice', 'bank', 'trend', 'percent',
];

test('every registered name draws, and the registry is the whole vendored set', () => {
  assert.ok(reg.NAMES.length >= 120 && reg.NAMES.length <= 200, `the inventory is curated, not the library; got ${reg.NAMES.length}`);
  for (const n of core.ICON_INVENTORY) assert.ok(svg[n], `${n} is in a curated group but not vendored`);
  for (const n of reg.NAMES) assert.ok(core.ICON_INVENTORY.includes(n) || Object.values(reg.ALIASES).includes(n) || Object.values(reg.MARK_TWINS).includes(n), `${n} is vendored but nothing offers or resolves to it`);
  assert.deepEqual(reg.NAMES, Object.keys(svg).sort(), 'names and shapes are one list');
  for (const n of reg.NAMES) {
    assert.match(svg[n], /^<svg [^>]*viewBox="0 0 24 24"[^>]*stroke-width="2"/, `${n} is a Lucide shape on the 24 grid`);
    assert.doesNotMatch(svg[n], /\{|class:/, `${n} still carries a Svelte binding`);
    assert.equal(typeof reg.MOTION[n], 'number', `${n} names its motion length`);
    assert.equal(/data-mi=/.test(svg[n]), reg.MOTION[n] > 0, `${n}: parts wear data-mi exactly when the icon moves`);
    assert.ok(reg.CATEGORY[n], `${n} has a category`);
  }
});

test('most of the set moves — motion is the point of the switch', () => {
  const moving = reg.NAMES.filter((n) => reg.MOTION[n] > 0);
  assert.ok(moving.length >= 90, `only ${moving.length} icons move`);
  for (const n of moving) assert.ok(reg.MOTION[n] >= 100 && reg.MOTION[n] <= 4000, `${n} runs ${reg.MOTION[n]} ms`);
});

test('every legacy Iconly name resolves to a Lucide twin that exists', () => {
  for (const n of LEGACY) {
    const twin = reg.ALIASES[n];
    assert.ok(twin, `iconly:${n} has no alias`);
    assert.ok(svg[twin], `iconly:${n} → ${twin} is not in the set`);
    assert.equal(reg.resolve(`iconly:${n}`), twin);
  }
  assert.equal(reg.resolve('lucide:bell'), 'bell');
  assert.equal(reg.resolve('iconly:notification'), 'bell', 'the bell keeps ringing under its old name');
  assert.equal(reg.resolve('iconly:slides'), '', 'a reference that resolves to nothing is empty, not the prefix');
  assert.equal(reg.resolve('lucide:not-a-real-icon'), '');
  assert.equal(reg.resolve('🎉'), null, 'a bare string is not a reference; it paints itself');
  assert.equal(reg.canonical('iconly:bug'), 'lucide:bug', 'the picker rings the cell a legacy value now means');
  assert.equal(reg.canonical('🎉'), '🎉');
});

test('a state mark with a Lucide twin names one that exists; the rings have none', () => {
  const marks = Object.keys(globalThis.weaveMarkIcons.MARKS);
  for (const [ch, twin] of Object.entries(reg.MARK_TWINS)) {
    assert.ok(marks.includes(ch), `${ch} is not a drawn mark`);
    assert.ok(svg[twin], `${ch} → ${twin} is not in the set`);
  }
  for (const ring of ['○', '◔', '◐', '◑', '◕', '●']) assert.equal(reg.MARK_TWINS[ring], undefined, `${ring} has no Lucide shape and stays drawn`);
  assert.equal(reg.MARK_TWINS['✓'], 'check');
});

test('the motion CSS is scoped per icon and nothing loops', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]*\{/g, '');
  const selectors = [...body.matchAll(/(?:^|\})\s*([^{}]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);
  assert.ok(selectors.length > 100, 'the motion rules ride along');
  for (const s of selectors) assert.ok(s.split(',').every((x) => /^\.mi-[\w-]+ /.test(x.trim())), `unscoped rule: ${s}`);
  for (const m of CSS.matchAll(/@keyframes\s+([\w-]+)/g)) assert.match(m[1], /^mi-/, `keyframes ${m[1]} could collide`);
  assert.doesNotMatch(CSS, /infinite/, 'an icon plays once per trigger — nothing loops');
});

test('the generator names its two inputs, so the set can be rebuilt', () => {
  const gen = readFileSync(new URL('../scripts/build-lucide-moving.mjs', import.meta.url), 'utf8');
  assert.match(gen, /--moving/); assert.match(gen, /--lucide/);
  assert.match(gen, /jis3r\/icons/, 'credits the motion source');
});
