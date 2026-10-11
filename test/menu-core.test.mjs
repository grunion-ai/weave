import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/menu-core.js');
const core = globalThis.menuCore;
const run = () => {};
const item = (label, section, extra = {}) => ({ label, section, run, ...extra });
const shape = (plan) => plan.map((s) => [s.section, s.label, s.items.map((i) => i.label)]);

test('the sections are settings, organize, share, export, delete, in that order', () => {
  assert.deepEqual(core.SECTIONS, ['settings', 'organize', 'share', 'export', 'delete']);
});

test('items are drawn in section order whatever order the caller lists them in', () => {
  const plan = core.plan([
    item('Move to trash', 'delete'),
    item('CSV', 'export'),
    item('Duplicate', 'organize'),
    item('Field settings…', 'settings'),
    item('New share page…', 'share'),
  ]);
  assert.deepEqual(plan.map((s) => s.section), core.SECTIONS);
});

test('rows keep the caller order inside a section', () => {
  const plan = core.plan([item('Markdown', 'export'), item('HTML', 'export'), item('PDF', 'export')]);
  assert.deepEqual(plan[0].items.map((i) => i.label), ['Markdown', 'HTML', 'PDF']);
});

test('an empty section draws nothing', () => {
  const plan = core.plan([item('Duplicate', 'organize'), item('Move to trash', 'delete')]);
  assert.deepEqual(shape(plan), [['organize', null, ['Duplicate']], ['delete', null, ['Move to trash']]]);
  assert.deepEqual(core.plan([]), []);
});

test('only Export carries a label', () => {
  const plan = core.plan(core.SECTIONS.map((s) => item(`a ${s} row`, s)));
  assert.deepEqual(plan.map((s) => s.label), [null, null, null, 'Export', null]);
});

test('a missing or unknown section is refused, naming the row', () => {
  assert.throws(() => core.plan([item('Rename…', 'edit')]), /unknown menu section "edit" on "Rename…"/);
  assert.throws(() => core.plan([{ label: 'Loose', run }]), /unknown menu section "undefined" on "Loose"/);
});

test('a row needs a label and something to do', () => {
  assert.throws(() => core.plan([{ section: 'organize', run }]), /needs a label/);
  assert.throws(() => core.plan([{ label: 'Inert', section: 'organize' }]), /"Inert" has nothing to run/);
  assert.doesNotThrow(() => core.plan([{ label: 'Link', section: 'share', href: '#/x' }]));
});

test('delete is last and holds one row', () => {
  const plan = core.plan([item('Move to trash', 'delete'), item('CSV', 'export')]);
  assert.equal(plan.at(-1).section, 'delete');
  assert.throws(() => core.plan([item('Move to trash', 'delete'), item('Delete forever', 'delete')]), /one delete row/);
});

test('falsy entries are skipped, so a caller can leave out a row with a condition', () => {
  const plan = core.plan([null, item('Duplicate', 'organize'), false, undefined]);
  assert.deepEqual(shape(plan), [['organize', null, ['Duplicate']]]);
});

test('phone-only rows leave the plan unless the menu is a sheet', () => {
  const items = [item('Activity', 'organize', { phone: true }), item('Share…', 'share')];
  assert.deepEqual(shape(core.plan(items)), [['share', null, ['Share…']]]);
  assert.deepEqual(shape(core.plan(items, { sheet: true })), [['organize', null, ['Activity']], ['share', null, ['Share…']]]);
});

test('arrows wrap, Home and End go to the ends, other keys do not move', () => {
  assert.equal(core.move(4, 0, 'ArrowDown'), 1);
  assert.equal(core.move(4, 3, 'ArrowDown'), 0);
  assert.equal(core.move(4, 0, 'ArrowUp'), 3);
  assert.equal(core.move(4, -1, 'ArrowDown'), 0);
  assert.equal(core.move(4, 2, 'Home'), 0);
  assert.equal(core.move(4, 1, 'End'), 3);
  assert.equal(core.move(4, 1, 'Enter'), null);
  assert.equal(core.move(0, 0, 'ArrowDown'), null);
});

test('typeahead jumps to the next row starting with the typed letters', () => {
  const labels = ['Rename table…', 'Change icon…', 'Move to space…', 'Duplicate table', 'Delete table'];
  assert.equal(core.typeahead(labels, 0, 'm'), 2);
  assert.equal(core.typeahead(labels, 0, 'd'), 3, 'searching starts after the focused row');
  assert.equal(core.typeahead(labels, 3, 'd'), 4, 'the same letter again moves on to the next match');
  assert.equal(core.typeahead(labels, 4, 'd'), 3, 'and wraps');
  assert.equal(core.typeahead(labels, 3, 'de'), 4, 'more letters narrow it');
  assert.equal(core.typeahead(labels, 3, 'du'), 3, 'a longer buffer can stay on the focused row');
  assert.equal(core.typeahead(labels, 0, 'CH'), 1, 'case does not matter');
  assert.equal(core.typeahead(labels, 1, 'z'), -1, 'no match leaves focus where it is');
});
