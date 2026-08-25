/* public/picker-core.js — the pure half of the token-box picker (Kyle,
   2026-08-25): "selected chips should be in the cursor box so the user can
   navigate around with arrows to quickly delete, and type to add with the top
   fit autoselected on search". Every rule below is one sentence of that ask.
   The DOM half (searchPicker in app.js) is contract-tested in
   test/ui-contract.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/picker-core.js');
const core = globalThis.pickerCore;

const OPTIONS = [
  { id: 'Backlog', label: 'Backlog' },
  { id: 'To do', label: 'To do' },
  { id: 'Doing', label: 'Doing' },
  { id: 'Done', label: 'Done' },
];
const multi = (staged = []) => core.blank({ mode: 'multi', options: OPTIONS, staged });
const single = (currentId = null, clearId = null) => core.blank({ mode: 'single', options: OPTIONS, currentId, clearId });
const key = (state, k, atStart = true) => core.keyDown(state, { key: k, atStart });

test('the top fit is the best match, not the first one that contains the letters', () => {
  assert.deepEqual(core.rankOptions(OPTIONS, 'do').map((o) => o.id), ['Doing', 'Done', 'To do']);
  assert.equal(core.rankOptions(OPTIONS, 'done')[0].id, 'Done', 'an exact label wins');
  assert.equal(core.rankOptions(OPTIONS, 'DOI')[0].id, 'Doing', 'matching ignores case');
  assert.deepEqual(core.rankOptions(OPTIONS, 'zz'), [], 'no match, no options');
  assert.deepEqual(core.rankOptions(OPTIONS, '').map((o) => o.id), OPTIONS.map((o) => o.id),
    'an empty search keeps the author’s own order');
  // A hint (the record's #id on a link picker) matches, but never outranks a label.
  const withHint = [{ id: 'a', label: 'Alpha', hint: '#7' }, { id: 'b', label: 'Seven', hint: '#2' }];
  assert.deepEqual(core.rankOptions(withHint, 'seven').map((o) => o.id), ['b']);
  assert.deepEqual(core.rankOptions(withHint, '7').map((o) => o.id), ['a']);
});

test('a picker opens with nothing armed for multi, and on its current value for single', () => {
  assert.equal(multi().active, -1);
  assert.equal(multi().caret, null, 'the cursor starts in the text, not on a chip');
  assert.deepEqual(core.ids(multi([OPTIONS[0]])), ['Backlog'], 'existing picks are already chips');
  assert.equal(single('Doing').active, 2, 'single opens armed on what is set');
  assert.deepEqual(core.ids(single('Doing')), ['Doing'], 'and carries it as the one chip in the box');
  assert.deepEqual(core.ids(single(null)), [], 'an unset select shows no chip');
});

test('typing arms the top fit; clearing the search disarms it', () => {
  const s = core.search(multi(), 'do');
  assert.equal(s.active, 0);
  assert.equal(core.visible(s)[s.active].id, 'Doing', 'Enter would add the top fit');
  assert.equal(core.search(s, '').active, -1, 'an empty search arms nothing, so Enter means done');
});

test('Enter adds the armed option, clears the search, and stays open (multi)', () => {
  const r = key(core.search(multi(), 'do'), 'Enter');
  assert.equal(r.handled, true);
  assert.equal(r.effect, null, 'adding a chip is not a save');
  assert.deepEqual(core.ids(r.state), ['Doing']);
  assert.equal(r.state.query, '', 'the search empties, ready for the next one');
  assert.equal(r.state.active, -1);
});

test('Enter on an option already in the box takes it back out (multi)', () => {
  const r = key(core.search(multi([OPTIONS[3]]), 'done'), 'Enter');
  assert.deepEqual(core.ids(r.state), [], 'a second Enter is a toggle');
});

test('Enter on an empty search saves the set (multi)', () => {
  const r = key(multi([OPTIONS[0]]), 'Enter');
  assert.deepEqual(r.effect, { type: 'commit' });
  assert.deepEqual(core.ids(r.state), ['Backlog'], 'the commit carries the chips as they stand');
});

test('a single select overwrites: Enter picks and the caller closes', () => {
  const r = key(core.search(single('Backlog'), 'doi'), 'Enter');
  assert.equal(r.effect.type, 'pick');
  assert.equal(r.effect.option.id, 'Doing');
  // Enter with nothing typed re-picks what is already set — the field is
  // updated and the picker is done either way.
  assert.deepEqual(key(single('Doing'), 'Enter').effect, { type: 'pick', option: OPTIONS[2] });
  assert.deepEqual(key(single(null), 'Enter').effect, { type: 'commit' }, 'nothing set, nothing typed: just leave');
});

test('↑ ↓ walk the visible list and stop at its ends', () => {
  let s = multi();
  s = key(s, 'ArrowDown').state;
  assert.equal(s.active, 0);
  for (let i = 0; i < 9; i++) s = key(s, 'ArrowDown').state;
  assert.equal(s.active, OPTIONS.length - 1, '↓ stops at the last option');
  for (let i = 0; i < 9; i++) s = key(s, 'ArrowUp').state;
  assert.equal(s.active, 0, '↑ stops at the first');
  // The list is what the search left, not the whole set.
  const filtered = key(core.search(multi(), 'do'), 'ArrowDown').state;
  assert.equal(core.visible(filtered).length, 3);
});

test('← walks into the chips, → walks back out to the caret', () => {
  const s = multi([OPTIONS[0], OPTIONS[1], OPTIONS[2]]);
  const one = key(s, 'ArrowLeft').state;
  assert.equal(one.caret, 2, '← from the text lands on the last chip');
  const two = key(one, 'ArrowLeft').state;
  assert.equal(two.caret, 1);
  assert.equal(key(key(two, 'ArrowLeft').state, 'ArrowLeft').state.caret, 0, '← stops at the first chip');
  assert.equal(key(two, 'ArrowRight').state.caret, 2);
  assert.equal(key(key(two, 'ArrowRight').state, 'ArrowRight').state.caret, null, '→ past the last chip is the text again');
  assert.equal(key(s, 'ArrowRight').handled, false, '→ in the text is the input’s own key');
  assert.equal(key(multi(), 'ArrowLeft').handled, false, 'no chips, nothing to walk');
});

test('a caret mid-text keeps its own arrow keys', () => {
  const s = core.search(multi([OPTIONS[0]]), 'doi');
  assert.equal(key(s, 'ArrowLeft', false).handled, false, '← inside typed text moves the text caret');
  assert.equal(key(s, 'ArrowLeft', true).state.caret, 0, '← at the start of the text reaches the chip');
});

test('Backspace deletes chips, and only once the search is empty', () => {
  const three = multi([OPTIONS[0], OPTIONS[1], OPTIONS[2]]);
  assert.equal(key(core.search(three, 'do'), 'Backspace').handled, false, 'typed text is the input’s to edit');
  const last = key(three, 'Backspace').state;
  assert.deepEqual(core.ids(last), ['Backlog', 'To do'], 'Backspace with the cursor in the text takes the last chip');
  assert.equal(last.caret, null, 'and leaves the cursor where it was');
  const onChip = key(key(three, 'ArrowLeft').state, 'Backspace').state;
  assert.deepEqual(core.ids(onChip), ['Backlog', 'To do']);
  assert.equal(onChip.caret, 1, 'deleting a chip lands on the one before it');
  const first = key({ ...three, caret: 0 }, 'Backspace').state;
  assert.equal(first.caret, 0, 'deleting the first chip lands on the new first');
  const empty = key({ ...multi([OPTIONS[0]]), caret: 0 }, 'Backspace').state;
  assert.equal(empty.caret, null, 'the last chip out returns the cursor to the text');
  assert.equal(key(multi(), 'Backspace').handled, false, 'an empty box has nothing to delete');
});

test('Delete takes the chip the cursor sits on and stays put', () => {
  const three = multi([OPTIONS[0], OPTIONS[1], OPTIONS[2]]);
  const r = key({ ...three, caret: 0 }, 'Delete').state;
  assert.deepEqual(core.ids(r), ['To do', 'Doing']);
  assert.equal(r.caret, 0, 'the chip that slid into place is now under the cursor');
  assert.equal(key({ ...three, caret: 2 }, 'Delete').state.caret, 1, 'deleting the last one steps back');
  assert.equal(key(three, 'Delete').handled, false, 'Delete in the text deletes text, never a chip');
});

test('a single select clears through its clear option; a workflow state cannot be emptied', () => {
  const withClear = key(single('Doing', '—'), 'Backspace');
  assert.deepEqual(withClear.effect, { type: 'pick', option: { id: '—', label: '—' } },
    'removing the chip IS picking the clear option — same commit, same close');
  assert.equal(key(single('Doing'), 'Backspace').handled, false, 'a state field has no empty value to pick');
  assert.equal(key(single(null, '—'), 'Backspace').handled, false, 'nothing set, nothing to clear');
});

test('Escape closes, and unknown keys belong to the input', () => {
  assert.deepEqual(key(multi(), 'Escape').effect, { type: 'close' });
  assert.equal(key(multi(), 'a').handled, false);
  assert.equal(key(multi(), 'Tab').handled, false, 'Tab carries on along the row');
});

test('the mouse edits the same state: a row toggles, a chip’s × removes', () => {
  const s = core.toggle(multi(), OPTIONS[1]);
  assert.deepEqual(core.ids(s), ['To do']);
  assert.equal(core.has(s, 'To do'), true, 'the row can show its ✓');
  assert.deepEqual(core.ids(core.toggle(s, OPTIONS[1])), [], 'clicking it again takes it out');
  assert.deepEqual(core.ids(core.removeId(multi([OPTIONS[0], OPTIONS[1]]), 'Backlog')), ['To do']);
  assert.equal(core.removeId(multi([OPTIONS[0]]), 'Backlog').caret, null, 'a click never leaves the cursor on a chip');
});

test('state is never mutated in place — a redraw always reads the value it was handed', () => {
  const s = multi([OPTIONS[0]]);
  const before = core.ids(s);
  key(s, 'Backspace');
  core.toggle(s, OPTIONS[2]);
  core.search(s, 'do');
  assert.deepEqual(core.ids(s), before);
});
