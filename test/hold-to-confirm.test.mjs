import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fnBody, liftFunction } from './lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');

const GRACE = 80;

class FakeEl {
  constructor(tag, attrs = {}) {
    this.tagName = tag; this.attrs = attrs; this.children = [];
    this.listeners = new Map(); this.classes = new Set(String(attrs.class ?? '').split(/\s+/).filter(Boolean));
    this.text = ''; this.captured = []; this.captureThrows = false; this.animations = [];
    this.classList = {
      add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), contains: (c) => this.classes.has(c),
    };
  }
  get textContent() { return this.text || this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  set textContent(v) { this.text = v; this.children = []; }
  append(...kids) { for (const k of kids) if (k != null) this.children.push(k); }
  addEventListener(type, fn) { (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)).push(fn); }
  fire(type, evt = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ type, preventDefault() { evt.prevented = true; }, ...evt }); return evt; }
  setPointerCapture(id) { if (this.captureThrows) throw new Error('gone'); this.captured.push(id); }
  getAnimations() { return this.animations; }
  find(cls) { return this.children.find((c) => c instanceof FakeEl && c.classes.has(cls)); }
}
const el = (tag, attrs = {}, ...kids) => { const n = new FakeEl(tag, attrs); n.append(...kids); return n; };
const iconEl = (name, cls) => el('i', { class: cls, 'data-icon': name });
const getComputedStyle = () => ({ transitionDuration: '0.9s' });
const SWEEP = 900;
const pending = () => ({ finished: new Promise(() => {}) });

const src = fnBody('holdToConfirm');
const holdToConfirm = liftFunction('holdToConfirm', { el, iconEl, getComputedStyle });

const make = ({ animations = [pending()] } = {}) => {
  let confirms = 0;
  const btn = holdToConfirm('Delete', async () => { confirms++; }, { holdingLabel: 'Hold to delete…' });
  const fill = btn.find('hold-fill');
  fill.animations = animations;
  const sweep = () => fill.fire('transitionend', { propertyName: 'transform' });
  return { btn, fill, sweep, confirms: () => confirms };
};

test('the function lifts out of app.js and builds the house button', () => {
  const { btn, fill } = make();
  assert.equal(btn.tagName, 'button');
  assert.ok(btn.classes.has('hold-btn') && btn.classes.has('text-danger'));
  assert.ok(fill, 'the fill is the element whose transition ends the hold');
  assert.equal(btn.textContent, 'Delete');
});

test('a hold carried through the sweep and the grace fires exactly once, and disarms', async () => {
  const { btn, sweep, confirms } = make();
  btn.fire('pointerdown', { pointerId: 7 });
  assert.ok(btn.classes.has('holding'));
  assert.equal(btn.textContent, 'Hold to delete…');
  sweep();
  assert.equal(confirms(), 0, 'transitionend alone does not fire — the grace comes first');
  await sleep(GRACE + 40);
  assert.equal(confirms(), 1);
  assert.ok(!btn.classes.has('holding'), 'the button disarms as it fires');
  assert.equal(btn.textContent, 'Delete');
});

test('the press captures the pointer so the release reaches the button wherever it lands', () => {
  const { btn } = make();
  btn.fire('pointerdown', { pointerId: 3 });
  assert.deepEqual(btn.captured, [3]);
  const kb = make();
  kb.btn.fire('keydown', { key: 'Enter' });
  assert.deepEqual(kb.btn.captured, [], 'a keyboard press has no pointer to capture');
  const gone = make();
  gone.btn.captureThrows = true;
  gone.btn.fire('pointerdown', { pointerId: 9 });
  assert.ok(gone.btn.classes.has('holding'), 'a capture that throws (element gone mid-press) still arms the hold');
});

for (const release of ['pointerup', 'pointerleave', 'blur', 'pointercancel', 'lostpointercapture']) {
  test(`${release} before the sweep ends cancels: nothing fires, even after the grace`, async () => {
    const { btn, sweep, confirms } = make();
    btn.fire('pointerdown', { pointerId: 1 });
    btn.fire(release);
    assert.ok(!btn.classes.has('holding'), `${release} disarms`);
    assert.equal(btn.textContent, 'Delete', 'and the label comes back');
    sweep();
    await sleep(GRACE + 40);
    assert.equal(confirms(), 0);
  });

  test(`${release} inside the grace after the sweep still cancels`, async () => {
    const { btn, sweep, confirms } = make();
    btn.fire('pointerdown', { pointerId: 1 });
    sweep();
    await sleep(GRACE / 4);
    btn.fire(release);
    await sleep(GRACE + 40);
    assert.equal(confirms(), 0, `a ${release} the main thread delivered late must still win`);
  });
}

