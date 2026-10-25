import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSuites } from '../src/quality-mirror.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');
const dir = mkdtempSync(join(tmpdir(), 'weave-cli-uncalled-'));
const data = join(dir, 'ws.db');
const env = { ...process.env, WEAVE_KEYSTORE: join(dir, 'keystore.json'), WEAVE_ACTOR: 'census' };

function run(args, { db = data } = {}) {
  const r = spawnSync(process.execPath, ['--no-warnings', BIN, ...args, ...(db ? ['--data', db] : [])], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}
const ok = (args, opts) => {
  const r = run(args, opts);
  assert.equal(r.code, 0, `weave ${args.join(' ')} failed: ${r.err}`);
  return r;
};

test.before(() => {
  ok(['space', 'create', 'Ops']);
  ok(['table', 'create', 'Ops', 'Task']);
  ok(['field', 'add', 'Task', 'Points', 'number']);
  ok(['create', 'Task', 'Alpha', '--values', '{"Points":3}']);
});
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('weave delete trashes a row by its #ref; a ref that names nothing exits 1', () => {
  ok(['create', 'Task', 'Doomed']);
  const gone = ok(['delete', 'Task#2']).json();
  assert.equal(gone.name, 'Doomed');
  assert.ok(gone.deletedAt, 'a soft delete stamps the row');
  assert.match(ok(['trash', 'Task']).out, /Doomed/, 'the row waits in the trash');
  const miss = run(['delete', 'Task#99']);
  assert.equal(miss.code, 1);
  assert.match(miss.err, /Entity 'Task#99' not found/);
});

test('weave undo lists and reverses the last write; nothing left to undo is not an error', () => {
  ok(['create', 'Task', 'Mistake']);
  const list = ok(['undo', '--list', '--limit', '1']).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'create');
  assert.equal(list[0].name, 'Mistake');
  const undone = ok(['undo']).json();
  assert.equal(undone.undone[0].kind, 'create');
  assert.equal(undone.undone[0].name, 'Mistake');
  const after = run(['get', 'Task#3']);
  assert.ok(after.code !== 0 || after.json().deletedAt, 'the undone create is gone');
});

test('weave audit lists the workspace audit trail newest first, capped by --limit', () => {
  ok(['key', 'set', 'census-key', '--value', 'census-value']);
  const trail = ok(['audit', '--limit', '2']).json();
  assert.equal(trail.length, 2);
  assert.equal(trail[0].action, 'key-set');
  assert.deepEqual(trail[0].detail, { name: 'census-key' });
  assert.ok(trail[0].seq > trail[1].seq, 'newest first');
  assert.equal(trail[0].actor, 'census');
  const odd = run(['audit', '--limit', 'lots']);
  assert.equal(odd.code, 1, 'Issue #1091: a limit that is not a number fails');
  assert.match(odd.err, /datatype mismatch/, 'Issue #1091: with the SQLite message, not one naming the flag');
});

test('weave key sets, lists and refuses to reveal a key it does not hold', () => {
  ok(['key', 'set', 'stripe', '--value', 'census-secret']);
  const keys = ok(['key', 'list']).json();
  assert.deepEqual(keys.find((k) => k.name === 'stripe'), { name: 'stripe', set: true, owner: null, shared: false });
  assert.ok(!ok(['key', 'list']).out.includes('census-secret'), 'a list never prints the secret');
  const miss = run(['key', 'reveal', 'ghost']);
  assert.equal(miss.code, 1);
  assert.match(miss.err, /Key 'ghost' not found/);
});

test('weave formula check previews an expression; a broken one answers ok:false and an unknown subcommand exits 1', () => {
  assert.deepEqual(ok(['formula', 'check', 'Task', 'Points * 2']).json(), { ok: true, preview: 6, previewEntity: 'Alpha', type: 'number' });
  const broken = ok(['formula', 'check', 'Task', 'Points *']).json();
  assert.equal(broken.ok, false);
  assert.match(broken.error, /end of formula/);
  const odd = run(['formula', 'nope']);
  assert.equal(odd.code, 1);
  assert.match(odd.err, /Unknown formula subcommand 'nope'/);
});

test('weave quality check reports drift against a mirror; without --data, or with an unknown subcommand, it exits 1', () => {
  const q = join(dir, 'quality.db');
  ok(['space', 'create', 'Quality'], { db: q });
  ok(['table', 'create', 'Quality', 'Suite'], { db: q });
  ok(['field', 'add', 'Suite', 'File', 'text'], { db: q });
  ok(['table', 'create', 'Quality', 'Case'], { db: q });
  ok(['relation', 'add', 'Case', 'Suite', 'Suite', '--cardinality', 'many-to-one', '--inverse', 'Cases'], { db: q });
  const drift = run(['quality', 'check'], { db: q });
  assert.equal(drift.code, 1, 'an empty mirror is drift');
  const scanned = scanSuites(ROOT);
  assert.deepEqual(drift.json(), {
    suites: scanned.length, createdSuites: scanned.length, createdCases: scanned.reduce((n, s) => n + s.cases.length, 0),
    removedSuites: 0, removedCases: 0, renamedSuites: 0,
  });
  const bare = run(['quality', 'check'], { db: null });
  assert.equal(bare.code, 1);
  assert.match(bare.err, /quality needs an explicit --data/);
  const odd = run(['quality', 'nope'], { db: q });
  assert.equal(odd.code, 1);
  assert.match(odd.err, /Unknown quality subcommand 'nope'/);
});
