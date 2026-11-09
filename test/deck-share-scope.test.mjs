import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';

const PRIVATE = ['PRIVATE_DECK_NAME', 'PRIVATE_CHROME', 'abcdef', 'PRIVATE_SPACE', 'PRIVATE_SLIDE_NAME', 'PRIVATE_SLIDE_TEXT', 'PRIVATE_CUSTOMER'];

const RELATED_NAMES = ['PRIVATE_DECK_NAME', 'PRIVATE_SLIDE_NAME'];

const slideDoc =(text) => JSON.stringify({ layout: 'content', els: [{ role: 'H1', x: 60, y: 100, w: 800, text }] });

function fixture() {
  const w = new Weave();
  w.createSpace({ name: 'Decks' });
  const slide = w.createTable({ space: 'Decks', name: 'Slide' });
  const deck = w.createTable({ space: 'Decks', name: 'Deck' });
  w.addField(slide.id, { name: 'Model', type: 'document', config: { kind: 'code' } });
  w.addField(slide.id, { name: 'Customer', type: 'text' });
  w.addField(deck.id, { name: 'Chrome', type: 'document', config: { kind: 'code' } });
  w.addField(deck.id, { name: 'Style', type: 'document', config: { kind: 'code' } });
  w.addField(deck.id, { name: 'Space', type: 'text' });
  w.addRelation(deck.id, { name: 'Slides', targetDb: slide.id, cardinality: 'many-to-many', inverseName: 'Decks' });
  const open = w.createEntity(slide.id, { values: { Name: 'Cover', Customer: 'Shown customer' } });
  const hidden = w.createEntity(slide.id, { values: { Name: 'PRIVATE_SLIDE_NAME', Customer: 'PRIVATE_CUSTOMER' } });
  w.setDoc(open.id, slideDoc('SHOWN_SLIDE_TEXT'), 'Model');
  w.setDoc(hidden.id, slideDoc('PRIVATE_SLIDE_TEXT'), 'Model');
  const d = w.createEntity(deck.id, { values: { Name: 'PRIVATE_DECK_NAME', Space: 'PRIVATE_SPACE' } });
  w.setDoc(d.id, JSON.stringify({ master: [{ id: 'foot', footer: 1, x: 60, y: 500, w: 300, role: 'Label', text: 'PRIVATE_CHROME' }] }), 'Chrome');
  w.setDoc(d.id, JSON.stringify({ tokens: { accent: '#abcdef' } }), 'Style');
  w.link(d.id, 'Slides', [open.id, hidden.id]);
  return { w, deck: d, open, hidden };
}

const PAGES = ['entity.html', 'entity.md', 'entity.mmd', 'doc.html', 'doc/Model.html', 'doc/Model.md', 'deck.html'];

async function body(fetch, url) {
  const res = await fetch(url);
  return { status: res.status, text: await res.text() };
}

for (const kind of ['entities', 'entity']) {
  test(`a share of kind ${kind} over one slide renders none of its parent deck or sibling slide (Issue #1453)`, async () => {
    const { w, open } = fixture();
    const scope = kind === 'entities' ? { kind, ids: [open.id] } : { kind, id: open.id };
    const grant = w.mintShare({ scope });
    await withServer(w, async ({ fetch }) => {
      let deckSeen = false;
      for (const page of PAGES) {
        const { status, text } = await body(fetch, `/s/${grant.token}/e/${open.id}/${page}`);
        if (status !== 200) continue;
        const markers = kind === 'entities' || page === 'deck.html' ? PRIVATE : PRIVATE.filter((m) => !RELATED_NAMES.includes(m));
        for (const marker of markers) assert.ok(!text.includes(marker), `${page} carries ${marker}`);
        if (page === 'deck.html') {
          deckSeen = true;
          assert.ok(text.includes('SHOWN_SLIDE_TEXT'), 'the selected slide still renders');
        }
      }
      assert.ok(deckSeen, 'deck.html answers for the selected slide');
    });
  });
}

test('an entities share of a deck and one slide renders none of the unselected slide (Issue #1453)', async () => {
  const { w, deck, open, hidden } = fixture();
  const grant = w.mintShare({ scope: { kind: 'entities', ids: [deck.id, open.id] } });
  await withServer(w, async ({ fetch }) => {
    for (const id of [deck.id, open.id]) {
      for (const page of [...PAGES, 'doc/Chrome.html', 'doc/Style.html']) {
        const { status, text } = await body(fetch, `/s/${grant.token}/e/${id}/${page}`);
        if (status !== 200) continue;
        for (const marker of ['PRIVATE_SLIDE_NAME', 'PRIVATE_SLIDE_TEXT', 'PRIVATE_CUSTOMER']) {
          assert.ok(!text.includes(marker), `${id === deck.id ? 'deck' : 'slide'} ${page} carries ${marker}`);
        }
      }
    }
    const listing = await body(fetch, `/s/${grant.token}/`);
    for (const marker of ['PRIVATE_SLIDE_NAME', 'PRIVATE_SLIDE_TEXT', 'PRIVATE_CUSTOMER']) {
      assert.ok(!listing.text.includes(marker), `the share listing carries ${marker}`);
    }
    for (const page of PAGES) {
      assert.equal((await body(fetch, `/s/${grant.token}/e/${hidden.id}/${page}`)).status, 404, `the unselected slide ${page} is refused`);
    }
    const api = await body(fetch, `/s/${grant.token}/api/entities/${hidden.id}`);
    assert.equal(api.status, 404, 'the unselected slide is refused over the share API');
  });
});

test('a space share that reaches the deck keeps its chrome and style on a slide deck.html (Issue #1453)', async () => {
  const { w, open } = fixture();
  const grant = w.mintShare({ scope: { kind: 'space', id: w.getTable(open.dbId).spaceId } });
  await withServer(w, async ({ fetch }) => {
    const { status, text } = await body(fetch, `/s/${grant.token}/e/${open.id}/deck.html`);
    assert.equal(status, 200);
    assert.ok(text.includes('PRIVATE_CHROME'), 'a share that reaches the deck keeps the deck chrome on its slide');
    assert.ok(text.includes('abcdef'), 'and the deck style');
  });
});

test('a slide in two decks takes its chrome from the deck the share selects, never the first linked one (Issue #1453)', async () => {
  const { w, deck, open } = fixture();
  const shown = w.createEntity(deck.dbId, { values: { Name: 'Shown deck' } });
  w.setDoc(shown.id, JSON.stringify({ master: [{ id: 'foot', footer: 1, x: 60, y: 500, w: 300, role: 'Label', text: 'SHOWN_CHROME' }] }), 'Chrome');
  w.link(shown.id, 'Slides', [open.id]);
  const grant = w.mintShare({ scope: { kind: 'entities', ids: [shown.id, open.id] } });
  await withServer(w, async ({ fetch }) => {
    const { status, text } = await body(fetch, `/s/${grant.token}/e/${open.id}/deck.html`);
    assert.equal(status, 200);
    assert.ok(text.includes('SHOWN_CHROME'), 'the selected deck chrome frames the slide');
    for (const marker of PRIVATE) assert.ok(!text.includes(marker), `deck.html carries ${marker}`);
  });
});
