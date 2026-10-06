import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

const CLI = fileURLToPath(new URL('../bin/weave.js', import.meta.url));

function tmp() {
  return mkdtempSync(join(tmpdir(), 'weave-blobs-'));
}

function seed(w) {
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Deck' });
  w.addField('Deck', { name: 'Slides', type: 'attachments' });
  const e = w.createEntity('Deck', { name: 'Q3' });
  const file = w.attachToField(e.id, 'Slides', {
    name: 'c-json-editor.html', mime: 'text/html', bytes: Buffer.from('<h1>deck</h1>'),
  });
  return { entity: e.id, file: file.id };
}

test('a file-backed export carries the blob bytes', () => {
  const w = new Weave({ path: join(tmp(), 'ws.db') });
  const { file } = seed(w);
  const dump = w.exportJSON();
  assert.equal(dump.fileBlobs?.[file], Buffer.from('<h1>deck</h1>').toString('base64'),
    'the dump names the file but does not carry it');
});

test('export → import into a fresh data dir keeps the file readable', () => {
  const src = new Weave({ path: join(tmp(), 'src.db') });
  const { file } = seed(src);
  const dump = JSON.parse(JSON.stringify(src.exportJSON()));

  const dir = tmp();
  const dst = new Weave({ path: join(dir, 'dst.db') });
  dst.importJSON(dump);

  assert.equal(dst.readFile(file).bytes.toString('utf8'), '<h1>deck</h1>');
  assert.ok(existsSync(join(dir, 'files', file)), 'the blob was not landed on disk');
});

test('an import leaves no base64 in the persisted workspace', () => {
  const src = new Weave({ path: join(tmp(), 'src.db') });
  seed(src);
  const dump = JSON.parse(JSON.stringify(src.exportJSON()));

  const dir = tmp();
  const path = join(dir, 'dst.db');
  const dst = new Weave({ path });
  dst.importJSON(dump);
  assert.equal(dst.state.fileBlobs, undefined, 'blobs stayed in live state');

  const db = new DatabaseSync(path, { readOnly: true });
  const meta = db.prepare('SELECT json FROM weave_meta WHERE id = 1').get().json;
  db.close();
  assert.ok(!meta.includes('fileBlobs'), 'base64 blobs were persisted into the .db');
});

test('opening a legacy .json dump lands its blobs too', () => {
  const src = new Weave({ path: join(tmp(), 'src.db') });
  const { file } = seed(src);

  const dir = tmp();
  const jsonPath = join(dir, 'legacy.json');
  writeFileSync(jsonPath, JSON.stringify(src.exportJSON(), null, 1));

  const w = new Weave({ path: jsonPath });
  assert.equal(w.readFile(file).bytes.toString('utf8'), '<h1>deck</h1>');
  const db = new DatabaseSync(join(dir, 'legacy.db'), { readOnly: true });
  const meta = db.prepare('SELECT json FROM weave_meta WHERE id = 1').get().json;
  db.close();
  assert.ok(!meta.includes('fileBlobs'), 'base64 blobs were persisted into the migrated .db');
});

test('the workspace logo survives the round trip', () => {
  const src = new Weave({ path: join(tmp(), 'src.db') });
  seed(src);
  src.setWorkspaceLogo({ name: 'mark.svg', bytes: Buffer.from('<svg id="PNGBYTES"/>') });
  const dump = JSON.parse(JSON.stringify(src.exportJSON()));

  const dst = new Weave({ path: join(tmp(), 'dst.db') });
  dst.importJSON(dump);
  assert.equal(dst.getWorkspaceLogo().bytes.toString('utf8'), '<svg id="PNGBYTES"/>');
});

test('an in-memory workspace still round-trips', () => {
  const src = new Weave();
  const { file } = seed(src);
  const dst = new Weave();
  dst.importJSON(JSON.parse(JSON.stringify(src.exportJSON())));
  assert.equal(dst.readFile(file).bytes.toString('utf8'), '<h1>deck</h1>');
});

test('export survives a blob that is already gone', () => {
  const dir = tmp();
  const w = new Weave({ path: join(dir, 'ws.db') });
  const { file } = seed(w);
  rmSync(join(dir, 'files', file));
  const dump = w.exportJSON();
  assert.equal(dump.fileBlobs?.[file], undefined, 'a blob that is gone cannot be exported');
  assert.ok(dump.entities, 'the export still succeeded');
});

test('a file whose blob is gone reads as missing', () => {
  const dir = tmp();
  const w = new Weave({ path: join(dir, 'ws.db') });
  const { entity, file } = seed(w);
  assert.equal(w.readEntity(entity).files.find((f) => f.id === file).missing, undefined,
    'a present file must not be flagged');

  rmSync(join(dir, 'files', file));
  const read = w.readEntity(entity);
  assert.equal(read.files.find((f) => f.id === file).missing, true);
  assert.equal(read.files.find((f) => f.id === file).name, 'c-json-editor.html',
    'the name is still shown — the reader must know WHICH file is gone');
  assert.throws(() => w.readFile(file), WeaveError);
});

