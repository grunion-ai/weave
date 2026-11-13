import test from 'node:test';
import assert from 'node:assert/strict';
import * as access from '../../src/access.js';
import { Weave } from '../../src/engine.js';
import { createWorkspaceHub } from '../../src/server.js';
import { client } from '../lib/fixtures.mjs';

const { RANK, SPACE_ACCESS, ANONYMOUS, lower, higher, viewerFor, viewerOf, withViewers, unrestricted, workspaceRole, spaceRole, topRole, seatRole, grantReaches } = access;

const ROLE = { A: 'architect', E: 'editor', O: 'observer', '-': null };
const LETTER = Object.fromEntries(Object.entries(ROLE).map(([letter, role]) => [role, letter]));
const SPACES = ['Open', 'Closed', 'AsObserver', 'AsEditor', 'AsArchitect', 'AsMember', 'Gone'];
const LIVE = SPACES.filter((name) => name !== 'Gone');

const MATRIX = `
viewer                                          Open Closed AsObserver AsEditor AsArchitect AsMember Gone System workspace top
unrestricted engine                             A    A      A          A        A           A        A    A      A         A
anonymous visitor                               O    -      -          -        -           -        -    O      O         O
observer                                        O    -      O          E        A           O        -    O      O         A
editor                                          E    -      O          E        A           E        -    E      E         A
architect                                       A    A      A          A        A           A        A    A      A         A
observer, architect of a deleted space          O    -      -          -        -           -        A    O      O         O
editor token scoped to Closed                   -    E      -          -        -           -        -    O      E         E
architect token scoped to Closed                -    A      -          -        -           -        -    O      E         A
editor token scoped to Closed, observer there   -    O      -          -        -           -        -    O      E         E
issuer demoted to editor                        E    -      O          E        -           E        -    E      E         E
architect token from that issuer                E    -      O          E        -           E        -    E      E         E
token whose issuer was removed                  -    -      -          -        -           -        -    -      -         -
token scoped to Open, issuer removed            -    -      -          -        -           -        -    O      -         -
token 8 issuers deep                            A    A      A          A        A           A        A    A      A         A
token 9 issuers deep                            -    -      -          -        -           -        -    -      -         -
tokens issuing each other                       -    -      -          -        -           -        -    -      -         -
editor without a seat                           O    -      O          O        O           O        -    O      O         O
architect without a seat                        O    O      O          O        O           O        O    O      O         O
workspace read link                             O    -      -          -        -           -        -    O      -         O
edit link by the editor                         E    -      E          E        E           E        -    E      -         E
comment link by the editor over MCP             O    -      O          O        O           O        -    O      -         O
manage link by no account                       E    E      E          E        E           E        E    E      -         E
manage link by a removed account                E    -      -          -        -           -        -    E      -         E
`;

const [HEAD, ...ROWS] = MATRIX.trim().split('\n').map((line) => line.trim().split(/\s+/));
const COLUMNS = HEAD.slice(1);
const EXPECTED = ROWS.map((cells) => ({ kind: cells.slice(0, -COLUMNS.length).join(' '), letters: cells.slice(-COLUMNS.length) }));

const SEATS = {
  arc: 'architect', ed: 'architect', obs: 'architect', former: 'observer',
  'scoped ed': 'editor', 'scoped arc': 'architect', 'scoped watcher': 'editor', boss: 'editor', delegate: 'architect',
  orphan: 'architect', 'scoped orphan': 'editor', 'loop a': 'architect', 'loop b': 'architect',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`link${i}`, 'architect'])),
};

