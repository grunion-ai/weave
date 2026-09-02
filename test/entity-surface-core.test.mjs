/* The one-surface pane state machine (2026-09-02). The split dock replaces
   the side peek AND the entity page: one renderer, three poses (closed,
   split, expanded), a drill chain, and a crumb that is the only way back.
   Rules pinned here before any DOM exists:
   - the anchor table never swaps on a passive drill (wrap-around rule);
   - selection follows the pane's top entity when it lives in the anchor
     table, else the chain root, else nobody;
   - re-anchoring (home tag / view-as-table) is the only deliberate swap;
   - Esc pops one level: doc → entity → split → closed;
   - history is linear with forward truncation, like a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/entity-surface-core.js');
const S = globalThis.weaveEntitySurface;

const DEALS = { tableId: 't-deals', tableName: 'Deals' };
const CONTACTS = { tableId: 't-contacts', tableName: 'Contacts' };
const COMPANIES = { tableId: 't-cos', tableName: 'Companies' };
const deal = { kind: 'entity', id: 'd1', name: 'Acme Working Capital', ...DEALS };
const deal2 = { kind: 'entity', id: 'd2', name: 'Dockside Refi', ...DEALS };
const co = { kind: 'entity', id: 'c1', name: 'Acme Corp', ...COMPANIES };
const jane = { kind: 'entity', id: 'p1', name: 'Jane Doe', ...CONTACTS };
const memo = { kind: 'doc', field: 'Memo', name: 'Memo' };

const base = () => S.init(DEALS);

test('init is a closed pane anchored to the table', () => {
  const s = base();
  assert.equal(s.pose, 'closed');
  assert.deepEqual(s.chain, []);
  assert.equal(s.anchor.tableId, 't-deals');
  assert.equal(s.filter, null);
});

test('open docks a root frame; an already-open pane keeps its pose', () => {
  let s = S.open(base(), deal);
  assert.equal(s.pose, 'split');
  assert.deepEqual(s.chain.map((f) => f.id), ['d1']);
  s = S.open(S.toggle(s), deal2); // expanded stays expanded
  assert.equal(s.pose, 'expanded');
  assert.deepEqual(s.chain.map((f) => f.id), ['d2']);
});

test('drill grows the chain; re-drilling the top frame is a no-op', () => {
  let s = S.open(base(), deal);
  s = S.drill(s, co);
  s = S.drill(s, co);
  assert.deepEqual(s.chain.map((f) => f.id), ['d1', 'c1']);
});

test('popTo truncates the chain to the clicked ancestor', () => {
  let s = S.open(base(), deal);
  s = S.drill(s, co);
  s = S.drill(s, jane);
  s = S.popTo(s, 0);
  assert.deepEqual(s.chain.map((f) => f.id), ['d1']);
});

test('the table crumb re-docks an expanded pane and closes a split one', () => {
  let s = S.toggle(S.open(base(), deal));
  s = S.drill(s, co);
  s = S.popTable(s);
  assert.equal(s.pose, 'split');
  assert.deepEqual(s.chain.map((f) => f.id), ['d1']);
  s = S.popTable(s);
  assert.equal(s.pose, 'closed');
  assert.deepEqual(s.chain, []);
});

test('toggle flips split and expanded and leaves closed alone', () => {
  assert.equal(S.toggle(base()).pose, 'closed');
  const s = S.open(base(), deal);
  assert.equal(S.toggle(s).pose, 'expanded');
  assert.equal(S.toggle(S.toggle(s)).pose, 'split');
});

test('escape pops one level: doc, then entity, then split, then closed', () => {
  let s = S.toggle(S.open(base(), deal));
  s = S.drill(s, co);
  s = S.drill(s, memo);
  s = S.escape(s); // doc off
  assert.deepEqual(s.chain.map((f) => f.id ?? f.field), ['d1', 'c1']);
  s = S.escape(s); // drill off
  assert.deepEqual(s.chain.map((f) => f.id), ['d1']);
  s = S.escape(s); // expanded re-docks
  assert.equal(s.pose, 'split');
  s = S.escape(s); // closed
  assert.equal(s.pose, 'closed');
  assert.deepEqual(s.chain, []);
});

test('selection follows the top frame in the anchor table, else the root', () => {
  let s = S.open(base(), deal);
  assert.equal(S.selectionId(s), 'd1');
  s = S.drill(s, co); // top lives elsewhere: root still selected
  assert.equal(S.selectionId(s), 'd1');
  s = S.drill(s, deal2); // wrap-around: the drilled deal takes the light
  assert.equal(S.selectionId(s), 'd2');
  assert.equal(S.selectionId(S.close(s)), null);
});

test('a doc on top never carries selection; its owner chain does', () => {
  let s = S.open(base(), deal);
  s = S.drill(s, memo);
  assert.equal(S.selectionId(s), 'd1');
});

test('crumb: terse when split at the root, full trail once drilled or expanded', () => {
  let s = S.open(base(), deal);
  assert.equal(S.crumb(s).terse, true);
  assert.equal(S.crumb(S.toggle(s)).terse, false);
  s = S.drill(s, co);
  const c = S.crumb(s);
  assert.equal(c.terse, false);
  assert.deepEqual(c.segments.map((x) => x.label), ['Deals', 'Acme Working Capital', 'Acme Corp']);
  assert.equal(c.segments[0].type, 'table');
  assert.equal(c.segments[2].last, true);
});

test('crumb home tags mark only frames living outside the anchor table', () => {
  let s = S.open(base(), deal);
  s = S.drill(s, co);
  s = S.drill(s, jane);
  const tags = S.crumb(s).segments.map((x) => x.homeTag ?? null);
  assert.deepEqual(tags, [null, null, 'Companies', 'Contacts']);
});

test('reanchor swaps the table to the frame home and resets to a split root', () => {
  let s = S.open(base(), deal);
  s = S.drill(s, jane);
  s = S.reanchor(s, 1);
  assert.equal(s.anchor.tableId, 't-contacts');
  assert.deepEqual(s.chain.map((f) => f.id), ['p1']);
  assert.equal(s.pose, 'split');
  assert.equal(s.filter, null);
});

test('viewAsTable anchors the related table with its filter, pane untouched', () => {
  let s = S.open(base(), deal);
  s = S.drill(s, co);
  s = S.viewAsTable(s, DEALS, { field: 'Company', value: 'Acme Corp' });
  assert.equal(s.anchor.tableId, 't-deals');
  assert.deepEqual(s.filter, { field: 'Company', value: 'Acme Corp' });
  assert.deepEqual(s.chain.map((f) => f.id), ['d1', 'c1']);
  assert.equal(S.clearFilter(s).filter, null);
});

test('history: back and forward walk snapshots; a new push drops the forward leg', () => {
  let h = S.hInit();
  let s = base();
  h = S.hPush(h, s);
  s = S.open(s, deal); h = S.hPush(h, s);
  s = S.drill(s, co); h = S.hPush(h, s);
  assert.equal(S.hCanBack(h), true);
  assert.equal(S.hCanFwd(h), false);
  let r = S.hBack(h); h = r.hist;
  assert.deepEqual(r.state.chain.map((f) => f.id), ['d1']);
  assert.equal(S.hCanFwd(h), true);
  r = S.hFwd(h); h = r.hist;
  assert.deepEqual(r.state.chain.map((f) => f.id), ['d1', 'c1']);
  r = S.hBack(h); h = r.hist;
  h = S.hPush(h, S.open(r.state, deal2)); // fork: forward leg is gone
  assert.equal(S.hCanFwd(h), false);
  assert.equal(S.hCanBack(h), true);
});

test('history snapshots are immune to later mutation of the live state', () => {
  let h = S.hInit();
  const s = S.open(base(), deal);
  h = S.hPush(h, s);
  s.chain.push(co); // a sloppy caller mutates in place
  const r = S.hBack(S.hPush(h, S.drill(S.open(base(), deal), jane)));
  assert.deepEqual(r.state.chain.map((f) => f.id), ['d1']);
});

/* ---------- review (2026-09-02): the edges the first cut left open ---------- */

