import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';
import { ROOT } from './lib/source.mjs';

/* Feature #222 phase 0 — the wall, closed (gate G1), and Issue #230.

   requireAuth and the role caps used to apply to `/api/*` only, so every
   entity page, doc.html, entity.pdf and deck.html was readable by anyone who
   reached the port (Feature #194, problem 2). With requireAuth on, EVERY
   route now needs a Bearer token except the doors that carry their own
   authorization or that a sign-in page needs: /api/health, a share link,
   the passcode applet, and static CSS/JS/font/image assets.

   The route list is derived from src/routes.js itself, the way
   agent-surface.test.mjs reads it: a route added to the dispatcher is in
   this test the moment it lands, so the wall cannot be holed by a route
   nobody remembered to list. */

const SRC = readFileSync(join(ROOT, 'src/routes.js'), 'utf8');
const ID = '00000000-0000-4000-8000-000000000000';

/* Every route the dispatcher matches, concretised: literal `route === 'GET
   /api/x'`, literal `path === '/x'`, and the `path.match(/^…$/)` regexes
   with their capture groups filled. The method is the one tested on the
   same line, else GET. */
export function listRoutes(src = SRC) {
  const seen = new Map();
  const add = (method, path, line) => seen.set(`${method} ${path}`, { method, path, line });
  const concretise = (re) => re
    .replace(/^\^/, '').replace(/\$$/, '')
    .replace(/\(\?:\\\/\(\[\^\/\]\+\?\)\)\?/g, '')   // an optional /segment: leave it out
    .replace(/\(\[\^\/\]\+\??\)/g, ID)               // one path segment
    .replace(/\(\[A-Za-z0-9_-\]\+\)/g, 'nosuchtoken') // a share token
    .replace(/\(\.\+\)/g, ID)                        // the rest of the path
    .replace(/\(\\\/\.\*\|\$\)/g, '/')               // a workspace prefix tail
    .replace(/\(([a-z]+)(?:\|[a-z]+)+\)/g, '$1')     // (md|mmd|html|pdf) → md
    .replace(/\\\//g, '/').replace(/\\\./g, '.');
  for (const line of src.split('\n')) {
    const method = line.match(/rx\.method === '([A-Z]+)'/)?.[1] ?? 'GET';
    for (const [, m, p] of line.matchAll(/route === '([A-Z]+) ([^']+)'/g)) add(m, p, line);
    for (const [, p] of line.matchAll(/path === '([^']+)'/g)) add(method, p, line);
    // A regex source ends at the first `/)`: a slash inside one is always
    // escaped, or sits in a `[^/]` class where `]` follows it. Only the
    // anchored ones (`^…$`) are routes; the prefix lookups are not.
    for (const [, re] of line.matchAll(/path\.match\(\/(\^.+?\$)\/\)/g)) add(method, concretise(re), line);
  }
  return [...seen.values()];
}

const ROUTES = listRoutes();

test('the derivation sees the dispatcher', () => {
  const keys = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
  for (const k of ['GET /api/health', 'GET /api/export', 'POST /api/import', 'GET /view/nosuchtoken', 'POST /api/mcp',
    `GET /e/${ID}/doc.md`, `GET /e/${ID}/entity.md`, `GET /e/${ID}/deck.html`, `GET /e/${ID}`, `POST /api/tables/${ID}/query`]) {
    assert.ok(keys.has(k), `the route list lacks ${k}`);
  }
  assert.ok(ROUTES.length > 80, `only ${ROUTES.length} routes derived`);
  for (const r of ROUTES) assert.ok(!/[\\^$()]/.test(r.path), `${r.path} still carries regex syntax`);
});

async function serve() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const db = w.createTable({ space: 'Dev', name: 'Task' });
  const task = w.createEntity(db.id, { Name: 'One' });
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  const writer = w.createAccount({ name: 'bot', role: 'writer' }).token;
  const reader = w.createAccount({ name: 'eye', role: 'reader' }).token;
  const view = w.createView({ name: 'Board', blocks: [{ table: 'Task' }] });
  const share = w.shareView(view.id).token;
  w.setRequireAuth(true);
  const prior = process.env.WEAVE_APPLET_PASSCODE;
  process.env.WEAVE_APPLET_PASSCODE = '1234';
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, { token, body } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  const stop = () => {
    server.close();
    if (prior === undefined) delete process.env.WEAVE_APPLET_PASSCODE;
    else process.env.WEAVE_APPLET_PASSCODE = prior;
  };
  return { w, task, view, share, admin, writer, reader, call, stop };
}