function build() {
  const w = new Weave();
  const rows = {};
  for (const name of SPACES) {
    w.createSpace({ name });
    const table = w.createTable({ space: name, name: `${name} Task` });
    rows[name] = { table: table.id, row: w.createEntity(table.id, { name: `${name} row` }).id };
  }
  const tokens = {};
  const kept = (made) => { tokens[made.account.name] = made.token; return made.account; };
  const account = (name, role, extra = {}) => kept(w.createAccount({ name, role, ...extra }));
  const issue = (issuer, name, role, extra = {}) => kept(w.asAccount(issuer, () => w.createAccount({ name, role, ...extra })));
  const arc = account('arc', 'architect');
  const ed = account('ed', 'editor');
  const obs = account('obs', 'observer');
  const former = account('former', 'observer');
  const boss = account('boss', 'architect');
  const lead = account('lead', 'architect');
  for (const name of ['arc', 'ed', 'obs', 'boss']) {
    w.setSpaceMember('AsObserver', name, { role: 'observer' });
    w.setSpaceMember('AsEditor', name, { role: 'editor' });
    if (name !== 'boss') w.setSpaceMember('AsArchitect', name, { role: 'architect' });
    w.setSpaceMember('AsMember', name);
  }
  w.setSpaceMember('Gone', 'former', { role: 'architect' });
  for (const name of SPACES.slice(1)) w.updateSpace(name, { access: 'private' });
  const scopedEd = account('scoped ed', 'editor', { space: 'Closed' });
  const scopedArc = account('scoped arc', 'architect', { space: 'Closed' });
  const watcher = account('scoped watcher', 'editor', { space: 'Closed' });
  w.setSpaceMember('Closed', 'scoped watcher', { role: 'observer' });
  const delegate = issue(boss, 'delegate', 'architect');
  w.setAccountRole('boss', 'editor');
  const orphan = issue(lead, 'orphan', 'architect');
  const scopedOrphan = issue(lead, 'scoped orphan', 'editor', { space: 'Open' });
  w.deleteAccount('lead');
  const links = [account('link8', 'architect')];
  for (let i = 7; i >= 0; i--) links.unshift(issue(links[0], `link${i}`, 'architect'));
  const deeper = issue(links[0], 'link9', 'architect');
  const loopA = account('loop a', 'architect');
  const loopB = account('loop b', 'architect');
  w.state.meta.accounts[loopA.id].issuedBy = loopB.id;
  w.state.meta.accounts[loopB.id].issuedBy = loopA.id;
  w.deleteSpace('Gone');

  const space = (name) => Object.values(w.state.spaces).find((sp) => sp.name === name);
  const system = Object.values(w.state.spaces).find((sp) => sp.system);
  const stored = (a) => w.state.meta.accounts[a.id];
  const caller = (a) => ({ viewer: viewerFor(stored(a)), token: tokens[a.name] });
  const link = (mode, createdBy, scope = { kind: 'space', id: space('Open').id }) => {
    const minted = w.mintShare({ scope, mode: 'read' });
    Object.assign(w.state.meta.shares[minted.id], { mode, createdBy });
    return { viewer: { share: w.shareByToken(minted.token) }, token: minted.token };
  };
  const shared = (mode, createdBy) => ({ ...link(mode, createdBy), perSpace: (name) => link(mode, createdBy, { kind: 'space', id: space(name).id }) });
  const kinds = {
    'unrestricted engine': { viewer: null },
    'anonymous visitor': { viewer: ANONYMOUS, token: null },
    observer: caller(obs),
    editor: caller(ed),
    architect: caller(arc),
    'observer, architect of a deleted space': caller(former),
    'editor token scoped to Closed': caller(scopedEd),
    'architect token scoped to Closed': caller(scopedArc),
    'editor token scoped to Closed, observer there': caller(watcher),
    'issuer demoted to editor': caller(boss),
    'architect token from that issuer': caller(delegate),
    'token whose issuer was removed': caller(orphan),
    'token scoped to Open, issuer removed': caller(scopedOrphan),
    'token 8 issuers deep': caller(links[0]),
    'token 9 issuers deep': caller(deeper),
    'tokens issuing each other': caller(loopA),
    'editor without a seat': { viewer: { ...viewerFor(stored(ed)), unseated: true }, token: tokens.ed, unseated: true },
    'architect without a seat': { viewer: { ...viewerFor(stored(arc)), unseated: true }, token: tokens.arc, unseated: true },
    'workspace read link': { ...link('read', null, { kind: 'workspace' }), perSpace: () => null },
    'edit link by the editor': shared('edit', `account:${ed.id}`),
    'comment link by the editor over MCP': shared('comment', `account:${ed.id} via MCP`),
    'manage link by no account': shared('manage', null),
    'manage link by a removed account': shared('manage', `account:${lead.id}`),
  };
  return { w, rows, kinds, space, system, columns: [...SPACES.map(space), system] };
}

