import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { WeaveWorkspace } from '../src/worker.js';
import { PRIVACY, TERMS } from '../src/legal.js';

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
      assert.match(html, path === '/privacy' ? /Effective date: 2026-10-08/ : /Effective date: 2026-10-02/);
      assert.ok(html.includes('[Entity name]'), `${path} lost the entity placeholder`);
      assert.ok(!html.includes('[Contact email]'), `${path} still shows the contact email slot`);
      assert.ok(!html.includes('[Address]'), `${path} still shows the address slot`);
      assert.ok(html.includes('<a href="mailto:weave@grunion.ai">weave@grunion.ai</a>'), `${path} lacks the contact mailto link`);
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

test('the legal text names the contact address, keeps the entity slot and carries no em dash', () => {
  for (const [name, md] of [['privacy', PRIVACY], ['terms', TERMS]]) {
    assert.ok(!md.includes('—'), `${name} carries an em dash`);
    assert.ok(md.includes('[Entity name]'), `${name} lost the entity placeholder`);
    for (const gone of ['[Contact email]', '[Address]']) assert.ok(!md.includes(gone), `${name} still carries ${gone}`);
    assert.ok(md.includes('weave@grunion.ai'), `${name} lacks the contact address`);
    assert.ok(!/37signals|Basecamp(?! open-source policies)/.test(md.replace(/github\.com\/basecamp\/policies/g, '')), `${name} still names the source company`);
  }
  assert.ok(PRIVACY.includes('please contact us at [weave@grunion.ai](mailto:weave@grunion.ai). If an authorized agent'), 'privacy contact sentence lost its address clause');
  for (const vendor of ['Clerk', 'Railway', 'Cloudflare']) assert.ok(PRIVACY.includes(vendor), `privacy lacks ${vendor}`);
});
