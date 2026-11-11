import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Weave } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';
import { unwrapData } from './lib/fixtures.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');

function workspace() {
  const w = new Weave({ actor: 'web' });
  w.createSpace({ name: 'Work' });
  const table = w.createTable({ space: 'Work', name: 'Task' });
  const row = w.createEntity(table.id, { name: 'Row' });
  w.setDoc(row.id, 'FIRST_TEXT');
  return { w, row };
}

function as(w, actor) {
  const call = (name, args) => {
    w.actor = actor;
    return handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { tools: 'all' }).result;
  };
  const ok = (name, args) => {
    const res = call(name, args);
    assert.ok(!res.isError, `${name}: ${res.content[0].text}`);
    const text = unwrapData(res.content[0].text);
    try { return JSON.parse(text); } catch { return text; }
  };
  const refused = (name, args) => {
    const res = call(name, args);
    assert.equal(res.isError, true, `${name} was refused`);
    return { text: res.content[0].text, ...res.structuredContent };
  };
  return { call, ok, refused };
}

const humanWrites = (w, id, text) => { w.actor = 'web'; w.setDoc(id, text); };

test('weave_set_doc without a base on a document changed since the caller read it refuses, writes nothing and returns the current revision (Issue #1682)', () => {
  const { w, row } = workspace();
  const agent = as(w, 'mcp:agent');
  assert.equal(agent.ok('weave_get_doc', { entity: row.id }), 'FIRST_TEXT');
  humanWrites(w, row.id, 'HUMAN_EDIT');
  const no = agent.refused('weave_set_doc', { entity: row.id, markdown: 'AGENT_TEXT' });
  assert.equal(no.code, 'stale');
  assert.match(no.text, /Description changed since you read it/);
  assert.equal(no.base, hash('HUMAN_EDIT'), 'the refusal names the base of the stored text');
  assert.equal(no.revision, w.entityRevision(row.id), 'and the record revision as it stands');
  assert.ok(no.text.includes(no.base), 'the text an agent reads carries the base too');
  assert.equal(w.getDoc(row.id), 'HUMAN_EDIT', 'the human edit survives');
});

test('a replace right after the read lands without a base and answers the next base, and a read through weave_get_entity counts (Issue #1682)', () => {
  const { w, row } = workspace();
  const agent = as(w, 'mcp:agent');
  agent.ok('weave_get_doc', { entity: row.id });
  assert.deepEqual(agent.ok('weave_set_doc', { entity: row.id, markdown: 'AGENT_TEXT' }), { ok: true, length: 10, base: hash('AGENT_TEXT') });
  assert.equal(w.getDoc(row.id), 'AGENT_TEXT');
  humanWrites(w, row.id, 'HUMAN_EDIT');
  assert.equal(agent.ok('weave_get_entity', { entity: row.id }).docs.Description, 'HUMAN_EDIT');
  agent.ok('weave_call', { name: 'weave_set_doc', args: { entity: row.id, markdown: 'AGENT_AGAIN' } });
  assert.equal(w.getDoc(row.id), 'AGENT_AGAIN', 'the core path reads with weave_get_entity and writes through weave_call');
});

test('a base-less replace of text the caller never read is refused, and an empty document takes it (Issue #1682)', () => {
  const { w, row } = workspace();
  const agent = as(w, 'mcp:agent');
  const no = agent.refused('weave_set_doc', { entity: row.id, markdown: 'BLIND' });
  assert.match(no.text, /You have not read Description/);
  assert.equal(no.base, hash('FIRST_TEXT'));
  assert.equal(w.getDoc(row.id), 'FIRST_TEXT');
  const fresh = agent.ok('weave_create_entity', { db: 'Task', name: 'Empty' });
  agent.ok('weave_set_doc', { entity: fresh.id, markdown: 'FIRST_WORDS' });
  assert.equal(w.getDoc(fresh.id), 'FIRST_WORDS', 'an empty document has nothing to overwrite');
});

test('a base replaces only the text it names: the refusal base lands, an old one is refused (Issue #1682)', () => {
  const { w, row } = workspace();
  const agent = as(w, 'mcp:agent');
  const no = agent.refused('weave_set_doc', { entity: row.id, markdown: 'MINE' });
  const stale = agent.refused('weave_set_doc', { entity: row.id, markdown: 'MINE', base: hash('OLDER_TEXT') });
  assert.match(stale.text, /changed since you read it/);
  assert.equal(w.getDoc(row.id), 'FIRST_TEXT');
  assert.equal(agent.ok('weave_set_doc', { entity: row.id, markdown: 'MINE', base: no.base }).base, hash('MINE'));
  assert.equal(w.getDoc(row.id), 'MINE');
});

test('agents keep their own reads: another agent reading does not clear a write for this one (Issue #1682)', () => {
  const { w, row } = workspace();
  const one = as(w, 'mcp:one');
  const two = as(w, 'mcp:two');
  two.ok('weave_get_doc', { entity: row.id });
  one.refused('weave_set_doc', { entity: row.id, markdown: 'ONE_BLIND' });
  two.ok('weave_set_doc', { entity: row.id, markdown: 'TWO_TEXT' });
  assert.equal(w.getDoc(row.id), 'TWO_TEXT');
});

test('a document value in weave_update_entity follows the same rule, and an unchanged one passes (Issue #1682)', () => {
  const { w, row } = workspace();
  const agent = as(w, 'mcp:agent');
  agent.ok('weave_get_entity', { entity: row.id });
  humanWrites(w, row.id, 'HUMAN_EDIT');
  const no = agent.refused('weave_update_entity', { entity: row.id, values: { Description: 'AGENT_TEXT' } });
  assert.equal(no.code, 'stale');
  assert.equal(no.base, hash('HUMAN_EDIT'));
  assert.equal(w.getDoc(row.id), 'HUMAN_EDIT');
  agent.ok('weave_update_entity', { entity: row.id, values: { Name: 'Renamed', Description: 'HUMAN_EDIT' } });
  assert.equal(w.readEntity(row.id).name, 'Renamed', 'sending the stored text back is no overwrite');
  agent.ok('weave_get_entity', { entity: row.id });
  agent.ok('weave_update_entity', { entity: row.id, values: { Description: 'AGENT_TEXT' } });
  assert.equal(w.getDoc(row.id), 'AGENT_TEXT');
});

test('append stays allowed without a base or a read (Issue #1682)', () => {
  const { w, row } = workspace();
  const agent = as(w, 'mcp:agent');
  agent.ok('weave_get_doc', { entity: row.id });
  humanWrites(w, row.id, 'HUMAN_EDIT');
  agent.ok('weave_set_doc', { entity: row.id, markdown: 'AGENT_NOTE', mode: 'append' });
  assert.equal(w.getDoc(row.id), 'HUMAN_EDIT\n\nAGENT_NOTE');
});
