/* Every engine mutation answers with a result. The four deletes that used to
   return nothing reached the CLI as the literal word "undefined" and reached
   MCP as a content item with no text at all, because those surfaces pass the
   engine's return value straight through while HTTP wraps its own literal.
   The rule pinned here: a delete says what it deleted, on every door. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

function fixture() {
  const w = new Weave();
  w.createSpace({ name: 'P' });
  w.createTable({ space: 'P', name: 'Task' });
  w.addField('P/Task', { name: 'Notes', type: 'text' });
  const e = w.createEntity('P/Task', { name: 'a' });
  return { w, e };
}

test('deleteField, deleteComment, deleteAutomation and deleteFile each return what they deleted', () => {
  const { w, e } = fixture();
  const field = w.getField('P/Task', 'Notes');
  assert.deepEqual(w.deleteField('P/Task', 'Notes'), { id: field.id, name: 'Notes', db: 'P/Task', deleted: true });

  const c = w.addComment(e.id, { author: 'kyle', text: 'hi' });
  assert.deepEqual(w.deleteComment(e.id, c.id), { id: c.id, deleted: true });
  assert.deepEqual(w.deleteComment(e.id, 'never-there'), { id: 'never-there', deleted: false },
    'a comment that was not there is reported, not invented');

  const auto = w.createAutomation('P/Task', { name: 'x', trigger: { type: 'entity-created' }, actions: [{ type: 'append-doc', text: 'made' }] });
  assert.deepEqual(w.deleteAutomation(auto.id), { id: auto.id, deleted: true });
  assert.deepEqual(w.deleteAutomation(auto.id), { id: auto.id, deleted: false });

  const file = w.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('x').toString('base64') });
  assert.deepEqual(w.deleteFile(e.id, file.id), { id: file.id, entity: e.id, deleted: true });
  assert.deepEqual(w.deleteFile(e.id, file.id), { id: file.id, entity: e.id, deleted: false });
});

test('MCP hands a delete back as a text item, never an item with no text', () => {
  const { w, e } = fixture();
  const c = w.addComment(e.id, { author: 'kyle', text: 'hi' });
  const auto = w.createAutomation('P/Task', { name: 'x', trigger: { type: 'entity-created' }, actions: [{ type: 'append-doc', text: 'made' }] });
  const calls = [
    ['weave_delete_field', { db: 'P/Task', field: 'Notes' }],
    ['weave_delete_comment', { entity: e.id, comment: c.id }],
    ['weave_automations', { action: 'delete', automation: auto.id }],
  ];
  for (const [name, args] of calls) {
    const res = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const item = res.result.content[0];
    assert.equal(typeof item.text, 'string', `${name} must answer with text`);
    assert.equal(JSON.parse(item.text).deleted, true, `${name} says it deleted`);
    assert.ok(!res.result.isError, `${name} is not an error`);
  }
});

test('the CLI prints a delete as JSON, not the word undefined', () => {
  const data = join(mkdtempSync(join(tmpdir(), 'weave-cli-')), 'weave.json');
  const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' });
  try {
    cli('space', 'create', 'P');
    cli('table', 'create', 'P', 'Task');
    cli('field', 'add', 'P/Task', 'Notes', 'text');
    const out = cli('field', 'delete', 'P/Task', 'Notes').trim();
    assert.notEqual(out, 'undefined');
    assert.equal(JSON.parse(out).deleted, true);
  } finally {
    rmSync(dirname(data), { recursive: true, force: true });
  }
});
