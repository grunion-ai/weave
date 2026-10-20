import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { startServer } = await import('../src/server.js');
const { FIELD_TYPE_VOCABULARY } = await import('../src/vocabulary.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f3a8d40000000049454e44ae426082', 'hex');

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'CRM' });
  w.createTable({ space: 'CRM', name: 'Contact' });
  w.addField('Contact', { name: 'Face', type: 'avatar' });
  return w;
}
const fieldOf = (w, table, name) => Object.values(w.getTable(table).fields).find((x) => x.name === name);

test('an avatar field is round unless the config says square', () => {
  const w = fresh();
  assert.equal(fieldOf(w, 'Contact', 'Face').config.shape, 'round');
  w.createTable({ space: 'CRM', name: 'Company' });
  w.addField('Company', { name: 'Logo', type: 'avatar', config: { shape: 'square' } });
  assert.equal(fieldOf(w, 'Company', 'Logo').config.shape, 'square');
  w.createTable({ space: 'CRM', name: 'Vendor' });
  assert.throws(() => w.addField('Vendor', { name: 'Odd', type: 'avatar', config: { shape: 'hexagon' } }), /shape/);
});

test('a table holds one avatar field', () => {
  const w = fresh();
  assert.throws(() => w.addField('Contact', { name: 'Second face', type: 'avatar' }), /already has an avatar/);
});

test('uploading into an avatar replaces the face and refuses a non-image', () => {
  const w = fresh();
  const e = w.createEntity('Contact', { name: 'Myriam Cardoso' });
  const f = fieldOf(w, 'Contact', 'Face');
  const a = w.attachToField(e.id, 'Face', { name: 'a.png', mime: 'image/png', bytes: PNG });
  const b = w.attachToField(e.id, 'Face', { name: 'b.png', mime: 'image/png', bytes: PNG });
  assert.deepEqual(w.getEntity(e.id).values[f.id], [b.id], 'the second upload takes the slot');
  assert.ok(w.getEntity(e.id).files.some((x) => x.id === a.id), 'the earlier photo stays in the row files');
  assert.throws(() => w.attachToField(e.id, 'Face', { name: 'cv.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1') }), /image/);
  assert.throws(() => w.attachToField(e.id, 'Face', { name: 'x.svg', mime: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }), /PNG, JPEG, GIF or WebP/);
});

test('an avatar holds one of the row\'s own files', () => {
  const w = fresh();
  const e1 = w.createEntity('Contact', { name: 'A' });
  const e2 = w.createEntity('Contact', { name: 'B' });
  const foreign = w.attachFile(e2.id, { name: 'b.png', bytes: PNG });
  assert.throws(() => w.updateEntity(e1.id, { Face: foreign.id }), /not a file on this entity/);
  const x = w.attachFile(e1.id, { name: 'x.png', bytes: PNG });
  const y = w.attachFile(e1.id, { name: 'y.png', bytes: PNG });
  assert.throws(() => w.updateEntity(e1.id, { Face: [x.id, y.id] }), /holds one/);
});

test('deleting the photo empties the avatar', () => {
  const w = fresh();
  const e = w.createEntity('Contact', { name: 'A' });
  const file = w.attachToField(e.id, 'Face', { name: 'a.png', bytes: PNG });
  w.deleteFile(e.id, file.id);
  assert.deepEqual(w.getEntity(e.id).values[fieldOf(w, 'Contact', 'Face').id], []);
});

test('the chip and the card carry the avatar: initials and hue, then the photo', () => {
  const w = fresh();
  const e = w.createEntity('Contact', { name: 'Myriam Cardoso' });
  const core = globalThis.chipCore;
  const want = { shape: 'round', initials: core.initialsFor('Myriam Cardoso'), hue: core.hueForName('Myriam Cardoso'), file: null, badge: null };
  assert.deepEqual(w.renderView(e.id, 'chip').avatar, want);
  assert.deepEqual(w.renderView(e.id, 'card').avatar, want);
  assert.deepEqual(w.readEntity(e.id).avatar, want);
  const file = w.attachToField(e.id, 'Face', { name: 'a.png', bytes: PNG });
  assert.equal(w.renderView(e.id, 'chip').avatar.file, file.id);
});

test('a table with no avatar field renders exactly as before', () => {
  const w = fresh();
  w.createTable({ space: 'CRM', name: 'Team' });
  const e = w.createEntity('Team', { name: 'Squad A' });
  assert.equal('avatar' in w.renderView(e.id, 'chip'), false);
  assert.equal('avatar' in w.renderView(e.id, 'card'), false);
  assert.equal('avatar' in w.readEntity(e.id), false);
});

test('the avatar is the face, never a segment', () => {
  const w = fresh();
  const e = w.createEntity('Contact', { name: 'A' });
  w.attachToField(e.id, 'Face', { name: 'a.png', bytes: PNG });
  assert.equal(w.renderView(e.id, 'card').fields.some((s) => s.label === 'Face'), false);
});

test('Users is minted with an Avatar, and an agent wears the agent badge', () => {
  const w = new Weave({ actor: 'kyle' });
  const users = w.getTable('System/Users');
  const avatar = Object.values(users.fields).find((f) => f.name === 'Avatar');
  assert.equal(avatar?.type, 'avatar');
  const bot = w.createEntity(users.id, { name: 'weave-fixer', values: { Kind: 'Agent' } });
  assert.equal(w.renderView(bot.id, 'chip').avatar.badge, 'agent');
  assert.equal(w.renderView(bot.id, 'chip').avatar.shape, 'round');
});

test('the vocabulary and the field registry know the type', () => {
  assert.ok(FIELD_TYPE_VOCABULARY.some((t) => t.type === 'avatar'));
  const w = fresh();
  const row = w.listEntities(w.getTable('Fields').id).find((e) => w.entityName(e) === 'Face');
  assert.ok(row, 'the column is in the Fields registry');
});

test('the REST field-upload route sets the avatar', async () => {
  const w = fresh();
  const e = w.createEntity('Contact', { name: 'A' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/entities/${e.id}/fields/Face/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'me.png', mime: 'image/png', bytes: PNG.toString('base64') }),
    });
    assert.equal(res.status, 201);
    const read = await (await fetch(`${base}/api/entities/${e.id}`)).json();
    assert.ok(read.avatar.file, 'the read names the photo');
  } finally {
    server.close();
  }
});
