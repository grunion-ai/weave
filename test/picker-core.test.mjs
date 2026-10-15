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

test('a chosen option leaves the list, so an armed row is always one you can add (multi)', () => {
  const s = multi([OPTIONS[3]]);
  assert.deepEqual(core.visible(s).map((o) => o.id), ['Backlog', 'To do', 'Doing'],
    'the chip in the box is not also a row in the list');
  assert.equal(core.visible(core.search(s, 'done')).length, 0, 'searching cannot bring it back either');
  assert.equal(core.has(s, 'Done'), true, 'membership is still knowable — the chips read it');
  assert.deepEqual(core.visible(single('Done')).map((o) => o.id), OPTIONS.map((o) => o.id),
    'single keeps its current value listed: a pick there overwrites rather than accumulates');
});

test('Enter after arrowing adds, and never un-picks what the arrow landed on (Issue #63)', () => {
  const armed = key(multi([OPTIONS[0]]), 'ArrowDown').state;
  assert.equal(core.visible(armed)[armed.active].id, 'To do', '↓ arms the first ADDABLE option');
  assert.deepEqual(core.ids(key(armed, 'Enter').state), ['Backlog', 'To do'], 'Enter adds it to the set');
});

test('a pick disarms the list, so a second Enter saves', () => {
  const picked = key(key(multi(), 'ArrowDown').state, 'Enter').state;
  assert.equal(picked.active, -1, 'nothing is armed under the cursor after a pick');
  assert.deepEqual(key(picked, 'Enter').effect, { type: 'commit' }, 'so the next Enter is the save');
});

test('Enter on a search that matches only what is already chosen does nothing', () => {
  const typed = core.search(multi([OPTIONS[3]]), 'done');
  const r = key(typed, 'Enter');
  assert.equal(r.handled, true, 'the key is the picker’s, not the input’s');
  assert.equal(r.effect, null, 'and it is not a save');
  assert.deepEqual(core.ids(r.state), ['Done'], 'the set stands');
  assert.equal(key(core.search(single('Doing'), 'zz'), 'Enter').effect, null,
    'single holds the same line: a search with no match is not a pick and not a close');
});

