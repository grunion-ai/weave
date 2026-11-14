import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

test('renaming a built-in System column is refused and accounts and invites still sync', () => {
  const w = new Weave();
  assert.throws(() => w.updateField('System/Users', 'Email', { name: 'Mail' }), /Field 'Email' is part of the system registry/);
  assert.ok(Object.values(w.getTable('System/Users').fields).some((f) => f.name === 'Email'));
  const { account } = w.createAccount({ name: 'bot', role: 'editor' });
  assert.equal(account.name, 'bot');
});

test('every system column of every system table refuses a rename', () => {
  const w = new Weave();
  const tables = w.listTables().filter((t) => t.system);
  assert.ok(tables.length > 0);
  let checked = 0;
  for (const t of tables) {
    for (const f of Object.values(w.getTable(t.id).fields).filter((x) => x.system)) {
      assert.throws(() => w.updateField(t.id, f.id, { name: `${f.name} renamed` }), /part of the system registry/, `${t.name}.${f.name}`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});
