import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, accessSync, rmSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, WeaveError } from '../src/store.js';

const readOnlyDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-ro-'));
  chmodSync(dir, 0o555);
  try { accessSync(dir, constants.W_OK); chmodSync(dir, 0o755); rmSync(dir, { recursive: true, force: true }); return null; }
  catch { return dir; }
};

const open = (dir, name = 'workspace.db') => {
  try { new Store(join(dir, name)).load(); } catch (err) { return err; }
  return null;
};

test('a data directory the process cannot write names the cause, not the file format (Issue #474)', (t) => {
  const dir = readOnlyDir();
  if (!dir) return t.skip('this process can write anywhere, so the failure cannot be staged');
  try {
    const err = open(dir);
    assert.ok(err instanceof WeaveError, `a WeaveError, got ${err}`);
    assert.equal(err.code, 'invalid');
    assert.match(err.message, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the message names the directory');
    assert.match(err.message, /not writable|cannot write/i, 'and says the directory cannot be written');
    assert.match(err.message, new RegExp(`\\b${process.getuid()}\\b`), 'and names the uid it runs as');
    assert.match(err.message, /RAILWAY_RUN_UID=0/, 'and names the answer the Railway guide gives');
    assert.doesNotMatch(err.message, /is not a SQLite database/,
      'and does not blame the file format for a permission problem');
  } finally {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that really is not a SQLite database still says so', async () => {
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'weave-notdb-'));
  try {
    writeFileSync(join(dir, 'workspace.db'), 'this is not a database');
    const err = open(dir);
    assert.ok(err instanceof WeaveError, `a WeaveError, got ${err}`);
    assert.match(err.message, /is not a SQLite database/, 'the writable case keeps its own message');
    assert.doesNotMatch(err.message, /RAILWAY_RUN_UID=0/, 'and does not send the reader to Railway');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
