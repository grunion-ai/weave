/* holdToConfirm, driven headless (review of change 143, 2026-09-02).

   Kyle: "hold to delete sticks when more than half done and doesn't stop on
   release." The browser gate (hold-release-browser.test.mjs) skips on a bare
   checkout, so the timer and release logic is exercised here against the
   REAL function lifted out of public/app.js, with a fake element that only
   knows listeners, classes and text. Every release kind cancels; only a hold
   carried through the sweep AND the 80ms grace fires; a re-press inside the
   grace is a new press and never inherits the old one's confirm. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');

const GRACE = 80;

/* The least element that can host the function: listeners, a classList, a
   textContent, and a pointer-capture that records what it was asked. */
class FakeEl {
  constructor(tag, attrs = {}) {
    this.tagName = tag; this.attrs = attrs; this.children = [];
    this.listeners = new Map(); this.classes = new Set(String(attrs.class ?? '').split(/\s+/).filter(Boolean));
    this.text = ''; this.captured = []; this.captureThrows = false;
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
  find(cls) { return this.children.find((c) => c instanceof FakeEl && c.classes.has(cls)); }
}
const el = (tag, attrs = {}, ...kids) => { const n = new FakeEl(tag, attrs); n.append(...kids); return n; };
const iconEl = (name, cls) => el('i', { class: cls, 'data-icon': name });

const src = APP.slice(APP.indexOf('function holdToConfirm('), APP.indexOf('\n}\n', APP.indexOf('function holdToConfirm(')) + 3);
const holdToConfirm = new Function('el', 'iconEl', `${src}; return holdToConfirm;`)(el, iconEl);

/* A button wired to count confirms, plus the fill to fire transitionend on. */
const make = () => {
  let confirms = 0;
  const btn = holdToConfirm('Delete', async () => { confirms++; }, { holdingLabel: 'Hold to delete…' });
  const fill = btn.find('hold-fill');
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
    sweep(); // the compositor finished the sweep anyway (or a late event arrives)
    await sleep(GRACE + 40);
    assert.equal(confirms(), 0);
  });

  test(`${release} inside the grace after the sweep still cancels`, async () => {
    const { btn, sweep, confirms } = make();
    btn.fire('pointerdown', { pointerId: 1 });
    sweep();
    await sleep(GRACE / 4); // the queued release lands late, but before the grace is up
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
  btn.fire('keydown', { key: ' ' }); // auto-repeat while held
  sweep();
  await sleep(GRACE + 40);
  assert.equal(confirms(), 1, 'a held key fires once, auto-repeat notwithstanding');
});

test('a release-and-re-press inside the grace is a new press: the old sweep never fires it', async () => {
  const { btn, sweep, confirms } = make();
  btn.fire('pointerdown', { pointerId: 1 });
  sweep();
  btn.fire('pointerup');
  btn.fire('pointerdown', { pointerId: 2 }); // re-pressed within the grace
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

/* Source and CSS contracts the timer path rests on. */
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