test('keyboard: Enter or Space arms, keyup disarms, other keys do nothing', async () => {
  const { btn, sweep, confirms } = make();
  const other = btn.fire('keydown', { key: 'a' });
  assert.ok(!btn.classes.has('holding') && !other.prevented);
  const enter = btn.fire('keydown', { key: 'Enter' });
  assert.ok(btn.classes.has('holding') && enter.prevented, 'Enter arms and is swallowed so the button does not click');
  btn.fire('keyup', { key: 'Enter' });
  assert.ok(!btn.classes.has('holding'));
  sweep();
  await sleep(GRACE + 40);
  assert.equal(confirms(), 0);
  btn.fire('keydown', { key: ' ' });
  assert.ok(btn.classes.has('holding'), 'Space arms too');
  btn.fire('keydown', { key: ' ' });
  sweep();
  await sleep(GRACE + 40);
  assert.equal(confirms(), 1, 'a held key fires once, auto-repeat notwithstanding');
});

test('a release-and-re-press inside the grace is a new press: the old sweep never fires it', async () => {
  const { btn, sweep, confirms } = make();
  btn.fire('pointerdown', { pointerId: 1 });
  sweep();
  btn.fire('pointerup');
  btn.fire('pointerdown', { pointerId: 2 });
  await sleep(GRACE + 40);
  assert.equal(confirms(), 0, 'the first sweep belonged to a press that was released');
  assert.ok(btn.classes.has('holding'), 'the second press is still armed and sweeping');
  sweep();
  await sleep(GRACE + 40);
  assert.equal(confirms(), 1, 'and fires on its own sweep');
});

test('a transition on any other property is not the sweep', async () => {
  const { btn, fill, confirms } = make();
  btn.fire('pointerdown', { pointerId: 1 });
  fill.fire('transitionend', { propertyName: 'opacity' });
  await sleep(GRACE + 40);
  assert.equal(confirms(), 0);
  assert.ok(btn.classes.has('holding'), 'still armed — the real sweep has not ended');
});

test('a second pointerdown while armed does not restart or double-arm', async () => {
  const { btn, sweep, confirms } = make();
  btn.fire('pointerdown', { pointerId: 1 });
  btn.fire('pointerdown', { pointerId: 1 });
  assert.deepEqual(btn.captured, [1], 'captured once');
  sweep();
  await sleep(GRACE + 40);
  assert.equal(confirms(), 1);
});

test('the release list names every way a pointer stream can end', () => {
  const m = src.match(/for \(const ev of \[([^\]]*)\]\) btn\.addEventListener\(ev, stop\)/);
  assert.ok(m, 'the releases are one list wired to stop');
  const list = m[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));
  for (const ev of ['pointerup', 'pointerleave', 'blur', 'pointercancel', 'lostpointercapture']) assert.ok(list.includes(ev), `${ev} cancels`);
  assert.match(src, /btn\.addEventListener\('keyup', stop\)/);
  assert.match(src, /setTimeout\(async \(\) => \{\s*if \(!armed \|\| press !== thisPress\) return;/, 'the grace re-checks the press it belongs to');
});

test('the fill collapses untransitioned and sweeps on holding, so only a full hold can end a transform transition', () => {
  const rest = CSS.match(/\n\.hold-fill \{[^}]*\}/)?.[0] ?? '';
  assert.match(rest, /transition: transform 0s/, 'releasing early collapses with no transition — no transitionend can fire from it');
  const sweep = CSS.match(/\n\.hold-btn\.holding \.hold-fill \{[^}]*\}/)?.[0] ?? '';
  assert.match(sweep, /transform: scaleX\(1\)/);
  assert.match(sweep, /transition: transform \.9s linear/);
});

test('a sweep the browser never ran still finishes the hold (Issue #1439)', async () => {
  const { btn, confirms } = make({ animations: [] });
  btn.fire('pointerdown', { pointerId: 1 });
  assert.ok(btn.classes.has('holding'));
  await sleep(300);
  assert.equal(confirms(), 0, 'the press is not short-circuited: the fill duration still has to pass');
  await sleep(SWEEP + GRACE + 120 - 300);
  assert.equal(confirms(), 1, 'no transitionend ever fired, and the press still finished');
  assert.ok(!btn.classes.has('holding'), 'and the button let go');
});

test('a release before a never-run sweep would end cancels it (Issue #1439)', async () => {
  const { btn, confirms } = make({ animations: [] });
  btn.fire('pointerdown', { pointerId: 1 });
  await sleep(120);
  btn.fire('pointerup');
  assert.ok(!btn.classes.has('holding'));
  await sleep(SWEEP + GRACE + 120);
  assert.equal(confirms(), 0, 'the stand-in timer belongs to a press that is over');
});

test("a sweep that finishes fires the hold with no transitionend (Issue #1439)", async () => {
  let ran;
  const { btn, confirms } = make({ animations: [{ finished: new Promise((r) => { ran = r; }) }] });
  btn.fire('pointerdown', { pointerId: 1 });
  await sleep(40);
  assert.equal(confirms(), 0, 'the sweep is still running');
  ran();
  await sleep(GRACE + 80);
  assert.equal(confirms(), 1);
});

test('a sweep still running is never cut short by the clock (Issue #1439)', async () => {
  const { btn, confirms } = make({ animations: [pending()] });
  btn.fire('pointerdown', { pointerId: 1 });
  await sleep(SWEEP + GRACE + 200);
  assert.equal(confirms(), 0, 'a paused or slowed sweep decides when the hold is done, not a wall clock');
  assert.ok(btn.classes.has('holding'));
});
