import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/field-diff-core.js');
const D = globalThis.WeaveFieldDiff;

const opt = (id, name, hue, extra = {}) => ({ id, name, hue, icon: '', color: `#${hue}`, ...extra });
const priority = (p3) => ({ name: 'Priority', type: 'select', config: { options: [opt('p0', 'P0', 'red'), opt('p1', 'P1', 'orange'), p3] } });

test('a recolour is one option, before and after, marked recoloured; the rest are counted, not listed (Issue #554)', () => {
  const [c] = D.changes({ changed: ['options'], before: priority(opt('p3', 'P3', 'teal')), after: priority(opt('p3', 'P3', 'green')) });
  assert.equal(c.kind, 'list');
  assert.equal(c.label, 'Options');
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].before.hue, 'teal');
  assert.equal(c.items[0].after.hue, 'green');
  assert.deepEqual(c.items[0].marks, ['recoloured']);
  assert.equal(c.unchanged, 2);
});

test('options added, removed, renamed, re-iconed and moved are each marked', () => {
  const before = [opt('a', 'Alpha', 'red'), opt('b', 'Beta', 'blue'), opt('c', 'Gamma', 'green')];
  const after = [opt('c', 'Gamma', 'green'), opt('a', 'Alpha one', 'red', { icon: 'lucide:star' }), opt('d', 'Delta', 'amber')];
  const { items } = D.listChanges(before, after);
  const by = Object.fromEntries(items.map((i) => [(i.after ?? i.before).id, i.marks]));
  assert.deepEqual(by.a, ['renamed', 'icon changed', 'moved']);
  assert.deepEqual(by.c, ['moved']);
  assert.deepEqual(by.d, ['added']);
  assert.deepEqual(by.b, ['removed']);
});

test('a workflow state changing category is marked; states read like options', () => {
  const [c] = D.changes({
    changed: ['states'],
    before: { name: 'Status', type: 'workflow', config: { states: [{ id: 's1', name: 'Open', category: 'not-started' }, { id: 's2', name: 'Doing', category: 'not-started' }] } },
    after: { name: 'Status', type: 'workflow', config: { states: [{ id: 's1', name: 'Open', category: 'not-started' }, { id: 's2', name: 'Doing', category: 'started' }] } },
  });
  assert.equal(c.label, 'States');
  assert.deepEqual(c.items.map((i) => i.marks), [['category changed']]);
});

test('a formula reads as text with a word diff', () => {
  const [c] = D.changes({ changed: ['expression'], before: { name: 'F', type: 'formula', config: { expression: '[Price] * 2' } }, after: { name: 'F', type: 'formula', config: { expression: '[Price] * 3' } } });
  assert.equal(c.kind, 'text');
  assert.equal(c.label, 'Formula');
  assert.deepEqual(c.diff, [{ op: '=', text: '[Price] * ' }, { op: '-', text: '2' }, { op: '+', text: '3' }]);
});

test('name, type, format and a default read as plain before and after values; a select default by option name', () => {
  const before = { name: 'Stage', type: 'select', config: { options: [opt('x', 'Lead', 'blue'), opt('y', 'Won', 'green')], default: 'x' } };
  const after = { name: 'Phase', type: 'select', config: { options: [opt('x', 'Lead', 'blue'), opt('y', 'Won', 'green')], default: 'y' } };
  const out = D.changes({ changed: ['name', 'default'], before, after });
  assert.deepEqual(out.map((c) => [c.label, D.formatValue(c.before), D.formatValue(c.after)]), [['Name', 'Stage', 'Phase'], ['Default', 'Lead', 'Won']]);
  const [fmt] = D.changes({ changed: ['format'], before: { name: 'D', type: 'date', config: { format: 'long' } }, after: { name: 'D', type: 'date', config: {} } });
  assert.deepEqual([fmt.label, D.formatValue(fmt.before), D.formatValue(fmt.after)], ['Format', 'long', '—']);
  assert.equal(D.label('showSeconds'), 'Show seconds');
});