const fixture = build();
const roleRow = ({ w, kinds, columns }, kind) => {
  const { viewer } = kinds[kind];
  return [...columns.map((sp) => spaceRole(w, viewer, sp)), workspaceRole(w, viewer), topRole(w, viewer)];
};

test('access matrix: the table spans every space the fixture builds, every viewer kind it binds, and every export access.js has', () => {
  assert.deepEqual(COLUMNS, [...SPACES, 'System', 'workspace', 'top']);
  assert.deepEqual(EXPECTED.map((row) => row.kind), Object.keys(fixture.kinds), 'one table row per viewer kind, in order');
  for (const { kind, letters } of EXPECTED) for (const letter of letters) assert.ok(Object.hasOwn(ROLE, letter), `${kind}: '${letter}' is not one of ${Object.keys(ROLE).join(' ')}`);
  assert.deepEqual(Object.keys(access).sort(), ['ANONYMOUS', 'RANK', 'SPACE_ACCESS', 'grantReaches', 'higher', 'lower', 'seatRole', 'spaceRole', 'topRole', 'unrestricted', 'viewerFor', 'viewerOf', 'withViewers', 'workspaceRole']);
  assert.deepEqual(RANK, { observer: 0, editor: 1, architect: 2 });
  assert.deepEqual(Object.keys(RANK).sort(), [...Weave.ROLES].sort());
  assert.deepEqual(SPACE_ACCESS, ['open', 'private']);
  assert.deepEqual(fixture.columns.map((sp) => [sp.name, sp.access ?? 'open', !!sp.deletedAt, !!sp.system]), [
    ['Open', 'open', false, false], ['Closed', 'private', false, false], ['AsObserver', 'private', false, false], ['AsEditor', 'private', false, false],
    ['AsArchitect', 'private', false, false], ['AsMember', 'private', false, false], ['Gone', 'private', true, false], ['System', 'open', false, true],
  ]);
});

test('access matrix: lower keeps the lesser role and null, higher keeps the greater role and drops null', () => {
  const roles = [null, 'observer', 'editor', 'architect'];
  const grid = (fn) => roles.map((a) => roles.map((b) => LETTER[fn(a, b)]).join(' '));
  assert.deepEqual(grid(lower), ['- - - -', '- O O O', '- O E E', '- O E A']);
  assert.deepEqual(grid(higher), ['- O E A', 'O O E A', 'E E E A', 'A A A A']);
});

for (const { kind, letters } of EXPECTED) {
  test(`access matrix: ${kind} holds the role the table states in each space, in the workspace and at the top`, () => {
    const got = roleRow(fixture, kind).map((role) => LETTER[role]);
    assert.deepEqual(Object.fromEntries(COLUMNS.map((c, i) => [c, got[i]])), Object.fromEntries(COLUMNS.map((c, i) => [c, letters[i]])), kind);
  });
}

test('access matrix: a seat is the account role raised by its live space roles, never by a deleted space or an issuer', () => {
  const { w } = fixture;
  assert.deepEqual(Object.fromEntries(w.listAccounts().map((a) => [a.name, a.seatRole])), SEATS);
  for (const a of Object.values(w.state.meta.accounts)) assert.equal(seatRole(w, a), SEATS[a.name], a.name);
});

