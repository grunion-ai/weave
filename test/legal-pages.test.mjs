import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { WeaveWorkspace } from '../src/worker.js';
import { PRIVACY, TERMS } from '../src/legal.js';

/* Feature #251. The Google sign-in consent screen needs a privacy policy and
   a terms of service URL that anyone can open, so /privacy and /terms answer
   ahead of the wall on both adapters while every other route stays shut. */

const ATTRIBUTION = /Adapted from the Basecamp open-source policies.*github\.com\/basecamp\/policies.*CC BY 4\.0/s;
const PAGES = [['/privacy', 'Privacy policy'], ['/terms', 'Terms of Service']];

async function walled() {
  const w = new Weave();
  w.createAccount({ name: 'root', role: 'admin' });
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: () => server.close() };
}

test('with requireAuth on, an anonymous visitor reads /privacy and /terms', async () => {
  const { base, stop } = await walled();
  try {
    for (const [path, heading] of PAGES) {
      const res = await fetch(base + path, { redirect: 'manual' });
      assert.equal(res.status, 200, `${path} answered ${res.status} to nobody`);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.match(html, new RegExp(`<h1>${heading}</h1>`), `${path} lacks its heading`);
      assert.match(html, new RegExp(`<title>${heading}`), `${path} lacks its title`);
      assert.match(html, ATTRIBUTION, `${path} lacks the CC BY attribution`);
      assert.match(html, /Effective date: 2026-10-02/);
      assert.ok(html.includes('[Entity name]'), `${path} lost the entity placeholder`);
    }
  } finally { stop(); }
});

test('the legal pages open no other door: anonymous API calls and pages stay 401', async () => {
  const { base, stop } = await walled();
  try {
    const api = await fetch(base + '/api/tables');
    assert.equal(api.status, 401);
    assert.equal((await api.json()).code, 'unauthorized');
    assert.equal((await fetch(base + '/', { redirect: 'manual' })).status, 401);
    assert.equal((await fetch(base + '/privacy.md', { redirect: 'manual' })).status, 401);
    assert.equal((await fetch(base + '/privacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  } finally { stop(); }
});

test('the sign-in page links Privacy and Terms', async () => {
  const { base, stop } = await walled();
  try {
    const html = await (await fetch(base + '/auth')).text();
    assert.match(html, /<a href="\/privacy">Privacy<\/a>/);
    assert.match(html, /<a href="\/terms">Terms<\/a>/);
  } finally { stop(); }
});

test('the Worker serves the same pages through the shared dispatcher', async () => {
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: {
      exec(query, ...params) {
        if (params.length === 0 && !/^\s*SELECT/i.test(query)) db.exec(query);
        const stmt = db.prepare(query);
        if (/^\s*SELECT/i.test(query)) return { toArray: () => stmt.all(...params) };
        stmt.run(...params);
      },
    },
    transactionSync(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
    },
  };
  const dobj = new WeaveWorkspace({ storage }, { WEAVE_VERSION: '0.0.0-test' });
  for (const [path, heading] of PAGES) {
    const res = await dobj.fetch(new Request(`http://do${path}`, { headers: { 'x-weave-workspace': 'scratch' } }));
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, new RegExp(`<h1>${heading}</h1>`));
    assert.match(html, ATTRIBUTION);
  }
});

test('the legal text keeps its placeholders and carries no em dash', () => {
  for (const [name, md] of [['privacy', PRIVACY], ['terms', TERMS]]) {
    assert.ok(!md.includes('—'), `${name} carries an em dash`);
    for (const p of ['[Entity name]', '[Contact email]']) assert.ok(md.includes(p), `${name} lacks ${p}`);
    assert.ok(!/37signals|Basecamp(?! open-source policies)/.test(md.replace(/github\.com\/basecamp\/policies/g, '')), `${name} still names the source company`);
  }
  assert.ok(PRIVACY.includes('[Address]'));
  for (const vendor of ['Clerk', 'Railway', 'Cloudflare']) assert.ok(PRIVACY.includes(vendor), `privacy lacks ${vendor}`);
});
