import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.WEAVE_KEYSTORE ??= join(mkdtempSync(join(tmpdir(), 'weave-sec-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');

const BACKUP = { lastAt: '2026-10-09T04:00:00.000Z', lastStatus: 'failed', lastError: 'AccessDenied at s3://acme-backups/weave', nextAt: '2026-10-10T04:00:00.000Z', dest: 's3://acme-backups/weave' };
const BUILD = { sha: 'abc1234', diskSha: 'abc1234', stale: false, releaseDir: '/data/releases/0.4.88', supervisorPid: 4242 };
const SECRET_KEYS = ['version', 'workspace', 'startedAt', 'uptime', 'sha', 'diskSha', 'releaseDir', 'supervisorPid', 'entities', 'sizeBytes', 'backup'];

async function serve({ walled = true } = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const architect = w.createAccount({ name: 'root', role: 'architect' }).token;
  const observer = w.createAccount({ name: 'eye', role: 'observer' }).token;
  if (walled) w.setRequireAuth(true);
  const { server, port } = await startServer(w, { port: 0, build: () => BUILD, backup: () => BACKUP, origin: 'https://weave.example.com' });
  const health = async (token, host = 'weave.example.com') => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Host: host, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, body: await res.json() };
  };
  return { health, architect, observer, stop: () => server.close() };
}

test('an anonymous caller learns that the instance is up and nothing else', async () => {
  const { health, stop } = await serve();
  try {
    const { status, body } = await health(null);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, name: 'weave' });
  } finally { stop(); }
});

test("the Railway probe sends no credentials and still gets its 200", async () => {
  const { health, stop } = await serve();
  try {
    const { status, body } = await health(null, 'healthcheck.railway.app');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  } finally { stop(); }
});

test('a signed-in architect gets the full body: build, sizes, backup', async () => {
  const { health, architect, stop } = await serve();
  try {
    const { status, body } = await health(architect);
    assert.equal(status, 200);
    for (const k of SECRET_KEYS) assert.ok(k in body, `the architect body carries ${k}`);
    assert.deepEqual(body.backup, BACKUP);
    assert.equal(body.sha, 'abc1234');
  } finally { stop(); }
});

test('a signed-in observer gets the version the sidebar chip shows and no more', async () => {
  const { health, observer, stop } = await serve();
  try {
    const { body } = await health(observer);
    assert.deepEqual(Object.keys(body).sort(), ['name', 'ok', 'version']);
  } finally { stop(); }
});

test('an open workspace with accounts keeps the same rule: anonymous means status only', async () => {
  const { health, stop } = await serve({ walled: false });
  try {
    assert.deepEqual((await health(null)).body, { ok: true, name: 'weave' });
  } finally { stop(); }
});

test('a workspace with no accounts, the local default, still answers everything to its one user', async () => {
  const { server, port } = await startServer(new Weave(), { port: 0, build: () => BUILD });
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(body.sha, 'abc1234');
    assert.equal(typeof body.entities, 'number');
  } finally { server.close(); }
});
