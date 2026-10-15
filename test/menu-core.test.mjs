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

test('the format registry runs Markdown, Mermaid, HTML, PDF, CSV, JSON, each with its extension', () => {
  assert.deepEqual(core.FORMATS.map((f) => [f.key, f.label, f.ext]), [
    ['md', 'Markdown', '.md'], ['mmd', 'Mermaid', '.mmd'], ['html', 'HTML', '.html'],
    ['pdf', 'PDF', '.pdf'], ['csv', 'CSV', '.csv'], ['json', 'JSON', '.json'],
  ]);
});

test('exportSection keeps registry order, filters to what the object serves, and puts the extension in the hint', () => {
  const rows = core.exportSection({ name: 'Plan', serves: ['pdf', 'md', 'html'], href: (k) => `/e/1/entity.${k}` });
  assert.deepEqual(rows.map((r) => [r.label, r.hint, r.section, r.href, r.download]), [
    ['Markdown', '.md', 'export', '/e/1/entity.md', 'Plan.md'],
    ['HTML', '.html', 'export', '/e/1/entity.html', 'Plan.html'],
    ['PDF', '.pdf', 'export', '/e/1/entity.pdf', 'Plan.pdf'],
  ]);
  assert.deepEqual(core.exportSection({ name: 'x', serves: [], href: () => '' }), []);
  assert.throws(() => core.exportSection({ name: 'x', serves: ['docx'], href: () => '' }), /unknown export format "docx"/);
});

test('every kind has exactly one definition, and the registry names them all', () => {
  assert.deepEqual(core.kinds(), ['table', 'record', 'doc', 'space', 'share-page', 'workspace', 'field']);
  assert.throws(() => core.definition('deck'), /no menu definition for "deck"/);
});

test('the definitions match the target menu table', () => {
  const shape = (kind) => Object.fromEntries(core.SECTIONS.map((s) => [s, core.definition(kind)[s] ?? []]).filter(([, ids]) => ids.length));
  assert.deepEqual(shape('table'), { organize: ['move', 'duplicate'], share: ['share', 'share-page', 'forms', 'create-link'], export: ['csv'], delete: ['delete'] });
  assert.deepEqual(shape('record'), { organize: ['duplicate'], share: ['share'], export: ['md', 'html', 'pdf'], delete: ['delete'] });
  assert.deepEqual(shape('doc'), { export: ['md', 'mmd', 'html', 'pdf'] });
  assert.deepEqual(shape('space'), { delete: ['delete'] });
  assert.deepEqual(shape('share-page'), { delete: ['delete'] });
  assert.deepEqual(shape('workspace'), { share: ['link-preview'] });
  assert.deepEqual(shape('field'), { settings: ['settings'], organize: ['insert'], delete: ['delete'] });
});

test('the workspace menu holds no delete row: workspace delete leaves the interface (Feature #297)', () => {
  assert.equal(core.definition('workspace').delete, undefined);
  assert.throws(() => core.assemble('workspace', { delete: { label: 'Delete workspace…', run() {} } }), /"delete" is not on the workspace menu/);
});

test('only a kind whose settings live in a dialog with no inline surface declares a Settings row', () => {
  const withSettings = core.kinds().filter((k) => core.definition(k).settings?.length);
  assert.deepEqual(withSettings, ['field']);
});

test('every export list in a definition follows the format registry order', () => {
  const order = core.FORMATS.map((f) => f.key);
  for (const kind of core.kinds()) {
    const ids = core.definition(kind).export ?? [];
    assert.deepEqual(ids, [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)), `${kind} export order`);
  }
});

test('assemble lays rows out in the definition order, whatever order the caller writes them in', () => {
  const rows = core.assemble('table', {
    delete: { label: 'Delete table', run },
    export: core.exportSection({ name: 'Task', serves: ['csv'], href: () => '/x.csv' }),
    'share-page': { label: 'New share page…', run },
    duplicate: { label: 'Duplicate', run },
    share: { label: 'Share…', run },
    move: { label: 'Move to space…', run },
  });
  assert.deepEqual(rows.map((r) => [r.section, r.label]), [
    ['organize', 'Move to space…'], ['organize', 'Duplicate'], ['share', 'Share…'], ['share', 'New share page…'], ['export', 'CSV'], ['delete', 'Delete table'],
  ]);
  assert.deepEqual(shape(core.plan(rows)).map((s) => s[0]), ['organize', 'share', 'export', 'delete']);
});

test('context may hide a row that cannot work there, never add one', () => {
  const rows = core.assemble('table', { move: null, duplicate: false, share: { label: 'Share…', run }, delete: { label: 'Delete table', run } });
  assert.deepEqual(rows.map((r) => r.label), ['Share…', 'Delete table']);
  assert.throws(() => core.assemble('space', { rename: { label: 'Rename…', run } }), /"rename" is not on the space menu/);
  assert.throws(() => core.assemble('record', { export: core.exportSection({ name: 'x', serves: ['csv'], href: () => '' }) }), /CSV is not on the record menu/);
});

test('assemble drops export formats the object does not serve and keeps the rest in registry order', () => {
  const rows = core.assemble('doc', { export: core.exportSection({ name: 'Notes', serves: ['pdf', 'md'], href: (k) => k }) });
  assert.deepEqual(rows.map((r) => r.label), ['Markdown', 'PDF']);
});