/* The doors: /api/health, GET /view/<share token> (Feature #17), the passcode
   applet under /t (its own door), the static assets the sign-in page needs
   (CSS, JS, fonts and images, never .html), and door B itself (Feature #222
   part 2): the /auth page and the ceremonies under /api/auth/ — options,
   verify and logout answer an anonymous caller because they are how a caller
   stops being anonymous. /api/auth/me and the self-service session and
   credential verbs are the account's own and stay 401 to nobody. */
const OPEN = (method, path) => path === '/api/health' || path === '/auth'
  || /^\/api\/auth\/login\/(options|verify)$/.test(path) || path === '/api/auth/logout'
  || (method === 'GET' && (/^\/view\//.test(path) || path === '/t' || path.startsWith('/t/')
    || /\.(css|js|mjs|map|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico)$/i.test(path)));

test('with requireAuth on, every route the dispatcher serves refuses an anonymous caller — except the doors', async () => {
  const { w, task, share, call, stop } = await serve();
  try {
    const cases = ROUTES.map((r) => ({ ...r, path: r.path.replaceAll(ID, task.id) }));
    for (const { method, path } of cases) {
      const res = await call(method, path);
      if (OPEN(method, path)) {
        assert.notEqual(res.status, 401, `${method} ${path} is a door and must not hit the wall`);
        continue;
      }
      // Registration is a door with its own lock: an invite or a session.
      // Anonymous with neither, the ceremony refuses — not the wall.
      if (/^\/api\/auth\/register\//.test(path)) {
        assert.ok([400, 401].includes(res.status), `${path} answered ${res.status}`);
        assert.doesNotMatch((await res.json()).error, /requires authentication/, `${path} is refused by the ceremony, not the wall`);
        continue;
      }
      assert.equal(res.status, 401, `${method} ${path} answered ${res.status} to nobody`);
      if (path.startsWith('/api/')) {
        assert.equal((await res.json()).code, 'unauthorized', `${path} keeps the JSON 401`);
      } else {
        assert.match(res.headers.get('content-type'), /text\/html/, `${path} is a page and gets the HTML 401`);
        assert.match(await res.text(), /This workspace requires authentication/);
      }
    }
    // The app shell and the workspace prefix are pages too.
    const ws = `/w/${w.state.meta.name}`;
    for (const p of ['/', '/index.html', '/404.html', `${ws}/`, `${ws}/e/${task.id}/doc.html`, `${ws}/api/schema`]) {
      const res = await call('GET', p);
      assert.equal(res.status, 401, `${p} answered ${res.status} to nobody`);
    }
    // The real doors, open: the share link renders, the applet asks for its
    // passcode, the assets a sign-in page needs are served.
    assert.equal((await call('GET', `/view/${share}`)).status, 200);
    assert.equal((await call('GET', '/view/nosuchtoken')).status, 404, 'a bad share token is a miss, not a wall');
    assert.equal((await call('GET', '/t')).status, 200);
    assert.equal((await call('GET', `${ws}/api/health`)).status, 200);
    for (const p of ['/app.js', '/style.css']) assert.equal((await call('GET', p)).status, 200, `${p} is an asset the sign-in page needs`);
    // Door B: the sign-in page is served under both prefixes, and the HTML 401 links to it.
    assert.equal((await call('GET', '/auth')).status, 200);
    assert.equal((await call('GET', `${ws}/auth`)).status, 200);
    assert.match(await (await call('GET', `/e/${task.id}/doc.html`)).text(), /href="\/auth\?next=/);
    assert.match(await (await call('GET', `${ws}/e/${task.id}/doc.html`)).text(), new RegExp(`href="${ws}/auth\\?next=`));
  } finally {
    stop();
  }
});

test('a token opens the pages; a bad token is refused on a page the way it is on the API', async () => {
  const { task, admin, reader, call, stop } = await serve();
  try {
    for (const p of ['/', `/e/${task.id}/doc.html`, `/e/${task.id}/entity.md`, '/api/schema']) {
      assert.equal((await call('GET', p, { token: admin })).status, 200, `${p} with an admin token`);
      assert.equal((await call('GET', p, { token: reader })).status, 200, `${p} with a reader token`);
    }
    assert.equal((await call('GET', `/e/${task.id}`, { token: admin })).status, 302, 'the permalink redirects once inside');
    const bad = await call('GET', `/e/${task.id}/doc.html`, { token: 'wv_bogus' });
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get('content-type'), /text\/html/);
  } finally {
    stop();
  }
});

