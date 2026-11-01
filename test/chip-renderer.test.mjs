import test from 'node:test';
import assert from 'node:assert/strict';
import { read, APP, HTML, CSS } from './lib/source.mjs';
import { renderMarkdown } from '../src/markdown.js';

await import('../public/chip-core.js');
await import('../public/view-core.js');
await import('../public/cell-graphics.js');
await import('../public/chip-view.js');
const chip = globalThis.weaveChipView;

const MARKDOWN = read('src/markdown.js');

const view = (over = {}) => ({
  shape: 'chip', id: 'e1', publicId: 191, url: '/e/e1', name: 'The Ledger chip',
  link: true, state: null, description: null, fields: [], ...over,
});

test('one module renders the chip, and the page loads it before app.js', () => {
  assert.equal(typeof chip.chipHtml, 'function');
  assert.match(HTML, /<script src="\/chip-view\.js" defer><\/script>/);
  assert.ok(HTML.indexOf('/chip-view.js') < HTML.indexOf('/app.js'),
    'chip-view must load before app.js reads it');
  assert.ok(HTML.indexOf('/view-core.js') < HTML.indexOf('/chip-view.js'),
    'and after the cores it reads');
});

test('the Ledger runs state mark, #id, title, segments, home badge, caret', () => {
  const html = chip.chipHtml(view({
    state: { name: 'Building', category: 'in-progress' },
    fields: [{ label: 'Milestone', value: 'v0.5' }],
  }), { href: '#/entity/e1', home: 'Feature' });
  const order = ['wv-chip-mark', 'wv-chip-id', 'k-label', 'mention-fields', 'k-home', 'mention-caret'];
  let at = -1;
  for (const part of order) {
    const next = html.indexOf(part);
    assert.ok(next > at, `${part} must follow ${order[order.indexOf(part) - 1] ?? 'the start'}: ${html}`);
    at = next;
  }
  assert.match(html, /<span class="wv-chip-id">#191<\/span>/, 'the id is its own span, in mono');
  assert.match(html, /class="k k-state cat-in-progress hue-blue wv-chip-mark"/, 'the mark is the real state chip');
  assert.match(html, /<button type="button" class="k k-state[^"]*" data-seg="state"/, 'and it is a button, not text');
});

test('the mark is the only state control: no open mark, no avatar, no × by default', () => {
  const html = chip.chipHtml(view({ state: { name: 'Shipped', category: 'done' } }), { href: '/x' });
  assert.ok(!html.includes('↗'), 'Feature #185 dropped the open mark: the chip is the link');
  assert.ok(!html.includes('class="av'), 'no avatar by default');
  assert.ok(!html.includes('class="x"'), 'Backspace removes an inline chip');
});

test('a relation cell keeps its ×, and asks for it by option', () => {
  const html = chip.chipHtml(view(), { href: '/x', removable: true });
  assert.match(html, /<button type="button" class="x" data-seg="remove"/);
});

test('every kind keeps its glyph and its class', () => {
  for (const [kind, glyph] of Object.entries(chip.KIND_GLYPH)) {
    const html = chip.chipHtml({ name: `a ${kind}`, link: false, fields: [] }, { kind, href: '/x' });
    assert.match(html, new RegExp(`class="mention mention-${kind}"`), kind);
    assert.ok(glyph.length === 1, `${kind} has one glyph`);
  }
  assert.deepEqual(Object.keys(chip.KIND_GLYPH), ['entity', 'table', 'space', 'workspace']);
});

test('an unresolved or trashed target is a broken chip, never a dead link', () => {
  const html = chip.chipHtml({ name: 'Ghost#9' }, { broken: true });
  assert.match(html, /<span class="mention broken">Ghost#9<\/span>/);
  assert.ok(!html.includes('<a '), 'nothing to follow');
});

test('a label, a name and a home badge are escaped, never executed', () => {
  const html = chip.chipHtml(view({ name: '<img src=x onerror=alert(1)>' }), { href: '"><script>', home: '<b>x</b>' });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<b>'));
});

test('a select segment is a live chip, a multiselect spends one chip per option', () => {
  const html = chip.chipHtml(view({
    fields: [
      { label: 'Priority', type: 'select', value: 'P1', option: { name: 'P1', hue: 'red' } },
      { label: 'Areas', type: 'multiselect', value: 'Engine, UI', options: [{ name: 'Engine', hue: 'blue' }, { name: 'UI', hue: 'green' }] },
    ],
  }), { href: '/x' });
  assert.match(html, /class="k k-select hue-red" data-seg="select" data-field="Priority"/);
  assert.equal((html.match(/class="k k-multi hue-\w+"/g) ?? []).length, 2, 'one chip per option');
  assert.match(html, /data-seg="multiselect" data-field="Areas"/);
});

test('the three surfaces emit one string: a document mention is the renderer’s own markup', () => {
  const v = view({ state: { name: 'Building', category: 'in-progress' }, fields: [{ label: 'Milestone', value: 'v0.5' }] });
  const html = renderMarkdown('[[Feature#191]]', {
    resolveMention: () => ({ href: '/e/e1/doc.html', label: 'Feature#191 — The Ledger chip', name: v.name, home: 'Feature', view: v }),
  });
  const own = chip.chipHtml(v, { kind: 'entity', href: '/e/e1/doc.html', home: 'Feature' });
  assert.ok(html.includes(own), `the document page must print chipHtml verbatim:\n${html}\n${own}`);
});

test('src/markdown.js keeps no chip markup or chip CSS of its own', () => {
  assert.ok(!MARKDOWN.includes('mention-fields'), 'the segment strip belongs to the renderer');
  assert.ok(!MARKDOWN.includes('k k-rel'), 'so does the chip itself');
  assert.ok(!/\.mention-\w+::before/.test(MARKDOWN), 'and the kind glyphs are in the stylesheet');
  assert.ok(!MARKDOWN.includes('.mention-f-label'), 'no second chip stylesheet');
  assert.ok(!MARKDOWN.includes('.mention.broken {'), 'nor a second rule for a broken one');
});

test('one stylesheet gives every kind its glyph', () => {
  const sheet = read('public/chip.css');
  for (const [kind, glyph] of Object.entries(chip.KIND_GLYPH)) {
    assert.match(sheet, new RegExp(`mention-${kind}[^{]*::before \\{ content: "${glyph}"`), kind);
  }
  assert.match(read('public/index.html'), /<link rel="stylesheet" href="\/chip\.css">/);
  assert.match(MARKDOWN, /href="\/chip\.css"/, 'the document page links the same sheet');
});

test('a document still renders when public/ is not in the bundle', () => {
  const at = MARKDOWN.indexOf('CHIP');
  assert.ok(at > 0, 'markdown.js reaches the renderer through a nullable binding');
  assert.match(MARKDOWN, /CHIP\s*\?/, 'and tests it before use, so the Worker bundle still renders');
});

test('the client builds its chips from the one renderer', () => {
  assert.match(APP, /chipView\.chipHtml\(/, 'viewChipEl goes through chipHtml');
  assert.ok(!/el\('a', \{ href: href \?\? `#\/entity\//.test(APP), 'and no longer hand-builds the anchor');
  assert.ok(!APP.includes('personAvatar('), 'Feature #185 dropped the avatar lead');
});

test('the segments edit: a state writes through the state route, a multiselect through the row', () => {
  const edit = APP.slice(APP.indexOf('async function editChipSegment('));
  const body = edit.slice(0, edit.indexOf('\n}\n'));
  assert.match(body, /\[data-seg="state"\]|seg === 'state'/, 'the state segment is one branch');
  assert.match(body, /\/entities\/\$\{eid\}\/state/, 'and it writes the state through the state route');
  assert.match(body, /multiselect/, 'the multiselect segment is the other');
  assert.match(body, /api\('PATCH', `\/entities\/\$\{eid\}`/, 'and it writes the chosen options to the row');
  assert.match(body, /chipView\.segHtml\(next\)/, 'both repaint through the one renderer');
  const builder = APP.slice(APP.indexOf('function stateOptions('), APP.indexOf('function statePicker('));
  assert.match(builder, /chipCore\.CATEGORIES/, 'the picker is ordered by the engine’s four categories');
  assert.match(builder, /group: c\.label/, 'which it carries as the group a divider is drawn from, not as a grid heading (Issue #796)');
  assert.match(builder, /cls: stateChipClass\(f, s\.name\)/, 'and every row wears the state chip it sets');
  const picker = APP.slice(APP.indexOf('function statePicker('));
  assert.match(picker, /options: stateOptions\(f\)/, 'statePicker builds its options there');
  assert.ok(!/groups: true/.test(picker.slice(0, picker.indexOf('\n}\n'))), 'and draws them as one numbered list');
  assert.match(APP.slice(APP.indexOf("if (f.type === 'workflow') {", APP.indexOf('function editorFor('))), /options: stateOptions\(f\)/,
    'the workflow cell builds its options from the very same list, so both call sites pass identical options (Issue #796)');
});

test('the chip inherits the type around it, so a chip in prose never grows the line', () => {
  const sheet = read('public/chip.css');
  assert.match(sheet, /\.wv-prose \.k-rel \{[^}]*font-size: inherit/);
  assert.match(sheet, /\.wv-prose \.k-rel \{[^}]*line-height: inherit/);
  assert.match(read('src/markdown.js'), /class="wv-prose"/, 'the document page is prose ground');
  assert.match(APP, /'view-desc-body wv-prose clamped'/, 'and so is the app\u2019s rendered description');
  assert.ok(!/\.k-inline\b/.test(CSS), 'k-inline was the second chip: it is gone');
  assert.ok(!/k-inline/.test(APP));
  assert.ok(!/k-inline/.test(MARKDOWN));
});

test('an avatar leads the chip inside its link, before the #id', () => {
  const html = chip.chipHtml(view({ avatar: { shape: 'round', initials: 'MC', hue: 'blue', file: null, badge: null } }), { href: '/x' });
  const a = html.indexOf('<a ');
  const av = html.indexOf('class="wv-av ');
  assert.ok(a >= 0 && av > a && av < html.indexOf('wv-chip-id'), html);
  assert.match(html, /<span class="wv-av round hue-blue"[^>]*>MC<\/span>/);
});

test('a photo avatar draws the file, and an agent wears its badge', () => {
  const html = chip.avatarHtml({ shape: 'round', initials: 'WF', hue: 'purple', file: 'f1', badge: 'agent' }, { base: '/w/weave' });
  assert.match(html, /<img src="\/w\/weave\/api\/files\/f1" alt="">/);
  assert.match(html, /class="av-badge"/);
  assert.match(chip.avatarHtml({ shape: 'square', initials: 'AC', hue: 'amber', file: null, badge: null }), /class="wv-av square hue-amber"/);
  assert.equal(chip.avatarHtml(null), '');
});

test('an avatar leads the card head', () => {
  const html = chip.cardHtml(view({ shape: 'card', avatar: { shape: 'round', initials: 'MC', hue: 'blue', file: null, badge: null } }), { href: '/x' });
  const head = html.indexOf('wv-card-head');
  const av = html.indexOf('class="wv-av ');
  assert.ok(head >= 0 && av > head && av < html.indexOf('wv-card-title'), html);
});

test('a face pile overlaps up to five faces, each a link, then +N', () => {
  const face = (n) => ({ id: `e${n}`, name: `Person ${n}`, avatar: { shape: 'round', initials: `P${n}`, hue: 'blue', file: null, badge: null } });
  const html = chip.facePileHtml([1, 2, 3, 4, 5, 6, 7].map(face), { href: (s) => `#/entity/${s.id}` });
  assert.match(html, /^<span class="wv-face-pile"/);
  assert.equal((html.match(/<a /g) ?? []).length, 5, 'five faces');
  assert.match(html, /<a href="#\/entity\/e1" title="Person 1"[^>]*><span class="wv-av round hue-blue"/);
  assert.match(html, /<span class="k k-more" title="Person 6, Person 7">\+2<\/span>/, 'the count names who it hides');
  assert.doesNotMatch(chip.facePileHtml([1, 2].map(face), { href: (s) => `#/entity/${s.id}` }), /k-more/);
});
