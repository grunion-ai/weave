import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const put = (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const newSpaces = [{ space: 'Design', tables: [] }, { space: 'Ops', tables: [] }];

async function boot() {
  const w = new Weave();
  w.updateWorkspace({ name: 'root' });
  w.createSpace({ name: 'Existing' });
  const { server } = await startServer(w, { port: 0 });
  return { w, server, base: `http://127.0.0.1:${server.address().port}` };
}

test('PUT /api/schema with partial true adds spaces and leaves the existing ones alone', async () => {
  const { w, server, base } = await boot();
  try {
    const res = await put(`${base}/api/schema`, { schema: newSpaces, partial: true });
    assert.equal(res.status, 200, await res.clone().text());
    const plan = await res.json();
    assert.ok(plan.some((p) => p.action === 'create-space' && p.subject === 'Design'), JSON.stringify(plan));
    assert.ok(w.getSpace('Design') && w.getSpace('Ops'), 'new spaces exist');
    assert.ok(w.getSpace('Existing'), 'the space the document did not repeat survives');
  } finally { server.close(); }
});

test('PUT /api/schema with partial true and dryRun plans without writing', async () => {
  const { w, server, base } = await boot();
  try {
    const res = await put(`${base}/api/schema`, { schema: newSpaces, partial: true, dryRun: true });
    assert.equal(res.status, 200, await res.clone().text());
    assert.ok((await res.json()).length);
    assert.equal(w.listSpaces().some((s) => s.name === 'Design'), false);
  } finally { server.close(); }
});

test('PUT /api/schema without partial still refuses a document that omits an existing space', async () => {
  const { w, server, base } = await boot();
  try {
    const res = await put(`${base}/api/schema`, { schema: newSpaces });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /would delete space 'Existing'/);
    assert.ok(w.getSpace('Existing'));
  } finally { server.close(); }
});

test('weave schema apply --partial adds spaces without repeating the existing ones', () => {
  const dir = tempDir('weave-schema-partial-');
  const data = join(dir, 'ws.db');
  const cli = (...args) => execFileSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8' });
  try {
    cli('space', 'create', 'Existing');
    const file = join(dir, 'doc.json');
    writeFileSync(file, JSON.stringify(newSpaces));
    assert.throws(() => cli('schema', 'apply', '--file', file), /would delete space 'Existing'/);
    cli('schema', 'apply', '--file', file, '--partial');
    const spaces = JSON.parse(cli('schema')).map((s) => s.space);
    assert.ok(['Existing', 'Design', 'Ops'].every((n) => spaces.includes(n)), spaces.join(','));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