test('an in-memory workspace flags a lost blob the same way', () => {
  const w = new Weave();
  const { entity, file } = seed(w);
  delete w.state.fileBlobs[file];
  assert.equal(w.readEntity(entity).files.find((f) => f.id === file).missing, true);
});

test('the CLI export → import round trip keeps the file (the reported repro)', () => {
  const srcDir = tmp();
  const src = new Weave({ path: join(srcDir, 'src.db') });
  const { file } = seed(src);

  const dumpPath = join(srcDir, 'dump.json');
  execFileSync('node', [CLI, 'export', '--out', dumpPath, '--data', join(srcDir, 'src.db')], { encoding: 'utf8' });

  const dstDir = tmp();
  const dstPath = join(dstDir, 'dst.db');
  execFileSync('node', [CLI, 'import', '--file', dumpPath, '--data', dstPath], { encoding: 'utf8' });

  assert.equal(new Weave({ path: dstPath }).readFile(file).bytes.toString('utf8'), '<h1>deck</h1>');
});

test('GET /api/export carries the blobs; the MCP tool leaves them out', async () => {
  const w = new Weave({ path: join(tmp(), 'ws.db') });
  const { file } = seed(w);
  const { server } = await startServer(w, { port: 0 });
  try {
    const dump = await (await fetch(`http://127.0.0.1:${server.address().port}/api/export`)).json();
    assert.ok(dump.fileBlobs?.[file], 'the backup route dropped the bytes');
  } finally {
    server.close();
  }
  assert.equal(dispatchTool(w, 'weave_export_json', {}).fileBlobs, undefined,
    'the MCP dump pushed base64 at its reader');
  assert.ok(dispatchTool(w, 'weave_export_json', { blobs: true }).fileBlobs?.[file],
    'an agent that asks for the bytes cannot get them');
});

test('a missing file is named in the cell, not silently dropped', () => {
  const dir = tmp();
  const w = new Weave({ path: join(dir, 'ws.db') });
  const { entity, file } = seed(w);
  assert.equal(w.readEntity(entity).fields.Slides, 'c-json-editor.html');
  rmSync(join(dir, 'files', file));
  assert.equal(w.readEntity(entity).fields.Slides, 'c-json-editor.html (missing)');
});

test('a query select names an attached file the way the record does', () => {
  const dir = tmp();
  const w = new Weave({ path: join(dir, 'ws.db') });
  const { file } = seed(w);
  const [row] = dispatchTool(w, 'weave_query', { db: 'Deck', select: ['Name', 'Slides'] }).items;
  assert.equal(row.Slides, 'c-json-editor.html');
  rmSync(join(dir, 'files', file));
  const [gone] = dispatchTool(w, 'weave_query', { db: 'Deck', select: ['Slides'] }).items;
  assert.equal(gone.Slides, 'c-json-editor.html (missing)', 'a lost blob still names its file');
});

test('importing a dump without bytes names every file it could not land', () => {
  const src = new Weave({ path: join(tmp(), 'src.db') });
  const { entity, file } = seed(src);
  const dump = JSON.parse(JSON.stringify(dispatchTool(src, 'weave_export_json', {})));
  const dst = new Weave({ path: join(tmp(), 'dst.db') });
  const res = dispatchTool(dst, 'weave_import_json', { state: dump });
  assert.equal(res.ok, true);
  assert.equal(res.files, 1);
  assert.deepEqual(res.missing, [{ entity, file, name: 'c-json-editor.html' }]);
  assert.match(res.warning, /1 of 1 files? arrived without (its|their) bytes/);
});

test('a dump that carries its bytes imports with nothing missing', () => {
  const src = new Weave({ path: join(tmp(), 'src.db') });
  seed(src);
  const dump = JSON.parse(JSON.stringify(src.exportJSON()));
  const res = new Weave({ path: join(tmp(), 'dst.db') }).importJSON(dump);
  assert.deepEqual(res, { files: 1, missing: [] });
});

test('the MCP dump imported back into its own workspace finds its bytes', () => {
  const w = new Weave({ path: join(tmp(), 'ws.db') });
  seed(w);
  const dump = JSON.parse(JSON.stringify(dispatchTool(w, 'weave_export_json', {})));
  assert.deepEqual(w.importJSON(dump), { files: 1, missing: [] });
});

test('POST /api/import and the CLI report the files without bytes', async () => {
  const srcDir = tmp();
  const src = new Weave({ path: join(srcDir, 'src.db') });
  const { file } = seed(src);
  const dump = dispatchTool(src, 'weave_export_json', {});
  const dst = new Weave({ path: join(tmp(), 'dst.db') });
  const { server } = await startServer(dst, { port: 0 });
  try {
    const res = await (await fetch(`http://127.0.0.1:${server.address().port}/api/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dump),
    })).json();
    assert.equal(res.ok, true);
    assert.equal(res.missing[0].file, file);
  } finally {
    server.close();
  }
  const dumpPath = join(srcDir, 'reader.json');
  writeFileSync(dumpPath, JSON.stringify(dump));
  const out = JSON.parse(execFileSync('node', [CLI, 'import', '--file', dumpPath, '--data', join(tmp(), 'cli.db')], { encoding: 'utf8' }));
  assert.equal(out.missing[0].file, file);
  assert.match(out.warning, /without/);
});
