import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { startIdp, serveOidc } from './lib/idp.mjs';

await import('../public/prefill-core.js');
const P = globalThis.weavePrefill;

function library() {
  const w = new Weave();
  w.createSpace({ name: 'Library' });
  const saves = w.createTable({ space: 'Library', name: 'Saves' });
  const topics = w.createTable({ space: 'Library', name: 'Topics' });
  w.addField(saves, { name: 'Link', type: 'url' });
  w.addField(saves, { name: 'Source', type: 'select', config: { options: ['Squirrel', 'Manual'] } });
  w.addField(saves, { name: 'Tags', type: 'multiselect', config: { options: ['ai', 'ops', 'read'] } });
  w.addField(saves, { name: 'Score', type: 'formula', config: { expression: '1' } });
  w.addRelation(saves, { name: 'Topic', targetDb: topics, cardinality: 'many-to-one', inverseName: 'Saves' });
  const reading = w.createEntity(topics, { name: 'Reading' });
  return { w, saves, topics, reading };
}

const routeOf = (html) => html.match(/<meta name="weave-route" content="([^"]*)">/)?.[1].replaceAll('&amp;', '&') ?? null;

const plain = async (w) => {
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
  return { base, get, stop: () => server.close() };
};

test('core: values are cut to a fixed length and the query stays under the sign-in budget', () => {
  const long = 'x'.repeat(P.MAX_VALUE + 500);
  const out = P.clip([['Name', 'Hello'], ['Note', long], ['Link', 'https://a.example/?q=1&r=2']]);
  const back = new URLSearchParams(out.query);
  assert.equal(back.get('Name'), 'Hello');
  assert.equal(back.get('Note').length, P.MAX_VALUE);
  assert.equal(back.get('Link'), 'https://a.example/?q=1&r=2');
  assert.deepEqual(out.cut, ['Note']);
  const many = Array.from({ length: 40 }, (_, i) => [`F${i}`, 'y'.repeat(200)]);
  const capped = P.clip(many);
  assert.ok(capped.query.length <= P.MAX_QUERY, `${capped.query.length} over ${P.MAX_QUERY}`);
  assert.ok(capped.cut.includes('F39'), 'a field past the budget is named as cut');
  assert.ok(encodeURIComponent(`/w/some-workspace/t/${'0'.repeat(36)}/new?${capped.query}`).length < 4096, 'next fits the sign-in hop');
});

test('core: the link builder repeats a key for a list, writes true for a ticked box and drops blanks', () => {
  const link = P.link('https://weave.example/t/abc/new', { Name: 'Hi there', Tags: ['ai', 'ops'], Done: true, Off: false, Empty: '', None: null });
  const u = new URL(link);
  assert.equal(u.pathname, '/t/abc/new');
  assert.deepEqual(u.searchParams.getAll('Tags'), ['ai', 'ops']);
  assert.equal(u.searchParams.get('Name'), 'Hi there');
  assert.equal(u.searchParams.get('Done'), 'true');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['Done', 'Name', 'Tags', 'Tags']);
  assert.equal(P.link('https://weave.example/t/abc/new', {}), 'https://weave.example/t/abc/new');
});

test('routes: the prefill read resolves a select by option name and a relation by row Name, and writes nothing', async () => {
  const { w, saves, reading } = library();
  const s = await plain(w);
  try {
    const q = new URLSearchParams([['Name', 'A good read'], ['Link', 'https://x.example/a'], ['source', 'squirrel'],
      ['Tags', 'ai'], ['Tags', 'read'], ['Topic', 'reading'], ['Bogus', '1'], ['Score', '9']]);
    const res = await s.get(`/api/tables/${saves.id}/prefill?${q}`);
    assert.equal(res.status, 200);
    const draft = await res.json();
    const by = Object.fromEntries(draft.fields.map((f) => [f.field, f]));
    assert.equal(by.Name.value, 'A good read');
    assert.equal(by.Link.value, 'https://x.example/a');
    assert.equal(by.Source.value, 'Squirrel', 'option names match the way the API matches them');
    assert.deepEqual(by.Tags.value, ['ai', 'read']);
    assert.equal(by.Topic.value, 'Reading');
    assert.deepEqual(by.Topic.rows, [{ id: reading.id, name: 'Reading' }]);
    assert.deepEqual(draft.unknown, ['Bogus', 'Score'], 'an unknown or computed field is named, not set');
    assert.deepEqual(draft.fields.flatMap((f) => f.errors), []);
    assert.equal(w.listEntities(saves.id).length, 0, 'reading a draft creates no row');
  } finally { s.stop(); }
});

