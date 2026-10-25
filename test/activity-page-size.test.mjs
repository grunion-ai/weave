import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { APP, fnBodyOf } from './lib/source.mjs';

const PAGE = 500;

function busyWorkspace(events) {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  for (let i = 0; i < events; i++) w.createEntity(t.id, { name: `t${i}` });
  return { w, t };
}

test('the Activity page asks the feed for one page, never the whole log (Issue #850)', () => {
  const body = fnBodyOf('showActivity');
  assert.match(APP, /const ACTIVITY_PAGE = 500;/, 'one named page size');
  assert.match(body, /\?limit=\$\{ACTIVITY_PAGE\}/, 'the limit rides on the query string, entity or not');
  assert.match(APP, /\/activity\?entity=\$\{st\.id\}&limit=\$\{ACTIVITY_PAGE\}/, 'the record panel shares the page size');
});

test('the Activity page names the page it shows against the total', () => {
  const body = fnBodyOf('showActivity');
  assert.match(body, /feed\.items\.length < feed\.total/, 'a truncated feed says so');
  assert.match(body, /newest/, 'the note tells the reader which end of the log they have');
});

test('actor chips ask Users for the actors they draw, never for the whole table (Issue #850)', () => {
  const users = fnBodyOf('workspaceUsers');
  assert.match(users, /registryTable\('users'\)/, 'still the one read path');
  assert.doesNotMatch(users, /api\('POST', `\/tables\/\$\{t\.id\}\/query`, \{\}\)/, 'the whole-table read is gone');
  assert.match(fnBodyOf('actorChipEl'), /workspaceUsers\(\[a\.handle\]\)/, 'every chip declares the handle it needs');
  assert.match(fnBodyOf('flushUsers'), /\['Name', 'in', want\]/, 'the query names the handles the page draws');
});

test('a limited feed answers one page and still reports the full total', async () => {
  const { w } = busyWorkspace(PAGE + 40);
  const full = w.activityFeed();
  assert.ok(full.total > PAGE, `the fixture must exceed one page, got ${full.total}`);
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await (await fetch(`${base}/api/activity?limit=${PAGE}`)).json();
    assert.equal(page.items.length, PAGE, 'one page of rows');
    assert.equal(page.total, full.total, 'the total still counts every event');
    assert.deepEqual(page.items.map((a) => a.id), full.items.slice(0, PAGE).map((a) => a.id), 'the newest page, in feed order');
  } finally { server.close(); }
});

test('the Users table answers a handle list without a whole-table read', async () => {
  const w = new Weave();
  w.inviteIssuer = 'https://idp.test';
  const users = w.getTable('System/Users');
  for (let i = 0; i < 300; i++) w.createEntity(users.id, { name: `user ${i}`, values: { Email: `u${i}@example.com`, Role: 'Editor' } });
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await (await fetch(`${base}/api/tables/${users.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where: [['Name', 'in', ['user 7', 'user 200']]], limit: 2 }),
    })).json();
    assert.deepEqual(res.items.map((u) => u.name).sort(), ['user 200', 'user 7'], 'only the handles asked for');
  } finally { server.close(); }
});
