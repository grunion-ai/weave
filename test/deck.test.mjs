import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import {
  DECK, composeDeckModel, composeSlideModel, deckRole, newSlideVersion, renderDeck,
} from '../src/deck.js';

/* Feature #118 — the slide composer. A deck is an entity whose `Slides`
   many-relation holds slide entities; each slide carries one decklet slide
   object in its `Model` document. The deck's own `Chrome` and `Style`
   documents are the deck-wide layer. Composition is a read: nothing is
   stored, so a deck is never stale with respect to its slides. */

function slideDoc(text, extra = {}) {
  return JSON.stringify({ layout: 'content', els: [{ role: 'H1', x: 60, y: 100, w: 800, text }], ...extra });
}

// A workspace with the Decks shape the composer reads, and two slides in one deck.
function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Decks' });
  const slide = w.createTable({ space: 'Decks', name: 'Slide' });
  const deck = w.createTable({ space: 'Decks', name: 'Deck' });
  w.addField(slide.id, { name: 'Model', type: 'document', config: { kind: 'code' } });
  w.addField(slide.id, { name: 'Key', type: 'text' });
  w.addField(slide.id, { name: 'Version', type: 'number' });
  w.addField(slide.id, { name: 'Customer', type: 'text' });
  w.addField(slide.id, { name: 'Layout', type: 'text' });
  w.addRelation(slide.id, { name: 'Supersedes', targetDb: slide.id, cardinality: 'many-to-one', inverseName: 'Superseded By' });
  w.addField(deck.id, { name: 'Chrome', type: 'document', config: { kind: 'code' } });
  w.addField(deck.id, { name: 'Style', type: 'document', config: { kind: 'code' } });
  w.addField(deck.id, { name: 'Order', type: 'text' });
  w.addField(deck.id, { name: 'Space', type: 'text' });
  w.addRelation(deck.id, { name: 'Slides', targetDb: slide.id, cardinality: 'many-to-many', inverseName: 'Decks' });

  const one = w.createEntity(slide.id, { values: { Name: 'Cover', Key: 'cover', Version: 1 } });
  const two = w.createEntity(slide.id, { values: { Name: 'Numbers', Key: 'numbers', Version: 1 } });
  w.setDoc(one.id, slideDoc('Hello'), 'Model');
  w.setDoc(two.id, slideDoc('1,240'), 'Model');
  const d = w.createEntity(deck.id, { values: { Name: 'Pilot deck' } });
  w.link(d.id, 'Slides', [one.id, two.id]);
  return { w, deck: d, slides: [one, two], slideTable: slide, deckTable: deck };
}

test('a table is a deck or a slide by the fields it carries', () => {
  const { w, slideTable, deckTable } = fresh();
  assert.equal(deckRole(w.getTable(deckTable.id)), 'deck');
  assert.equal(deckRole(w.getTable(slideTable.id)), 'slide');
  const other = w.createTable({ space: 'Decks', name: 'Note' });
  assert.equal(deckRole(w.getTable(other.id)), null);

  /* A many-relation named Slides that points at something with no models is
     not a deck — a customer's slide library collects slides, it does not
     present them. Only the registry-aware call can tell. */
  const customer = w.createTable({ space: 'Decks', name: 'Customer' });
  w.addRelation(customer.id, { name: 'Slides', targetDb: other.id, cardinality: 'many-to-many', inverseName: 'Customers' });
  assert.equal(deckRole(w.getTable(customer.id), w.state.tables), null);
  assert.equal(deckRole(w.getTable(deckTable.id), w.state.tables), 'deck');
});

test('a deck composes its slides, in link order, into one decklet model', () => {
  const { w, deck } = fresh();
  const { model, warnings } = composeDeckModel(w, deck.id);
  assert.deepEqual(warnings, []);
  assert.equal(model.title, 'Pilot deck');
  assert.equal(model.slides.length, 2);
  assert.deepEqual(model.slides.map((s) => s.name), ['Cover', 'Numbers']);
  assert.equal(model.slides[0].els[0].text, 'Hello');
  assert.equal(model.slides[0].layout, 'content');
});

