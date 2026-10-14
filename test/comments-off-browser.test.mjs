import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table, row;
const s = await launch('comments off in the UI', (weave) => {
  weave.createSpace({ name: 'Dev' });
  table = weave.createTable({ space: 'Dev', name: 'Issue' });
  weave.addField(table, { name: 'Priority', type: 'select', config: { options: ['P1', 'P2'] } });
  row = weave.createEntity(table, { name: 'Talked about', doc: 'first draft', values: { Priority: 'P2' } });
  weave.updateEntity(row.id, { Priority: 'P1' });
  weave.addComment(row.id, { author: 'kyle', text: 'a remark the page keeps quiet' });
  weave.addComment(row.id, { author: 'automation', text: 'a rule wrote this too' });
});

if (s) {
  const { browser, base } = s;
  const QUIET = /a remark the page keeps quiet|a rule wrote this too/;
  const commentUi = (p, scope) => p.evaluate((sel) => {
    const mount = document.querySelector(sel);
    return {
      cards: [...mount.querySelectorAll('.card-title')].map((n) => n.textContent).filter((t) => /comment/i.test(t)),
      comments: mount.querySelectorAll('.comment').length,
      inputs: [...mount.querySelectorAll('input, textarea')].filter((n) => /comment/i.test(n.placeholder ?? '')).length,
      sideOpen: mount.querySelector('.entity-grid')?.classList.contains('side-open') ?? null,
      text: mount.innerText,
    };
  }, scope);
  const activity = async (p, scope) => {
    await p.click(`${scope} .activity-btn`);
    await p.waitForSelector('aside.wv-activity .wv-act-row');
    return {
      chips: await p.locator('.wv-act-filters button').allTextContents(),
      text: await p.locator('aside.wv-activity').innerText(),
      deletes: await p.locator('aside.wv-activity [title="Delete comment"], aside.wv-activity .wv-act-tray button:text-is("Delete")').count(),
      rows: await p.locator('aside.wv-activity .wv-act-row').count(),
    };
  };
  const expectQuiet = (ui, act, where) => {
    assert.deepEqual(ui.cards, [], `${where}: no Comments card`);
    assert.equal(ui.comments, 0, `${where}: no comment is drawn`);
    assert.equal(ui.inputs, 0, `${where}: no comment input`);
    assert.equal(ui.sideOpen, false, `${where}: comments alone never open the side column`);
    assert.doesNotMatch(ui.text, QUIET, `${where}: the comment text is nowhere on the record`);
    assert.equal(act.chips.includes('Comments'), false, `${where}: no Comments chip (${act.chips.join(', ')})`);
    assert.ok(act.rows > 0, `${where}: the panel still lists the field change`);
    assert.doesNotMatch(act.text, QUIET, `${where}: no comment row in the Activity panel`);
    assert.equal(act.deletes, 0, `${where}: no Delete action for a comment`);
  };

  test('a record with comments shows no comment UI on the full page (Feature #323)', async () => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await p.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await p.waitForSelector('#main .entity-grid');
      const ui = await commentUi(p, '#main');
      expectQuiet(ui, await activity(p, '#main'), 'full page');
    } finally { await p.close(); }
  });

  test('a record with comments shows no comment UI in the peek (Feature #323)', async () => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await p.goto(`${base}/#/table/${table.id}?e=${row.id}`, { waitUntil: 'networkidle' });
      await p.waitForSelector('#dock:not([hidden]) .entity-grid');
      const ui = await commentUi(p, '#dock');
      expectQuiet(ui, await activity(p, '#dock'), 'peek');
    } finally { await p.close(); }
  });

  test('the comments stay stored and served: GET /api/entities/:id returns them (Feature #323)', async () => {
    const ent = await (await fetch(`${base}/api/entities/${row.id}`)).json();
    assert.deepEqual(ent.comments.map((c) => c.text).sort(), ['a remark the page keeps quiet', 'a rule wrote this too']);
    const posted = await fetch(`${base}/api/entities/${row.id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'kyle', text: 'through the API' }),
    });
    assert.ok(posted.ok, `the comments route still takes a comment (${posted.status})`);
    const after = await (await fetch(`${base}/api/entities/${row.id}`)).json();
    assert.equal(after.comments.length, 3, 'and the record serves it');
  });
}