test('routes: a value that does not resolve is reported on its field', async () => {
  const { w, saves } = library();
  const s = await plain(w);
  try {
    const draft = await (await s.get(`/api/tables/${saves.id}/prefill?Source=Carrier%20pigeon&Topic=Nowhere`)).json();
    const by = Object.fromEntries(draft.fields.map((f) => [f.field, f]));
    assert.match(by.Source.errors[0], /'Carrier pigeon' is not an option of 'Source'/);
    assert.match(by.Topic.errors[0], /'Nowhere'/);
    assert.equal(by.Topic.value, 'Nowhere', 'the raw value stays so the person can fix it');
    assert.equal((await s.get('/api/tables/no-such-table/prefill?Name=x')).status, 404);
  } finally { s.stop(); }
});

test('routes: /t/<table>/new hands the query to the app route and creates no row', async () => {
  const { w, saves } = library();
  const s = await plain(w);
  try {
    const q = 'Name=Hello+world&Link=https%3A%2F%2Fx.example%2Fa%3Fb%3Dc&Source=Squirrel';
    const res = await s.get(`/t/${saves.id}/new?${q}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const html = await res.text();
    assert.match(html, /<script src="\/permalink\.js[^"]*"><\/script>/);
    const to = routeOf(html);
    assert.match(to, new RegExp(`^/#/table/${saves.id}/new\\?`));
    assert.deepEqual([...new URLSearchParams(to.split('?')[1])], [...new URLSearchParams(q)]);
    assert.equal(routeOf(await (await s.get(`/t/${saves.id}/new`)).text()), `/#/table/${saves.id}/new`);
    assert.equal((await s.get(`/t/00000000-0000-4000-8000-000000000000/new?Name=x`)).status, 404);
    assert.equal(w.listEntities(saves.id).length, 0, 'opening the link never creates a row');
  } finally { s.stop(); }
});

const KYLE = { sub: 'user_kyle' };

async function walled() {
  const idp = await startIdp();
  const { w, saves } = library();
  w.createAccount({ name: 'kyle', role: 'writer' });
  w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
  w.setRequireAuth(true);
  return { w, saves, ...await serveOidc(w, idp) };
}

test('routes: a signed-out prefill link keeps its whole query through sign-in and lands on the filled form', async () => {
  const s = await walled();
  try {
    const q = new URLSearchParams([['Name', 'Hello world'], ['Link', 'https://x.example/a?b=c&d=e'], ['Source', 'Squirrel']]).toString();
    const want = `/t/${s.saves.id}/new?${q}`;
    const wall = await s.call('GET', want);
    assert.equal(wall.status, 302);
    const auth = new URL(wall.headers.get('location'), s.base);
    assert.equal(auth.pathname, '/auth');
    assert.equal(auth.searchParams.get('next'), want, 'next carries the path and the full query');
    const hop = await s.call('GET', auth.pathname + auth.search);
    const start = new URL(hop.headers.get('location'), s.base);
    assert.equal(start.pathname, '/api/auth/oidc/start');
    assert.equal(start.searchParams.get('next'), want);
    const { res, cookie } = await s.signIn(KYLE, { next: start.searchParams.get('next') });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), want, 'the callback lands on the prefill link');
    const inside = await s.call('GET', want, { cookie });
    assert.equal(inside.status, 200);
    assert.equal(routeOf(await inside.text()), `/#/table/${s.saves.id}/new?${q}`);
    assert.equal(s.w.listEntities(s.saves.id).length, 0);
  } finally { s.stop(); }
});

test('routes: a signed-out link with an oversized value still fits the sign-in hop, under a workspace prefix too', async () => {
  const s = await walled();
  try {
    const ws = `/w/${s.w.state.meta.name}`;
    const wall = await s.call('GET', `${ws}/t/${s.saves.id}/new?Name=${'z'.repeat(9000)}&Source=Squirrel`);
    assert.equal(wall.status, 302);
    const loc = wall.headers.get('location');
    assert.ok(loc.length < 4096, `${loc.length} chars`);
    const next = new URL(loc, s.base).searchParams.get('next');
    assert.ok(next.startsWith(`${ws}/t/${s.saves.id}/new?`));
    const kept = new URLSearchParams(next.split('?')[1]);
    assert.equal(kept.get('Name').length, P.MAX_VALUE);
    assert.equal(kept.get('Source'), 'Squirrel');
  } finally { s.stop(); }
});
