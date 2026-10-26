import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';

process.env.WEAVE_KEYSTORE = join(tempDir('weave-deck-'), 'keystore.json');
const { Weave, HTML_VIEW_POLICY } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');

const HOSTILE = '<img src=x onerror="fetch(\'/api/tables\')">';

function deckWorkspace() {
  const w = new Weave();
  w.createSpace({ name: 'Decks' });
  const slide = w.createTable({ space: 'Decks', name: 'Slide' });
  const deck = w.createTable({ space: 'Decks', name: 'Deck' });
  w.addField(slide.id, { name: 'Model', type: 'document', config: { kind: 'code' } });
  w.addRelation(deck.id, { name: 'Slides', targetDb: slide.id, cardinality: 'many-to-many', inverseName: 'Decks' });
  const one = w.createEntity(slide.id, { values: { Name: 'Cover' } });
  w.setDoc(one.id, JSON.stringify({ els: [
    { role: 'Body', x: 60, y: 100, w: 800, html: HOSTILE },
    { role: 'Body', x: 60, y: 200, w: 800, svg: `<svg><foreignObject>${HOSTILE}</foreignObject></svg>` },
  ] }), 'Model');
  const d = w.createEntity(deck.id, { values: { Name: 'Hostile deck' } });
  w.link(d.id, 'Slides', [one.id]);
  return { w, deck: d, slide: one };
}

test('deck.html answers under the HTML view sandbox, so slide markup never runs on the workspace origin', async () => {
  const { w, deck, slide } = deckWorkspace();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const id of [deck.id, slide.id]) {
      const res = await fetch(`${base}/e/${id}/deck.html`);
      assert.equal(res.status, 200);
      const csp = res.headers.get('content-security-policy') ?? '';
      assert.ok(csp.startsWith(HTML_VIEW_POLICY), `deck.html carries the HTML view policy: ${csp}`);
      assert.match(csp, /^sandbox allow-scripts/, 'the deck still runs its own player');
      assert.doesNotMatch(csp, /allow-same-origin/, 'the deck never shares the workspace origin');
      assert.match(await res.text(), /Hostile deck|Cover/, 'the deck itself still renders');
    }
  } finally { server.close(); }
});

test('the deck frame in the entity view is sandboxed like an HTML attachment frame', () => {
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const frame = app.match(/el\('iframe', \{ class: 'deck-frame'[^}]*\}/);
  assert.ok(frame, 'the deck frame is built in app.js');
  assert.match(frame[0], /sandbox: HTML_FRAME_SANDBOX/, `the deck frame carries the attachment sandbox: ${frame[0]}`);
  const sandbox = app.match(/const HTML_FRAME_SANDBOX = '([^']*)'/);
  assert.ok(sandbox, 'HTML_FRAME_SANDBOX is defined');
  assert.doesNotMatch(sandbox[1], /allow-same-origin/);
});

test('the deck download link still points at deck.html', () => {
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /deckBtn\('deck-download'[^\n]*href: deckUrl, download:/);
});
