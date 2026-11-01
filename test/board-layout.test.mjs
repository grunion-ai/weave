import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';
import '../public/board-core.js';
import { tempDir } from './lib/temp.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const Board = globalThis.weaveBoardCore;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

function shop(w = new Weave()) {
  w.createSpace({ name: 'Buyer' });
  const list = w.createTable({ space: 'Buyer', name: 'Shopping List' });
  w.addField(list.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }, { name: 'Ready to Buy', hue: 'green' }, { name: 'Bought' }] } });
  w.addField(list.id, { name: 'Best Price', type: 'number', config: { format: 'currency', currency: 'USD' } });
  w.addField(list.id, { name: 'Receipt', type: 'attachments', config: { multiple: false } });
  w.addField(list.id, { name: 'Photo', type: 'attachments', config: { multiple: false, preview: 'cover', size: 'small' } });
  w.addField(list.id, { name: 'Back', type: 'attachments', config: { multiple: false, preview: 'cover', size: 'large' } });
  return { w, list };
}
const tableOf = (w, name) => w.describeSchema().flatMap((s) => s.tables).find((t) => t.name === name);

test('a view saves layout board with groups and picture, and reads them back', () => {
  const { w } = shop();
  const v = w.tableView('Shopping List/Standard', { layout: 'board', groups: 'stacked', picture: 'large', group: ['State'] });
  assert.equal(v.layout, 'board');
  assert.equal(v.groups, 'stacked');
  assert.equal(v.picture, 'large');
  assert.deepEqual(v.group, [{ field: 'State' }], 'a board groups with the List levels');
  const fresh = w.tableView('Shopping List/Columns', { layout: 'board' });
  assert.equal(fresh.groups, undefined, 'unset reads as unset; the board draws side by side');
  assert.equal(fresh.picture, undefined, 'unset follows the cover field');
  const cleared = w.tableView('Shopping List/Standard', { groups: null, picture: null });
  assert.equal(cleared.groups, undefined);
  assert.equal(cleared.picture, undefined);
  assert.equal(w.tableView('Shopping List/Standard', { layout: 'table' }).layout, 'table');
});

test('a board view saves fit, frame and flow, refuses other values by name, and carries them in the schema (Issue #1280)', () => {
  const { w } = shop();
  const v = w.tableView('Shopping List/Standard', { layout: 'board', picture: 'medium', fit: 'capped', frame: '3:4', flow: 'rows' });
  assert.equal(v.fit, 'capped');
  assert.equal(v.frame, '3:4');
  assert.equal(v.flow, 'rows');
  const fresh = w.tableView('Shopping List/Columns', { layout: 'board' });
  assert.equal(fresh.fit, undefined, 'unset crops');
  assert.equal(fresh.frame, undefined, 'unset is 4:3');
  assert.equal(fresh.flow, undefined, 'unset is masonry');
  assert.throws(() => w.tableView('Shopping List/Standard', { fit: true }), /fit is crop, fit, original or capped/);
  assert.throws(() => w.tableView('Shopping List/Standard', { frame: '2:1' }), /frame is 4:3, 1:1, 3:4 or 16:9/);
  assert.throws(() => w.tableView('Shopping List/Standard', { flow: 'columns' }), /flow is masonry or rows/);
  const w2 = new Weave();
  w2.applySchema(w.describeSchema());
  const back = w2.tableView('Shopping List/Standard');
  assert.deepEqual([back.fit, back.frame, back.flow], ['capped', '3:4', 'rows'], 'fit, frame and flow travel with the schema document');
  const cleared = w.tableView('Shopping List/Standard', { fit: null, frame: null, flow: null });
  assert.deepEqual([cleared.fit, cleared.frame, cleared.flow], [undefined, undefined, undefined]);
});
test('unknown layout, groups and picture values are refused by name', () => {
  const { w } = shop();
  assert.throws(() => w.tableView('Shopping List/X', { layout: 'gallery' }), /layout is table or board/);
  assert.throws(() => w.tableView('Shopping List/X', { groups: 'grid' }), /groups is stacked or side/);
  assert.throws(() => w.tableView('Shopping List/X', { picture: 'huge' }), /picture is off, small, medium or large/);
});

test('groups and picture travel through describeSchema and applySchema, and a change is one patch', () => {
  const { w } = shop();
  w.tableView('Shopping List/Standard', { layout: 'board', groups: 'stacked', picture: 'medium', group: ['State'] });
  const doc = w.describeSchema();
  const w2 = new Weave();
  w2.applySchema(doc);
  const v = w2.tableView('Shopping List/Standard');
  assert.equal(v.layout, 'board');
  assert.equal(v.groups, 'stacked');
  assert.equal(v.picture, 'medium');
  const t = doc.flatMap((s) => s.tables).find((x) => x.name === 'Shopping List');
  t.views[0].picture = 'off';
  const dry = w2.applySchema(doc, { dryRun: true });
  const plan = Array.isArray(dry) ? dry : dry.plan;
  assert.deepEqual(plan.filter((p) => p.action === 'update-view').map((p) => p.subject), ['Buyer/Shopping List/Standard']);
  w2.applySchema(doc);
  assert.equal(w2.tableView('Shopping List/Standard').picture, 'off');
});

