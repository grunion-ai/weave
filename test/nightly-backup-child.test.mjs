import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { backup, restore, scheduleNightly } from '../src/backup.js';
import { tempDir } from './lib/temp.mjs';

const tmp = (label) => tempDir(`weave-nightly-${label}-`);
const PASS = 'correct horse battery staple';
const quiet = { setTimer: () => ({}), audit: () => {}, log: () => {} };

function bucket() {
  const objects = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const key = url.pathname.split('/').slice(2).join('/');
    if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) { res.writeHead(403); return res.end(); }
    if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); res.writeHead(200); return res.end(); }
    if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
    if (url.searchParams.get('list-type') === '2') {
      const listed = [...objects.keys()].filter((k) => k.startsWith(url.searchParams.get('prefix') ?? '')).sort();
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<ListBucketResult>${listed.map((k) => `<Contents><Key>${k}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    if (objects.has(key)) { res.writeHead(200); return res.end(objects.get(key)); }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, objects,
    env: { WEAVE_BACKUP_ENDPOINT: `http://127.0.0.1:${server.address().port}`, WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's', WEAVE_BACKUP_REGION: 'auto', WEAVE_BACKUP_PASSPHRASE: PASS },
  })));
}

function smallWorkspace() {
  const dir = tmp('data');
  const w = new Weave({ path: join(dir, 'alpha.db'), keystorePath: join(dir, 'keystore.json') });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const task = w.createEntity('Ops/Task', { name: 'Back up at night' });
  const file = w.attachFile(task.id, { name: 'plan.txt', mime: 'text/plain', bytes: Buffer.from('the plan, byte for byte\n') });
  w.store.close?.();
  return { dir, file };
}

function workspaceOf(megabytes) {
  const dir = tmp('big');
  const path = join(dir, 'big.db');
  new Weave({ path, keystorePath: join(dir, 'keystore.json') }).store.close?.();
  const db = new DatabaseSync(path);
  db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO entities (id, db_id, public_id, updated_at, json)
    SELECT 'bulk-' || i, 'bulk', i, '2026-11-12T04:00:00Z',
      json_object('id', 'bulk-' || i, 'dbId', 'bulk', 'publicId', i, 'values', json_object('Name', 'Row ' || i, 'Notes', hex(randomblob(468))))
    FROM n`).run(Math.ceil(megabytes * 720));
  db.close();
  return { dir, bytes: statSync(path).size };
}

async function worstGap(work) {
  let last = performance.now(), worst = 0;
  const tick = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 5);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
  try {
    await pause();
    await work();
    await pause();
  } finally { clearInterval(tick); }
  return Math.round(worst);
}

test('the nightly builds its backup in a child process and keeps the result on the same schedule state', async () => {
  const { server, objects, env } = await bucket();
  try {
    const src = smallWorkspace();
    const out = tmp('out');
    const dest = 's3://nightly-bucket/weave';
    const forks = [], audit = [], timers = [];
    const s = scheduleNightly({
      run: () => backup({ dataDir: src.dir, out, dest, env, keep: false }),
      dest,
      setTimer: (fn) => { timers.push(fn); return {}; },
      audit: (e) => audit.push(e),
      log: () => {},
      fork: (...args) => { forks.push(args[0]); return fork(...args); },
    });
    await s.fire();
    assert.equal(forks.length, 1, 'the run started one child process');
    assert.match(forks[0], /src[\\/]backup\.js$/, 'the child runs the backup module');
    const status = s.status();
    assert.equal(status.lastStatus, 'completed', status.lastError);
    assert.equal(status.kind, 's3');
    assert.equal(timers.length, 2, 'the parent armed tomorrow after the child reported');
    const keys = [...objects.keys()];
    assert.equal(keys.length, 1, 'the child uploaded one archive');
    assert.match(keys[0], /^weave\/weave-backup-all-.+\.tar\.enc$/);
    assert.deepEqual(audit, [{ action: 'backup-completed', detail: { archive: keys[0].slice('weave/'.length), bytes: objects.get(keys[0]).length, orphans: 0, dest } }]);
    assert.deepEqual(readdirSync(out), [], 'keep: false held in the child: no local archive is left');
    const back = tmp('back');
    const r = await restore({ source: `s3://nightly-bucket/${keys[0]}`, dataDir: back, env });
    assert.ok(r.landed.includes('alpha.db'));
    assert.ok(readFileSync(join(back, 'files', src.file.id)).equals(readFileSync(join(src.dir, 'files', src.file.id))), 'the attachment the child sealed restores byte for byte');
  } finally { server.close(); }
});

test('a nightly whose child fails keeps the child\'s error on the schedule state and still arms tomorrow', async () => {
  const forks = [], audit = [], timers = [];
  const missing = join(tmp('gone'), 'not-here');
  const s = scheduleNightly({
    run: () => backup({ dataDir: missing, out: tmp('out'), env: {} }),
    dest: 's3://b/p',
    setTimer: (fn) => { timers.push(fn); return {}; },
    audit: (e) => audit.push(e),
    log: () => {},
    fork: (...args) => { forks.push(args[0]); return fork(...args); },
  });
  await s.fire();
  assert.equal(forks.length, 1, 'the failed run still ran in a child');
  assert.equal(s.status().lastStatus, 'failed');
  assert.match(s.status().lastError, /Data directory not found: .*not-here/);
  assert.equal(audit.at(-1).action, 'backup-failed');
  assert.match(audit.at(-1).detail.error, /Data directory not found/);
  assert.equal(timers.length, 2, 'a failure still schedules tomorrow');
});

test('a child that dies before it reports fails the run instead of leaving it waiting', async () => {
  const src = smallWorkspace();
  const out = tmp('out');
  const s = scheduleNightly({
    run: () => backup({ dataDir: src.dir, out, env: {} }),
    dest: 's3://b/p',
    ...quiet,
    fork: (...args) => { const child = fork(...args); child.kill('SIGKILL'); return child; },
  });
  await s.fire();
  assert.equal(s.status().lastStatus, 'failed');
  assert.match(s.status().lastError, /SIGKILL/);
});

test('the serving loop keeps answering while the nightly backs up a 50 MB workspace', async () => {
  const big = workspaceOf(50);
  assert.ok(big.bytes >= 50e6, `the workspace is 50 MB: ${big.bytes} bytes`);
  const env = { WEAVE_BACKUP_PASSPHRASE: PASS };
  const nightlyOut = tmp('nightly-out');
  const s = scheduleNightly({ run: () => backup({ dataDir: big.dir, out: nightlyOut, env }), dest: null, ...quiet });
  const nightly = await worstGap(() => s.fire());
  assert.equal(s.status().lastStatus, 'completed', s.status().lastError);
  assert.equal(readdirSync(nightlyOut).length, 1, 'the child wrote the archive');
  const inPlace = await worstGap(() => backup({ dataDir: big.dir, out: tmp('in-place-out'), env }));
  assert.ok(nightly * 4 < inPlace, `the nightly held the loop for ${nightly} ms at most; the same backup run in place held it for ${inPlace} ms`);
});
