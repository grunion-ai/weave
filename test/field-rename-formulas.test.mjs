import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { renameReferences, spelling } from '../src/formula.js';
import { toolCommand } from '../src/commands.js';

function deals() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deal' });
  const amount = w.addField(t.id, { name: 'Amount', type: 'number' });
  w.addField(t.id, { name: 'Twice', type: 'formula', config: { expression: 'Amount * 2' } });
  w.addField(t.id, { name: 'Label', type: 'formula', config: { expression: 'concat(Name, ": ", [Amount], " of amount")' } });
  const d = w.createEntity(t.id, { name: 'd1', values: { Amount: 5 } });
  return { w, t, d, amount };
}

const expr = (w, t, name) => w.getField(t.id, name).config.expression;
const value = (w, d, name) => w.readEntity(d.id).fields[name];
const amountOf = (refs) => (name) => refs.includes(name);

test('renaming a field rewrites every formula on its table that reads it (Issue #1622)', () => {
  const { w, t, d } = deals();
  w.updateField(t.id, 'Amount', { name: 'Deal Amount' });
  assert.equal(expr(w, t, 'Twice'), '[Deal Amount] * 2');
  assert.equal(expr(w, t, 'Label'), 'concat(Name, ": ", [Deal Amount], " of amount")');
  assert.equal(value(w, d, 'Twice'), 10);
  assert.equal(value(w, d, 'Label'), 'd1: 5 of amount');
  const twice = w.getField(t.id, 'Twice');
  assert.equal(w.checkFormula(t.id, twice.config.expression, { excludeField: twice.id }).ok, true);
  const described = w.describeSchema().flatMap((s) => s.tables).find((x) => x.id === t.id).fields.find((f) => f.name === 'Twice');
  assert.equal(described.expression, '[Deal Amount] * 2');
});

test('a bare reference stays bare while the name allows it, and renaming back restores the expression (Issue #1622)', () => {
  const { w, t, d } = deals();
  w.updateField(t.id, 'Amount', { name: 'Total' });
  assert.equal(expr(w, t, 'Twice'), 'Total * 2');
  w.updateField(t.id, 'Total', { name: 'Deal Amount' });
  assert.equal(expr(w, t, 'Twice'), '[Deal Amount] * 2');
  w.updateField(t.id, 'Deal Amount', { name: 'Amount' });
  assert.equal(expr(w, t, 'Twice'), 'Amount * 2');
  assert.equal(value(w, d, 'Twice'), 10);
});

test('a stored reference in another case is rewritten, the Name alias and string literals are not (Issue #1622)', () => {
  const { w, t, d } = deals();
  const plus = w.addField(t.id, { name: 'Plus', type: 'formula', config: { expression: 'Amount + 1' } });
  w.getField(t.id, plus.id).config.expression = 'amount + 1';
  assert.equal(value(w, d, 'Plus'), 6, 'a field name reads in any case');
  w.addField(t.id, { name: 'Loud', type: 'formula', config: { expression: 'upper(Name)' } });
  w.updateField(t.id, 'Amount', { name: 'Deal Amount' });
  assert.equal(expr(w, t, 'Plus'), '[Deal Amount] + 1');
  assert.equal(value(w, d, 'Plus'), 6);
  w.updateField(t.id, 'Name', { name: 'Title' });
  assert.equal(expr(w, t, 'Loud'), 'upper(Name)', 'Name still names the record name');
  assert.equal(expr(w, t, 'Label'), 'concat(Name, ": ", [Deal Amount], " of amount")', 'the string literal keeps its word');
  assert.equal(value(w, d, 'Loud'), 'D1');
});

test('a name no formula can spell is refused, the refusal names the formulas, and nothing changes (Issue #1622)', () => {
  const { w, t, d } = deals();
  assert.throws(() => w.updateField(t.id, 'Amount', { name: 'Odd]Amount' }), (err) => /Twice/.test(err.message) && /Label/.test(err.message));
  assert.equal(w.getField(t.id, 'Amount').name, 'Amount');
  assert.equal(expr(w, t, 'Twice'), 'Amount * 2');
  assert.equal(value(w, d, 'Twice'), 10);
  w.addField(t.id, { name: 'Note', type: 'text' });
  assert.equal(w.updateField(t.id, 'Note', { name: 'Odd]Note' }).name, 'Odd]Note', 'a field no formula reads takes the name');
});

