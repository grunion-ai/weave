import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import * as Forms from '../src/forms.js';

function fixture(path) {
  const w = new Weave({ path });
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  w.addField(table.id, { name: 'Count', type: 'number' });
  w.addField(table.id, { name: 'Private', type: 'text' });
  w.addField(table.id, { name: 'Tags', type: 'multiselect', config: { options: ['One', 'Two'] } });
  const form = Forms.createForm(w, { name: 'Public', table: table.id, fields: [{ field: 'Name', key: 'subject', aliases: ['title'], required: true }, { field: 'Count', key: 'count' }, { field: 'Tags', key: 'tags' }], hidden: { Private: '$actor' } });
  return { w, table, form };
}

test('stable field identities survive rename and aliases normalize before submission', () => {
  const { w, table, form } = fixture();
  const field = w.findField(table, 'Name');
  assert.equal(form.fields[0].id, field.id);
  assert.equal(form.fields[0].key, 'subject');
  w.updateField(table.id, field.id, { name: 'Headline' });
  for (const key of ['subject', 'title', 'Name', 'Headline', field.id]) {
    const row = Forms.submitForm(w, form.id, { values: { [key]: key } });
    assert.equal(w.readEntity(row.id).name, key);
  }
});

test('prefill is read-only, typed, escaped and warns for rejected inputs', () => {
  const { w, form, table } = fixture();
  const params = new URLSearchParams('prefill_title=%3Cscript%3E&count=12&tags=One&tags=Two&Private=forge&missing=x&utm_source=test');
  const filled = Forms.prefillForm(form, params);
  assert.equal(filled.fields[0].default, '<script>');
  assert.equal(filled.fields[1].default, 12);
  assert.deepEqual(filled.fields[2].default, ['One', 'Two']);
  assert.equal(filled.warnings.length, 2);
  assert.equal(form.fields[0].default, undefined);
  const html = Forms.renderFormPage(form, { searchParams: params });
  assert.match(html, /data-field="subject"/);
  assert.match(html, /required/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /missing/);
  assert.equal(w.listEntities(table.id).length, 0);
});

test('ambiguous, duplicate, hidden, prototype, invalid type and missing required inputs refuse before writing', () => {
  const { w, form, table } = fixture();
  const invalid = [{}, { subject: 'a', title: 'b' }, { subject: 'a', count: 'no' }, { subject: 'a', tags: ['Other'] }, { subject: 'a', Private: 'x' }, JSON.parse('{"subject":"a","__proto__":"x"}')];
  for (const values of invalid) assert.throws(() => Forms.submitForm(w, form.id, { values }));
  assert.throws(() => Forms.createForm(w, { name: 'Ambiguous', table: table.id, fields: [{ field: 'Name', key: 'same' }, { field: 'Count', aliases: ['same'] }] }), /ambiguous/i);
  assert.equal(w.listEntities(table.id).length, 0);
});