test('access matrix: legacy role names admin, writer and reader read as architect, editor and observer at every site', () => {
  for (const [old, now] of [['admin', 'architect'], ['writer', 'editor'], ['reader', 'observer']]) {
    const w = { state: {
      meta: { accounts: { boss: { id: 'boss', role: old }, me: { id: 'me', role: 'reader', issuedBy: 'boss' } }, shares: {} },
      spaces: { s: { id: 's', name: 's', access: 'private', members: { me: { role: old }, boss: { role: old } } } },
    } };
    assert.equal(viewerFor({ id: 'x', role: old }).role, now, `${old}: an account role`);
    assert.equal(workspaceRole(w, { accountId: 'x', role: old }), now, `${old}: a viewer role`);
    assert.equal(spaceRole(w, { accountId: 'me', role: 'observer' }, w.state.spaces.s), now, `${old}: a space member role`);
    assert.equal(workspaceRole(w, { accountId: 'me', role: 'architect', issuedBy: 'boss' }), now, `${old}: an issuer role`);
    assert.equal(seatRole(w, { id: 'boss', role: old }), now, `${old}: a seat`);
    assert.equal(seatRole(w, { id: 'me', role: 'reader' }), now, `${old}: a seat raised by a space role`);
  }
});

test('access matrix: an id that names an Object.prototype member reaches no account, membership or stored link', () => {
  const w = { state: { meta: { accounts: {}, shares: {} }, spaces: { s: { id: 's', name: 's', access: 'private', members: {} } } } };
  const nobody = `account:${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`;
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(spaceRole(w, { accountId: id, role: 'observer' }, w.state.spaces.s), null, `${id}: a membership`);
    assert.equal(workspaceRole(w, { accountId: 'x', role: 'architect', issuedBy: id }), null, `${id}: an issuer`);
    assert.equal(grantReaches(w, { id, createdBy: nobody }, w.state.spaces.s), false, `${id}: a stored link`);
  }
});

test('access matrix: viewerFor builds the viewer from an account, and viewerOf answers what withViewers bound for each engine', () => {
  assert.equal(viewerFor(null), ANONYMOUS);
  assert.ok(Object.isFrozen(ANONYMOUS));
  assert.deepEqual(ANONYMOUS, { accountId: null, role: 'observer' });
  assert.deepEqual(viewerFor({ id: 'a', role: 'editor', space: 's', issuedBy: 'b' }), { accountId: 'a', role: 'editor', space: 's', issuedBy: 'b' });
  assert.deepEqual(viewerFor({ accountId: 'c', id: 'a' }), { accountId: 'c', role: 'observer', space: null, issuedBy: null });
  assert.deepEqual(viewerFor({ role: 'editor' }), { accountId: null, role: 'editor', space: null, issuedBy: null });
  assert.deepEqual(viewerFor({ id: 'a', role: 'architect' }, { unseated: true }), { accountId: 'a', role: 'architect', space: null, issuedBy: null, unseated: true });
  const mine = {};
  const other = {};
  const me = viewerFor({ id: 'a', role: 'editor' });
  assert.equal(viewerOf(mine), null, 'outside a request the engine runs unrestricted');
  withViewers({ of: (w) => (w === mine ? me : w === other ? null : undefined) }, () => {
    assert.equal(viewerOf(mine), me);
    assert.equal(viewerOf(other), null, 'a holder answering null leaves that engine unrestricted');
    assert.equal(viewerOf({}), ANONYMOUS, 'a holder answering undefined makes the caller anonymous');
    assert.equal(unrestricted(() => viewerOf(mine)), null);
  });
  assert.equal(withViewers({}, () => viewerOf(mine)), null, 'a holder without of() restricts nothing');
  assert.equal(spaceRole(fixture.w, me, undefined), null, 'no space, no role');
  assert.equal(spaceRole(fixture.w, null, undefined), 'architect', 'the unrestricted engine holds every space');
});