test('role caps reach the page routes: no page route mutates, and a reader is GET-only everywhere', async () => {
  // Structural: every non-API route the dispatcher serves is a read. A
  // mutating page route would need its own cap, and there is none to give.
  for (const r of ROUTES.filter((x) => !x.path.startsWith('/api/'))) {
    assert.equal(r.method, 'GET', `${r.method} ${r.path} is a page route that is not a read`);
    assert.ok(!/rx\.method === '(POST|PUT|PATCH|DELETE)'/.test(r.line), `${r.path} tests a mutating method`);
  }
  const { task, reader, writer, call, stop } = await serve();
  try {
    assert.equal((await call('GET', `/e/${task.id}/doc.md`, { token: reader })).status, 200);
    assert.equal((await call('POST', `/e/${task.id}/doc.md`, { token: reader })).status, 403, 'a reader cannot POST at a page');
    assert.equal((await call('POST', `/e/${task.id}/doc.md`, { token: writer })).status, 200, 'the doc route reads whatever the method; a writer passes the cap');
  } finally {
    stop();
  }
});

test('Issue #230 (a): an export carries no account hash and no share token, on every export surface', async () => {
  const { w, view, share, admin, reader, call, stop } = await serve();
  try {
    const surfaces = {
      engine: JSON.stringify(w.exportJSON()),
      mcp: JSON.stringify(dispatchTool(w, 'weave_export_json', {})),
      http: await (await call('GET', '/api/export', { token: reader })).text(),
    };
    for (const [name, text] of Object.entries(surfaces)) {
      assert.ok(!text.includes('tokenHash'), `${name}: an account hash left through the export`);
      assert.ok(!text.includes('shareToken'), `${name}: a share token key left through the export`);
      assert.ok(!text.includes(share), `${name}: the share token itself left through the export`);
      assert.ok(!text.includes(admin), `${name}: a raw token left through the export`);
    }
    // The redacted dump still round-trips: accounts keep their names and
    // roles but no token verifies, and the view comes back unshared until
    // someone shares it again — which mints a fresh token, not the old one.
    const far = new Weave();
    far.importJSON(JSON.parse(surfaces.http));
    assert.deepEqual(far.listAccounts().map((a) => [a.name, a.role]).sort(), [['bot', 'writer'], ['eye', 'reader'], ['root', 'admin']]);
    assert.equal(far.verifyToken(admin), null, 'a token minted on the near side does not open the far side');
    assert.equal(far.listViews().find((v) => v.id === view.id).shared, false);
    assert.equal(far.viewByShareToken(share), null);
    const minted = far.shareView(view.id).token;
    assert.notEqual(minted, share);
    assert.ok(far.state.meta.requireAuth, 'the setting itself travels');
    // A workspace with no views or accounts exports and imports as before.
    const bare = new Weave();
    bare.createSpace({ name: 'Solo' });
    new Weave().importJSON(bare.exportJSON());
  } finally {
    stop();
  }
});

test('Issue #230 (b): import is a schema write — an admin only', async () => {
  const { admin, writer, reader, call, stop } = await serve();
  try {
    const dump = await (await call('GET', '/api/export', { token: admin })).json();
    assert.equal((await call('POST', '/api/import', { token: reader, body: dump })).status, 403);
    assert.equal((await call('POST', '/api/import', { token: writer, body: dump })).status, 403, 'a writer cannot replace the workspace');
    assert.equal((await call('POST', '/api/import', { token: admin, body: dump })).status, 200);
  } finally {
    stop();
  }
});