test('durable retry receipts canonicalize aliases, conflict on changed input and isolate callers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-form-inputs-'));
  try {
    const path = join(dir, 'test.db');
    const { w, form, table } = fixture(path);
    const made = Forms.submitForm(w, form.id, { values: { title: 'One', count: '2' } }, { actor: 'a', idempotencyKey: 'retry' });
    const reopened = new Weave({ path });
    const replay = Forms.submitForm(reopened, form.id, { values: { count: 2, subject: 'One' } }, { actor: 'a', idempotencyKey: 'retry' });
    assert.equal(replay.id, made.id);
    assert.equal(replay.replayed, true);
    assert.throws(() => Forms.submitForm(reopened, form.id, { values: { subject: 'Two' } }, { actor: 'a', idempotencyKey: 'retry' }), e => e.code === 'conflict');
    const other = Forms.submitForm(reopened, form.id, { values: { subject: 'One', count: 2 } }, { actor: 'b', idempotencyKey: 'retry' });
    assert.notEqual(other.id, made.id);
    assert.equal(reopened.listEntities(table.id).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('content dedup is scoped, bounded by its window and disabled for unidentified anonymous callers', () => {
  const { w, form } = fixture();
  const submit = options => Forms.submitForm(w, form.id, { values: { subject: 'Same' } }, options);
  const first = submit({ actor: 'a' });
  assert.equal(submit({ actor: 'a' }).id, first.id);
  assert.equal(submit({ actor: 'a' }).duplicate, true);
  assert.notEqual(submit({ actor: 'b' }).id, first.id);
  assert.notEqual(submit({ actor: 'a', dedupWindowMs: 0 }).id, first.id);
  assert.notEqual(submit({ actor: 'anonymous' }).id, submit({ actor: 'anonymous' }).id);
});

test('expired receipts do not replay and new submissions prune receipt history', () => {
  const { w, form } = fixture();
  const options = { actor: 'a', idempotencyKey: 'old' };
  const first = Forms.submitForm(w, form.id, { values: { subject: 'Old' } }, options);
  for (const receipt of w.state.meta.formReceipts) receipt.at -= 86400001;
  const second = Forms.submitForm(w, form.id, { values: { subject: 'Old' } }, options);
  assert.notEqual(second.id, first.id);
  assert.equal(w.state.meta.formReceipts.length, 1);
});

test('a storage failure rolls back both row and receipt and permits a clean retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-form-rollback-'));
  try {
    const path = join(dir, 'test.db');
    const { w, form, table } = fixture(path);
    const original = w.store.save.bind(w.store);
    w.store.save = (state, options) => {
      original(state, options);
      if (state.meta.formReceipts?.length) throw new Error('disk failure');
    };
    assert.throws(() => Forms.submitForm(w, form.id, { values: { subject: 'Retry' } }, { idempotencyKey: 'retry' }), /disk failure/);
    assert.equal(w.listEntities(table.id).length, 0);
    const reopened = new Weave({ path });
    assert.equal(reopened.listEntities(table.id).length, 0);
    assert.equal(reopened.state.meta.formReceipts?.length ?? 0, 0);
    w.store.save = original;
    const row = Forms.submitForm(w, form.id, { values: { subject: 'Retry' } }, { idempotencyKey: 'retry' });
    assert.ok(row.id);
    assert.equal(new Weave({ path }).listEntities(table.id).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hidden field IDs and repeated aliases cannot bypass prefill guards', () => {
  const { w, form, table } = fixture();
  const hidden = w.findField(table, 'Private').id;
  assert.throws(() => Forms.submitForm(w, form.id, { values: { subject: 'Name', [hidden]: 'x' } }), e => e.code === 'forbidden');
  const filled = Forms.prefillForm(form, new URLSearchParams(`subject=a&title=b&${hidden}=x&count=oops`));
  assert.equal(filled.warnings.length, 3);
  assert.equal(filled.fields[1].default, undefined);
});

test('hidden fields keep their server value after rename', () => {
  const { w, table, form } = fixture();
  const privateField = w.findField(table, 'Private');
  w.updateField(table.id, privateField.id, { name: 'Server Actor' });
  const made = Forms.submitForm(w, form.id, { values: { subject: 'Name' } }, { actor: 'caller' });
  assert.equal(w.readEntity(made.id).fields['Server Actor'], 'caller');
  assert.throws(() => Forms.submitForm(w, form.id, { values: { subject: 'Name', 'Server Actor': 'forged' } }), e => e.code === 'forbidden');
});

test('another engine refreshes its receipts under the storage transaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-form-refresh-'));
  try {
    const path = join(dir, 'test.db');
    const { w, form } = fixture(path);
    const stale = new Weave({ path });
    const input = { values: { subject: 'Shared' } };
    const options = { actor: 'a', idempotencyKey: 'same' };
    const made = Forms.submitForm(w, form.id, input, options);
    assert.equal(Forms.submitForm(stale, form.id, input, options).id, made.id);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ordinary registry writes bind fields and hidden values to stable IDs', () => {
  const { w, table } = fixture();
  const tableRow = w.listEntities(w.getTable('Workspace/Tables').id).find(row => row.sysId === table.id);
  const formRow = w.createEntity('Workspace/Forms', { name: 'Registry', Table: tableRow.id, Fields: '[{"field":"Name","key":"title"}]', Hidden: '{"Private":"$actor"}', Enabled: true });
  w.updateEntity(formRow.id, { Fields: '[{"field":"Name","key":"title","label":"Your title"}]' });
  w.updateField(table.id, w.findField(table, 'Name').id, { name: 'Headline' });
  w.updateField(table.id, w.findField(table, 'Private').id, { name: 'Internal' });
  const result = Forms.submitForm(w, formRow.id, { values: { title: 'Stable' } }, { actor: 'a' });
  assert.equal(w.readEntity(result.id).name, 'Stable');
  assert.equal(w.readEntity(result.id).fields.Internal, 'a');
});