test('⌥1–⌥9 picks the numbered row without arrowing', () => {
  const r = core.keyDown(multi(), { key: '¡', quick: 2 });
  assert.deepEqual(core.ids(r.state), ['To do'], 'the second visible row');
  assert.equal(r.state.active, -1, 'and the list is disarmed after it, like any other pick');
  const filtered = core.keyDown(core.search(multi(), 'do'), { key: '¡', quick: 1 });
  assert.deepEqual(core.ids(filtered.state), ['Doing'], 'the number counts the VISIBLE rows, ranked');
  const chosen = core.keyDown(multi([OPTIONS[0]]), { key: '¡', quick: 1 });
  assert.deepEqual(core.ids(chosen.state), ['Backlog', 'To do'], 'and a chosen row is not one of them');
  const one = core.keyDown(single(), { key: '¡', quick: 3 });
  assert.deepEqual(one.effect, { type: 'pick', option: OPTIONS[2] }, 'single picks and closes on the spot');
  const past = core.keyDown(multi(), { key: '¡', quick: 9 });
  assert.equal(past.handled, true, 'a number past the end is still the picker’s key');
  assert.deepEqual(core.ids(past.state), [], 'it simply picks nothing — never types ª into the box');
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
  assert.equal(core.visible(s).some((o) => o.id === 'To do'), false, 'the clicked row leaves the list with it');
  assert.deepEqual(core.ids(core.toggle(s, OPTIONS[1])), [], 'toggle still takes one out — the × on the chip runs it');
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

test('rows draws a divider wherever the group changes and numbers only the options (Issue #796)', () => {
  const states = [
    { id: '—', label: '—' },
    { id: 'Backlog', label: 'Backlog', group: 'Not started' },
    { id: 'Triage', label: 'Triage', group: 'Not started' },
    { id: 'Building', label: 'Building', group: 'In progress' },
    { id: 'Shipped', label: 'Shipped', group: 'Done' },
  ];
  const drawn = core.rows(states);
  assert.deepEqual(drawn.filter((r) => r.kind === 'divider').map((r) => r.label),
    ['Not started', 'In progress', 'Done'],
    'one divider per category, in the order the options arrive, and none for the ungrouped clear row');
  assert.deepEqual(drawn.filter((r) => r.kind === 'option').map((r) => [r.quick, r.option.id]), [
    [1, '—'], [2, 'Backlog'], [3, 'Triage'], [4, 'Building'], [5, 'Shipped'],
  ], 'the quick pick number is the option’s place in the visible list, which dividers never shift');
  assert.deepEqual(drawn.map((r) => r.kind),
    ['option', 'divider', 'option', 'option', 'divider', 'option', 'divider', 'option'],
    'a divider sits above the first option of its category');
});

test('rows leaves a group-free list exactly as it is, and numbers past nine without a quick pick (Issue #796)', () => {
  assert.deepEqual(core.rows(OPTIONS).map((r) => r.kind), ['option', 'option', 'option', 'option'],
    'no groups, no dividers');
  const many = Array.from({ length: 11 }, (_, i) => ({ id: `o${i}`, label: `o${i}` }));
  const quick = core.rows(many).map((r) => r.quick);
  assert.deepEqual(quick.slice(0, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(quick.slice(9), [null, null], 'only the first nine rows carry a quick pick');
});

test('rows repeats a divider when a category comes round again, so the label always names the rows under it (Issue #796)', () => {
  const drawn = core.rows([
    { id: 'a', label: 'a', group: 'Done' },
    { id: 'b', label: 'b', group: 'Not started' },
    { id: 'c', label: 'c', group: 'Done' },
  ]);
  assert.deepEqual(drawn.filter((r) => r.kind === 'divider').map((r) => r.label), ['Done', 'Not started', 'Done']);
});

test('createOffer names the term to create, and says whether Enter is the one that makes it (Issue #800)', () => {
  const empty = core.blank({ mode: 'single', options: [] });
  assert.equal(core.createOffer(empty), null, 'nothing typed, nothing to create');
  const typed = core.search(empty, 'Nightly');
  assert.deepEqual(core.createOffer(typed), { term: 'Nightly', enter: true },
    'an empty select with a typed value offers to create it, and Enter is what does it');
  assert.deepEqual(core.createOffer(core.search(empty, '  Nightly  ')), { term: 'Nightly', enter: true },
    'the term is trimmed, so no option is created with its padding');
});

test('createOffer stands down on an exact match and steps aside for a partial one (Issue #800)', () => {
  const s = core.blank({ mode: 'single', options: OPTIONS });
  assert.equal(core.createOffer(core.search(s, 'Doing')), null, 'an option by that name already exists');
  assert.equal(core.createOffer(core.search(s, 'doing')), null, 'and case is not a new option');
  assert.deepEqual(core.createOffer(core.search(s, 'Do')), { term: 'Do', enter: false },
    'a partial match still offers Do as a new option, but Enter picks the match that is armed');
  assert.deepEqual(core.createOffer(core.search(s, 'zzz')), { term: 'zzz', enter: true },
    'nothing matches, so Enter creates');
});

test('createOffer reads a multi picker through what is still on the list (Issue #800)', () => {
  const m = core.blank({ mode: 'multi', options: OPTIONS, staged: [OPTIONS[2]] });
  assert.equal(core.createOffer(core.search(m, 'Doing')), null, 'a staged option is still an option, never a new one');
  assert.deepEqual(core.createOffer(core.search(m, 'Nightly')), { term: 'Nightly', enter: true });
});

test('a picker titled Priority with no placeholder hints Search priority… (Issue #799)', () => {
  assert.equal(core.hint('Priority'), 'Search priority…');
  assert.equal(core.hint('Icon'), 'Search icon…');
  assert.equal(core.hint(''), 'Search…', 'an untitled picker keeps the bare hint');
  assert.equal(core.hint(null), 'Search…');
});
