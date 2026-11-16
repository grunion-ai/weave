import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESKTOP_MIN, PHONE_MAX, TRAY_HIDDEN_MAX, TRAY_SHOWN_MIN, WIDTH } from './lib/viewports.mjs';

const read = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8');
const CSS = read('style.css');
const APP = read('app.js');

test('the shell has two width switches, read from public/app.js (Features #377, #379)', () => {
  assert.equal(PHONE_MAX, 719);
  assert.equal(DESKTOP_MIN, 720);
  assert.equal(TRAY_HIDDEN_MAX, 1199);
  assert.equal(TRAY_SHOWN_MIN, 1200);
  assert.ok(WIDTH.phone < WIDTH.widestPhoneFormat, 'phones sit inside phone format');
  assert.equal(WIDTH.halfLaptop, 1512 / 2, 'half of a 14-inch laptop screen at its default scale');
  assert.ok(WIDTH.halfLaptop - 24 >= DESKTOP_MIN, 'a half-screen window keeps desktop format with room for tile margins and a scrollbar');
});

test('every width query in the stylesheet sits inside phone format or starts desktop format (Feature #377)', () => {
  const used = [...CSS.matchAll(/@media[^{]*?\((max|min)-width: (\d+)px\)/g)].map((m) => ({ edge: m[1], px: Number(m[2]) }));
  assert.ok(used.length > 40, `the stylesheet still carries its width queries: ${used.length}`);
  const strays = used.filter((q) => (q.edge === 'max' ? q.px > PHONE_MAX : q.px !== DESKTOP_MIN)).map((q) => `${q.edge}-width: ${q.px}px`);
  assert.deepEqual([...new Set(strays)], [], 'a desktop rule that starts anywhere but the switch, or a phone rule that reaches past it, brings back an in-between layout');
  assert.ok(used.some((q) => q.edge === 'max' && q.px === PHONE_MAX) && used.some((q) => q.edge === 'min' && q.px === DESKTOP_MIN), 'both sides of the switch are in use');
});

test('every width query in the app script is one of the three named ones (Feature #377)', () => {
  const named = [...APP.matchAll(/const (\w+) = matchMedia\('\((?:max|min)-width: (\d+)px\)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(named.sort(), [`MENU_SHEET:${PHONE_MAX}`, `dockCoversScreen:${PHONE_MAX}`, `narrowShell:${PHONE_MAX}`, `tightShell:${TRAY_HIDDEN_MAX}`].sort());
  const inline = [...APP.matchAll(/matchMedia\('\((?:max|min)-width: \d+px\)'\)/g)].length;
  assert.equal(inline, named.length, 'no unnamed width query hides in the script');
});