test('content dedup scope survives new retry keys without crossing client boundaries', () => {
  const { w, form } = fixture();
  const submit = (key, cookie) => Forms.submitForm(w, form.id, { values: { subject: 'Same' } }, { actor: 'anonymous', scope: key, idempotencyKey: key, dedupScope: cookie });
  const first = submit('one', 'client-one');
  const second = submit('two', 'client-one');
  assert.equal(second.id, first.id);
  assert.equal(second.duplicate, true);
  assert.notEqual(submit('three', 'client-two').id, first.id);
  assert.equal(submit('two', 'client-one').id, first.id);
  assert.equal(w.exportJSON().meta.formReceipts, undefined);
});

test('registry key edits retain old input aliases', () => {
  const { w, form } = fixture();
  w.updateEntity(form.id, { Fields: '[{"field":"Name","key":"newSubject"}]' });
  const made = Forms.submitForm(w, form.id, { values: { subject: 'Old link' } });
  assert.equal(w.readEntity(made.id).name, 'Old link');
});

test('required boolean means provided and number controls accept fractions', () => {
  const { w, table } = fixture();
  w.addField(table.id, { name: 'Agree', type: 'checkbox' });
  const form = Forms.createForm(w, { name: 'Types', table: table.id, fields: [{ field: 'Agree', key: 'agree', required: true }, { field: 'Count', key: 'count' }] });
  assert.throws(() => Forms.submitForm(w, form.id, { values: { count: 1 } }), /required/);
  const made = Forms.submitForm(w, form.id, { values: { agree: false, count: 1.25 } });
  assert.equal(w.readEntity(made.id).fields.Agree, false);
  const html = Forms.renderFormPage(form);
  assert.doesNotMatch(html, /data-field="agree"[^>]*required/);
  assert.match(html, /type="number" step="any"/);
});

test('entity validation failure leaves no receipt and next valid write persists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-form-validation-'));
  try {
    const path = join(dir, 'test.db');
    const { w, table, form } = fixture(path);
    w.updateEntity(form.id, { Hidden: '{"Private":{"invalid":true}}' });
    const original = w.createEntity.bind(w);
    w.createEntity = () => { throw new Error('entity validation'); };
    assert.throws(() => Forms.submitForm(w, form.id, { values: { subject: 'Failed' } }, { idempotencyKey: 'retry' }), /entity validation/);
    w.createEntity = original;
    assert.equal(w.state.meta.formReceipts?.length ?? 0, 0);
    w.updateEntity(form.id, { Hidden: '{"Private":"fixed"}' });
    Forms.submitForm(w, form.id, { values: { subject: 'Valid' } }, { idempotencyKey: 'retry' });
    assert.equal(new Weave({ path }).listEntities(table.id).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('retry receipts survive later required fields and removed fields', () => {
  const { w, form } = fixture();
  const options = { actor: 'a', idempotencyKey: 'stable' };
  const input = { values: { subject: 'Original' } };
  const first = Forms.submitForm(w, form.id, input, options);
  w.updateEntity(form.id, { Fields: '[{"field":"Name","key":"subject"},{"field":"Count","required":true}]' });
  assert.equal(Forms.submitForm(w, form.id, { values: { title: 'Original' } }, options).id, first.id);
  w.updateEntity(form.id, { Fields: '[{"field":"Count","required":true}]' });
  assert.equal(Forms.submitForm(w, form.id, input, options).id, first.id);
  w.updateEntity(form.id, { Enabled: false });
  assert.throws(() => Forms.submitForm(w, form.id, input, options), /turned off/);
});

test('receipt capacity refuses new writes while honoring existing retries', () => {
  const { w, form, table } = fixture();
  const input = { values: { subject: 'Original' } };
  const first = Forms.submitForm(w, form.id, input, { idempotencyKey: 'original' });
  const receipt = w.state.meta.formReceipts[0];
  w.state.meta.formReceipts = Array.from({ length: 10000 }, (_, i) => ({ ...receipt, key: i ? String(i) : receipt.key }));
  assert.equal(Forms.submitForm(w, form.id, input, { idempotencyKey: 'original' }).id, first.id);
  assert.throws(() => Forms.submitForm(w, form.id, { values: { subject: 'New' } }, { idempotencyKey: 'new' }), e => e.code === 'rate-limited');
  assert.equal(w.listEntities(table.id).length, 1);
  assert.equal(w.state.meta.formReceipts.length, 10000);
});
