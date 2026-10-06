import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave, ACTIVITY_CAP } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

const OVER = 7;

function busy(w) {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  const quiet = w.createEntity(t, { name: 'quiet' });
  const e = w.createEntity(t, { name: 'busy' });
  for (let i = 0; i < ACTIVITY_CAP + OVER - 1; i++) w.addComment(e.id, { text: `c${i}` });
  return { e, quiet, t };
}

test('the cap is 500 and the entity counts what it drops', () => {
  assert.equal(ACTIVITY_CAP, 500, 'this change does not move the cap');
  const w = new Weave();
  const { e, quiet } = busy(w);
  const got = w.readEntity(e.id);
  assert.equal(got.activity.length, ACTIVITY_CAP);
  assert.equal(got.activityDropped, OVER, 'the read says how many older entries are gone');
  assert.equal(w.readEntity(quiet.id).activityDropped, 0, 'an untruncated entity reports 0');
  w.addComment(e.id, { text: 'one more' });
  assert.equal(w.readEntity(e.id).activityDropped, OVER + 1, 'the count accumulates');
});

test('the activity feed reports dropped entries for its scope', () => {
  const w = new Weave();
  const { e, quiet } = busy(w);
  assert.equal(w.activityFeed({ entityId: e.id }).dropped, OVER);
  assert.equal(w.activityFeed({ entityId: quiet.id }).dropped, 0);
  assert.equal(w.activityFeed().dropped, OVER, 'the workspace feed sums every entity');
});

test('a legacy entity with no count reads 0, not a guess', () => {
  const w = new Weave();
  const { e } = busy(w);
  delete w.state.entities[e.id].activityDropped;
  assert.equal(w.readEntity(e.id).activityDropped, 0);
  assert.equal(w.activityFeed({ entityId: e.id }).dropped, 0);
});

test('route, MCP and CLI carry the count (parity)', async () => {
  const w = new Weave();
  const { e } = busy(w);
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const ent = await (await fetch(`${base}/api/entities/${e.id}`)).json();
    assert.equal(ent.activityDropped, OVER, 'GET /api/entities/:id');
    const feed = await (await fetch(`${base}/api/activity?entity=${e.id}`)).json();
    assert.equal(feed.dropped, OVER, 'GET /api/activity');
  } finally { server.close(); }
  assert.equal(dispatchTool(w, 'weave_get_entity', { entity: e.id }).activityDropped, OVER);
  assert.equal(dispatchTool(w, 'weave_activity', { entity: e.id }).dropped, OVER);

  const dir = mkdtempSync(join(tmpdir(), 'weave-actcap-'));
  try {
    const data = join(dir, 'ws.db');
    const fw = new Weave({ path: data });
    const { e: fe } = busy(fw);
    fw.save?.();
    const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const cli = (...a) => JSON.parse(execFileSync('node', [BIN, ...a, '--data', data], { encoding: 'utf8', maxBuffer: 64 << 20 }));
    assert.equal(cli('get', fe.id).activityDropped, OVER, 'weave get');
    assert.equal(cli('activity', '--entity', fe.id).dropped, OVER, 'weave activity');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