test('a drill into a closed pane is an open: it docks split with that frame as root', () => {
  const s = S.drill(base(), deal);
  assert.equal(s.pose, 'split');
  assert.deepEqual(s.chain.map((f) => f.id), ['d1']);
  assert.equal(S.selectionId(s), 'd1');
});

test('a doc cannot be a root: open with a doc frame is a no-op, drill on a closed pane too', () => {
  const s = base();
  assert.equal(S.open(s, memo), s);
  assert.equal(S.drill(s, memo), s);
});

test('popTo on the top frame is a no-op; below the root it acts as the table segment', () => {
  let s = S.open(base(), deal);
  s = S.drill(s, co);
  assert.equal(S.popTo(s, 1), s);
  assert.equal(S.popTo(s, 5), s);
  const closed = S.popTo(s, -1);
  assert.equal(closed.pose, 'closed');
  assert.deepEqual(closed.chain, []);
  const expanded = S.toggle(s);
  const docked = S.popTo(expanded, -1);
  assert.equal(docked.pose, 'split');
  assert.deepEqual(docked.chain.map((f) => f.id), ['d1']);
});

test('escape on a closed pane stays closed; reanchor on a doc frame is a no-op', () => {
  const s = base();
  assert.equal(S.escape(s).pose, 'closed');
  let d = S.open(base(), deal);
  d = S.drill(d, memo);
  assert.equal(S.reanchor(d, 1), d);
  assert.equal(S.reanchor(d, 7), d);
});

test('viewAsTable takes only the table identity and a null filter stays null', () => {
  let s = S.open(base(), deal);
  s = S.viewAsTable(s, { ...CONTACTS, space: 'CRM', fields: [] }, null);
  assert.deepEqual(s.anchor, CONTACTS);
  assert.equal(s.filter, null);
});

test('selection after view-as-table: a root outside the new anchor lights nobody', () => {
  let s = S.open(base(), deal);
  s = S.drill(s, co);
  s = S.viewAsTable(s, CONTACTS, { field: 'Company', value: 'Acme Corp' });
  assert.equal(S.selectionId(s), null);
  s = S.drill(s, jane);
  assert.equal(S.selectionId(s), 'p1');
});

test('no transition mutates its input: every verb runs against a frozen state', () => {
  const freeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(o); };
  const s = freeze(S.drill(S.drill(S.open(base(), deal), co), memo));
  const h = freeze(S.hPush(S.hPush(S.hInit(), base()), s));
  assert.doesNotThrow(() => {
    S.open(s, deal2); S.drill(s, jane); S.popTo(s, 0); S.popTable(s); S.toggle(s); S.close(s);
    S.escape(s); S.selectionId(s); S.crumb(s); S.reanchor(s, 1);
    S.viewAsTable(s, CONTACTS, { field: 'x', value: 'y' }); S.clearFilter(s);
    S.hPush(h, s); S.hBack(h); S.hFwd(S.hBack(h).hist);
  });
  assert.deepEqual(s.chain.map((f) => f.id ?? f.field), ['d1', 'c1', 'Memo']);
});

test('history at the edges: back on the first snapshot and forward at the tip return null', () => {
  let h = S.hPush(S.hInit(), base());
  assert.equal(S.hBack(h), null);
  assert.equal(S.hFwd(h), null);
  assert.equal(S.hCanBack(S.hInit()), false);
});