test('a rename onto a name another field of the table holds is refused (Issue #1732)', () => {
  const { w, t } = deals();
  w.addField(t.id, { name: 'Other', type: 'number' });
  assert.throws(() => w.updateField(t.id, 'Amount', { name: 'Other' }), /already exists/);
  assert.throws(() => w.updateField(t.id, 'Amount', { name: 'other' }), /already exists/);
  assert.throws(() => w.updateField(t.id, 'Amount', { name: 'Name' }), /already exists/);
  assert.equal(w.getField(t.id, 'Amount').name, 'Amount');
  w.updateField(t.id, 'Amount', { name: 'AMOUNT' });
  assert.equal(expr(w, t, 'Twice'), 'AMOUNT * 2', 'a field may change its own case');
});

test('the rename activity lists the rewritten formulas, and rolling it back rewrites them back (Issue #1622)', () => {
  const { w, t, d, amount } = deals();
  const seq = w.state.meta.activitySeq;
  w.updateField(t.id, 'Amount', { name: 'Deal Amount' });
  const entry = w.fieldChangeSince(t.id, amount.id, seq);
  assert.deepEqual(entry.detail.rewritten, [
    { field: 'Twice', before: 'Amount * 2', after: '[Deal Amount] * 2' },
    { field: 'Label', before: 'concat(Name, ": ", [Amount], " of amount")', after: 'concat(Name, ": ", [Deal Amount], " of amount")' },
  ]);
  w.rollbackFieldConfig(entry.id);
  assert.equal(w.getField(t.id, amount.id).name, 'Amount');
  assert.equal(expr(w, t, 'Twice'), 'Amount * 2');
  assert.equal(value(w, d, 'Twice'), 10);
});

test('a rename through the Fields registry row or the weave_update_field command carries the formulas (Issue #1622)', () => {
  const { w, t, d, amount } = deals();
  const fields = Object.values(w.state.tables).find((x) => x.system === 'fields');
  const row = w.listEntities(fields.id).find((r) => r.sysId === amount.id);
  w.updateEntity(row.id, { Name: 'Deal Amount' });
  assert.equal(expr(w, t, 'Twice'), '[Deal Amount] * 2');
  const out = toolCommand('weave_update_field').run(w, { db: t.id, field: 'Deal Amount', name: 'Total' });
  assert.equal(out.name, 'Total');
  assert.equal(out.formulas, undefined, 'no formula broke, so none is reported broken');
  assert.equal(expr(w, t, 'Twice'), 'Total * 2');
  assert.equal(value(w, d, 'Twice'), 10);
});

test('renameReferences rewrites field references only, wherever the expression puts them (Issue #1622)', () => {
  const amount = amountOf(['Amount']);
  assert.equal(renameReferences('round(Amount, 1) + len("Amount") + [Amount]', amount, 'Deal Amount'), 'round([Deal Amount], 1) + len("Amount") + [Deal Amount]');
  assert.equal(renameReferences('  Amount   *2', amount, 'Total'), '  Total   *2');
  assert.equal(renameReferences('days(Start, End) + days', amountOf(['days']), 'Slack'), 'days(Start, End) + Slack');
  assert.equal(renameReferences('nope(Amount) + Amount', amount, 'Total'), 'nope(Total) + Total', 'an unknown function does not stop the walk');
  assert.equal(renameReferences('dateadd(Start, 1, Unit) + Amount', amount, 'Total'), 'dateadd(Start, 1, Unit) + Total', 'nor a function that throws on blanks');
  assert.equal(renameReferences('Amount > 1 and Amount < 9 or Amount = 0', amount, 'or'), '[or] > 1 and [or] < 9 or [or] = 0');
  assert.equal(renameReferences('Price * 2', amount, 'Total'), 'Price * 2');
  assert.equal(renameReferences('Amount * 2', amount, 'a]b'), null);
  assert.equal(renameReferences('Amount * (', amount, 'Total'), 'Amount * (', 'an expression that does not parse is left alone');
});

test('spelling goes bare for a plain identifier and brackets a space, a keyword or a function name (Issue #1622)', () => {
  assert.equal(spelling('Total'), 'Total');
  assert.equal(spelling('net_2'), 'net_2');
  assert.equal(spelling('Deal Amount'), '[Deal Amount]');
  assert.equal(spelling('9lives'), '[9lives]');
  for (const word of ['and', 'or', 'true', 'false', 'null']) assert.equal(spelling(word), `[${word}]`);
  for (const fn of ['Year', 'days', 'TEXT']) assert.equal(spelling(fn), `[${fn}]`);
  assert.equal(spelling('a]b'), null);
  assert.equal(spelling(' padded'), null);
  assert.equal(spelling(''), null);
});