test('access matrix: a link reaches a private space only through a minter who still reaches it, read from the stored link', () => {
  const { w, kinds, space } = fixture;
  const grant = kinds['edit link by the editor'].viewer.share;
  assert.equal(grantReaches(w, grant, undefined), true, 'no space to reach');
  assert.equal(grantReaches(w, grant, space('Open')), true, 'an open space');
  assert.equal(grantReaches(w, grant, space('AsMember')), true, 'the minter is a member');
  assert.equal(grantReaches(w, grant, space('Closed')), false, 'the minter is not a member');
  assert.notEqual(grant.createdBy, w.state.meta.shares[grant.id].createdBy, 'the public link names its minter, not the account id');
  assert.equal(grantReaches(w, { ...grant, createdBy: null }, space('Closed')), false, 'the stored link outranks the one passed in');
  assert.equal(grantReaches(w, { id: 'unknown', createdBy: null }, space('Closed')), true, 'a link no account minted');
  assert.equal(grantReaches(w, { id: 'unknown', createdBy: grant.createdBy }, space('Closed')), true, 'a minter named, not an account id');
  assert.equal(grantReaches(w, { id: 'unknown', scope: { kind: 'workspace' }, createdBy: null }, space('Closed')), false, 'a workspace link');
  assert.equal(grantReaches(w, { id: 'unknown', scope: { kind: 'workspace' }, createdBy: null }, space('Open')), true);
  assert.equal(workspaceRole(w, { share: grant, accountId: null, role: 'architect' }), null, 'a link holds no workspace role, whatever role rides with it');
});

const ok = (res) => res.status >= 200 && res.status < 300;

async function ladder(call, f, token, name, tag) {
  const { table, row } = f.rows[name];
  const read = await call('GET', `/api/entities/${row}`, { token });
  const write = await call('PATCH', `/api/entities/${row}`, { token, body: { Name: `${name} row` } });
  const shape = await call('POST', `/api/tables/${table}/fields`, { token, body: { name: tag, type: 'text' } });
  return { read, write, shape };
}

const stated = (role) => ({ read: role != null, write: RANK[role] >= RANK.editor, shape: role === 'architect' });

for (const { kind, letters } of EXPECTED) {
  if (kind === 'unrestricted engine') continue;
  test(`access matrix HTTP twin: ${kind} reads, writes and shapes each live space as the table states`, async () => {
    const f = build();
    f.w.setRequireAuth(false);
    const entry = f.kinds[kind];
    const call = client(createWorkspaceHub(f.w), entry.unseated ? { billing: { standing: async () => ({ seated: () => false }) } } : {});
    for (const name of LIVE) {
      const role = ROLE[letters[COLUMNS.indexOf(name)]];
      const label = `${kind} × ${name}`;
      const door = entry.perSpace?.(name) ?? entry;
      const got = await ladder(call, f, door.token ?? undefined, name, `F ${LIVE.indexOf(name)}`);
      assert.deepEqual({ read: ok(got.read), write: ok(got.write), shape: ok(got.shape) }, stated(role), `${label}: ${got.read.status}/${got.write.status}/${got.shape.status} ${JSON.stringify([got.write.json?.error, got.shape.json?.error])}`);
      if (role == null) assert.equal(got.read.status, 404, `${label}: a space out of reach answers 404, never 403`);
    }
    if (entry.perSpace) return;
    const sysRow = Object.values(f.w.state.entities).find((e) => e.sysId === f.system.id && f.w.state.tables[e.dbId]?.system === 'spaces');
    const sys = await call('GET', `/api/entities/${sysRow.id}`, { token: entry.token ?? undefined });
    assert.equal(ok(sys), ROLE[letters[COLUMNS.indexOf('System')]] != null, `${kind} × System: ${sys.status}`);
  });
}