test('the Views registry row carries Groups and Picture, and writing them writes the view', () => {
  const { w } = shop();
  w.tableView('Shopping List/Standard', { layout: 'board', groups: 'stacked', picture: 'small' });
  const t = w.getTable('Views');
  const rowOf = () => w.listEntities(t.id).map((e) => w.readEntity(e.id)).find((r) => r.name === 'Standard' && (r.fields.Table?.[0]?.name ?? r.fields.Table?.name) === 'Shopping List');
  assert.equal(rowOf().fields.Layout, 'board');
  assert.equal(rowOf().fields.Groups, 'stacked');
  assert.equal(rowOf().fields.Picture, 'small');
  w.updateEntity(rowOf().id, { Groups: 'Side', Picture: 'Off' });
  const v = w.tableView('Shopping List/Standard');
  assert.equal(v.groups, 'side');
  assert.equal(v.picture, 'off');
  w.updateEntity(rowOf().id, { Picture: '' });
  assert.equal(w.tableView('Shopping List/Standard').picture, undefined);
});

test('weave_table_view takes groups and picture and tells agents a gallery and a kanban are boards', () => {
  const { w } = shop();
  const v = dispatchTool(w, 'weave_table_view', { view: 'Shopping List/Gallery', layout: 'board', groups: 'stacked', picture: 'medium' });
  assert.equal(v.groups, 'stacked');
  const tool = TOOLS.find((t) => t.name === 'weave_table_view');
  for (const k of ['groups', 'picture']) assert.ok(tool.inputSchema.properties[k], `schema names ${k}`);
  assert.match(tool.description, /layout: table\|board/);
  assert.match(tool.description, /gallery/i);
  assert.match(tool.description, /kanban/i);
});

test('the CLI takes --groups and --picture', () => {
  const dir = tempDir('weave-board-');
  try {
    const data = join(dir, 'w.db');
    const fw = new Weave({ path: data });
    shop(fw);
    fw.save?.();
    const out = JSON.parse(execFileSync(process.execPath, [BIN, '--data', data, 'table', 'view', 'Shopping List/Standard', '--layout', 'board', '--groups', 'side', '--picture', 'small'], { encoding: 'utf8' }));
    assert.equal(out.layout, 'board');
    assert.equal(out.groups, 'side');
    assert.equal(out.picture, 'small');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a query that names an attachments field carries that field\'s files and no others', () => {
  const { w, list } = shop();
  const e = w.createEntity(list.id, { name: 'Desk' });
  const photo = w.attachToField(e.id, 'Photo', { name: 'desk.png', mime: 'image/png', bytes: PNG });
  w.attachToField(e.id, 'Receipt', { name: 'receipt.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') });
  const item = w.query(list.id, { fields: ['Name', 'Photo'] }).items[0];
  assert.deepEqual(item.files.map((f) => f.id), [photo.id]);
  assert.equal(w.query(list.id, { fields: ['Name'] }).items[0].files, undefined, 'no attachments field, no files');
});

test('coverOf picks the first shown cover field and skips hidden fields, missing files and non-pictures', () => {
  const { w, list } = shop();
  const e = w.createEntity(list.id, { name: 'Desk' });
  const back = w.attachToField(e.id, 'Back', { name: 'back.png', mime: 'image/png', bytes: PNG });
  const cover = () => Board.coverOf(tableOf(w, 'Shopping List'), w.readEntity(e.id))?.id;
  assert.equal(cover(), undefined, 'Photo is the first shown cover field and holds nothing, so the record has no cover');
  w.attachToField(e.id, 'Photo', { name: 'spec.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') });
  assert.equal(cover(), undefined, 'the first cover field holds a pdf, which is no picture');
  w.updateEntity(e.id, { Photo: [] });
  const photo = w.attachToField(e.id, 'Photo', { name: 'desk.png', mime: 'image/png', bytes: PNG });
  assert.equal(cover(), photo.id, 'the first cover field wins');
  const gone = { ...w.readEntity(e.id) };
  gone.files = gone.files.map((f) => (f.id === photo.id ? { ...f, missing: true } : f));
  assert.equal(Board.coverOf(tableOf(w, 'Shopping List'), gone), null, 'a missing file is skipped');
  w.updateTable(list.id, { hiddenFields: ['Photo'] });
  assert.equal(cover(), back.id, 'a hidden field is not shown, so the next cover field heads the record');
  assert.equal(Board.coverOf(tableOf(w, 'Shopping List'), { raw: {}, files: [] }), null);
});

test('the picture defaults to the cover field size, and sizes map to card and column widths', () => {
  const { w } = shop();
  const t = tableOf(w, 'Shopping List');
  assert.equal(Board.pictureOf(t, {}), 'small', 'Photo is the first cover field and is small');
  assert.equal(Board.pictureOf(t, { picture: 'large' }), 'large');
  assert.equal(Board.pictureOf({ fields: [] }, {}), 'off', 'no cover field, no picture');
  assert.equal(Board.groupsOf({}), 'side');
  assert.equal(Board.groupsOf({ groups: 'stacked' }), 'stacked');
  assert.deepEqual(Board.CARD_PX, { small: 132, medium: 188, large: 256 });
  assert.deepEqual(Board.COLUMN_PX, { small: 184, medium: 232, large: 288 });
  assert.deepEqual(Board.PHONE_COLUMNS, { small: 3, medium: 2, large: 2 });
  assert.deepEqual(Board.widths('off'), { card: 188, column: 232, phone: 2 }, 'picture off sizes like medium');
});