test('the Order field re-orders and subsets the deck without unlinking anything', () => {
  const { w, deck, slides } = fresh();
  w.updateEntity(deck.id, { Order: `#${slides[1].publicId}, #${slides[0].publicId}` });
  assert.deepEqual(composeDeckModel(w, deck.id).model.slides.map((s) => s.name), ['Numbers', 'Cover']);
  w.updateEntity(deck.id, { Order: `#${slides[1].publicId}` });
  assert.deepEqual(composeDeckModel(w, deck.id).model.slides.map((s) => s.name), ['Numbers']);
});

test('Chrome is the deck-wide layer and Style is the scale the deck wears', () => {
  const { w, deck } = fresh();
  w.setDoc(deck.id, JSON.stringify({
    layouts: { content: { title: { x: 60, y: 60, w: 840, role: 'H1' } } },
    master: [{ id: 'foot', footer: 1, x: 60, y: 500, w: 300, role: 'Label', text: 'weave' }],
  }), 'Chrome');
  w.setDoc(deck.id, JSON.stringify({
    tokens: { accent: '#ff0000' },
    roles: { H1: { font: 'Georgia, serif', size: 40, weight: 700, color: 'var(--fg)', lh: 46 } },
  }), 'Style');
  const { model } = composeDeckModel(w, deck.id);
  assert.equal(model.master[0].id, 'foot');
  assert.ok(model.layouts.content, 'the layout the slides name is there');
  const { html } = renderDeck(w, deck.id);
  assert.match(html, /--accent:#ff0000/, 'style tokens reach the deck CSS');
  assert.match(html, /Georgia, serif/, 'the role scale reaches the deck model');
  assert.match(html, /^<!doctype html/i);
  assert.match(html, /Pilot deck/);
});

test('the Space field sizes the canvas', () => {
  const { w, deck } = fresh();
  assert.equal(composeDeckModel(w, deck.id).model.w, undefined, 'the model itself carries no size — create() does');
  w.updateEntity(deck.id, { Space: '1600x900' });
  const { model } = renderDeck(w, deck.id);
  assert.equal(model.w, 1600);
  assert.equal(model.h, 900);
});

test('a slide whose Model is not JSON becomes a visible error slide, not a 500', () => {
  const { w, deck, slides } = fresh();
  w.setDoc(slides[0].id, '{ this is not json', 'Model');
  const { model, warnings } = composeDeckModel(w, deck.id);
  assert.equal(model.slides.length, 2, 'the broken slide keeps its place');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Slide#\d+/);
  assert.match(JSON.stringify(model.slides[0]), /could not be read/i);
});

test('a fenced ```json block is read as the model, so the doc can be prose + code', () => {
  const { w, deck, slides } = fresh();
  w.setDoc(slides[0].id, ['Notes about this slide.', '', '```json', slideDoc('Fenced'), '```'].join('\n'), 'Model');
  assert.equal(composeDeckModel(w, deck.id).model.slides[0].els[0].text, 'Fenced');
});

test('a bare els array is a slide too', () => {
  const { w, deck, slides } = fresh();
  w.setDoc(slides[0].id, JSON.stringify([{ role: 'H1', x: 60, y: 100, w: 800, text: 'Bare' }]), 'Model');
  const s = composeDeckModel(w, deck.id).model.slides[0];
  assert.equal(s.els[0].text, 'Bare');
  assert.equal(s.name, 'Cover', 'the entity name names the slide');
});

test('the slide Layout field overrides the layout the model names', () => {
  const { w, deck, slides } = fresh();
  w.updateEntity(slides[0].id, { Layout: 'title' });
  assert.equal(composeDeckModel(w, deck.id).model.slides[0].layout, 'title');
});

test('one slide previews on its own, wearing the chrome of the deck it belongs to', () => {
  const { w, deck, slides } = fresh();
  w.setDoc(deck.id, JSON.stringify({ master: [{ id: 'foot', footer: 1, x: 60, y: 500, w: 300, role: 'Label', text: 'weave' }] }), 'Chrome');
  const { model } = composeSlideModel(w, slides[1].id);
  assert.equal(model.slides.length, 1);
  assert.equal(model.slides[0].name, 'Numbers');
  assert.equal(model.master[0].id, 'foot', 'the deck it is in lends its chrome');
  assert.equal(model.title, 'Numbers');
});

test('an empty deck composes to one placeholder slide rather than an unopenable file', () => {
  const { w, deckTable } = fresh();
  const empty = w.createEntity(deckTable.id, { values: { Name: 'Nothing yet' } });
  const { model, warnings } = composeDeckModel(w, empty.id);
  assert.equal(model.slides.length, 1);
  assert.match(warnings.join(' '), /no slides/i);
  assert.match(renderDeck(w, empty.id).html, /^<!doctype html/i);
});

test('composing refuses an entity that is neither a deck nor a slide', () => {
  const { w } = fresh();
  const note = w.createTable({ space: 'Decks', name: 'Note' });
  const n = w.createEntity(note.id, { values: { Name: 'Just a note' } });
  assert.throws(() => composeDeckModel(w, n.id), /not a deck/i);
});

test('a new version clones the slide, bumps Version and points back at what it supersedes', () => {
  const { w, slides, deck } = fresh();
  const next = newSlideVersion(w, slides[0].id);
  const read = w.readEntity(next.id);
  assert.equal(read.fields.Version, 2);
  assert.equal(read.fields.Key, 'cover');
  assert.equal(read.docs.Model, w.getDoc(slides[0].id, 'Model'), 'the model travels with the version');
  assert.equal(read.fields.Supersedes.publicId, slides[0].publicId);
  assert.deepEqual(read.fields.Decks, [], 'a new version is not in any deck until it is promoted');
  assert.deepEqual(composeDeckModel(w, deck.id).model.slides.map((s) => s.name), ['Cover', 'Numbers'],
    'decks stay pinned to the version they linked');
});

test('promoting a new version swaps it into every deck the old one was in, in place', () => {
  const { w, slides, deck } = fresh();
  const next = newSlideVersion(w, slides[0].id, { promote: true });
  w.setDoc(next.id, slideDoc('Hello v2'), 'Model');
  const model = composeDeckModel(w, deck.id).model;
  assert.deepEqual(model.slides.map((s) => s.els[0].text), ['Hello v2', '1,240'], 'the new version took the old slot');
  assert.deepEqual(w.readEntity(slides[0].id).fields.Decks, [], 'the old version left the deck');
});

test('versioning refuses a table that has no Version field', () => {
  const { w, deck } = fresh();
  assert.throws(() => newSlideVersion(w, deck.id), /slide/i);
});

test('deck routes: html, json and a version POST', async () => {
  const { w, deck, slides } = fresh();
  w.setDoc(deck.id, JSON.stringify({ layouts: { content: { title: { x: 60, y: 60, w: 840, role: 'H1' } } } }), 'Chrome');
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await fetch(`${base}/e/Deck%23${deck.publicId}/deck.html`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    assert.match(await html.text(), /Pilot deck/);

    const json = await fetch(`${base}/e/${deck.id}/deck.json`).then((r) => r.json());
    assert.equal(json.model.slides.length, 2);
    assert.deepEqual(json.warnings, []);
    assert.deepEqual(json.errors, [], 'the composed model is a valid decklet model');

    const one = await fetch(`${base}/e/${slides[0].id}/deck.html`);
    assert.equal(one.status, 200, 'a slide previews through the same route');

    const made = await fetch(`${base}/api/entities/${slides[0].id}/version`, { method: 'POST' });
    assert.equal(made.status, 201);
    assert.equal((await made.json()).fields.Version, 2);

    const nope = await fetch(`${base}/e/${deck.id}/deck.svg`);
    assert.equal(nope.status, 404);
  } finally { server.close(); }
});

test('the entity view offers the deck preview on decks and slides', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /deck\.html/, 'the entity view frames the composed deck');
  assert.match(app, /deckRoleOf/, 'and decides deck vs slide from the table shape');
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.deck-frame/, 'the frame is styled, in both themes');
});

test('the contract names the fields it reads', () => {
  assert.deepEqual(
    { ...DECK },
    { slides: 'Slides', model: 'Model', chrome: 'Chrome', style: 'Style', order: 'Order', space: 'Space', format: 'Format', layout: 'Layout', version: 'Version', key: 'Key', supersedes: 'Supersedes' },
  );
});
