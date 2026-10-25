import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf, eventually } from './lib/browser.mjs';

let id, lone;
const s = await launch('record activity panel', (weave) => {
  weave.revisionWindowMs = 0;
  weave.createSpace({ name: 'Dev' });
  const t = weave.createTable({ space: 'Dev', name: 'Issue' });
  weave.addField(t, { name: 'Spec', type: 'document' });
  weave.addField(t, { name: 'Release note', type: 'document' });
  weave.addField(t, { name: 'Priority', type: 'select', config: { options: ['P1', 'P2'] } });
  weave.addField(t, { name: 'Link', type: 'url' });
  id = weave.createEntity(t, { name: 'Panel', doc: 'first draft', values: { Priority: 'P2' } }).id;
  weave.setDoc(id, 'first draft\n\nsecond paragraph', 'Description');
  weave.setDoc(id, 'spec one', 'Spec');
  weave.setDoc(id, 'spec two', 'Spec');
  weave.updateEntity(id, { Priority: 'P1' });
  weave.addComment(id, { author: 'kyle', text: 'looks right' });
  lone = weave.createEntity(t, { name: 'Lone', doc: 'only text' }).id;
});

if (s) {
  const { browser, base, weave } = s;
  const revs = (field) => weave.listDocRevisions(id, field).revisions;
  const doc = (field = 'Description') => weave.getDoc(id, field);
  const priority = async () => (await (await fetch(`${base}/api/entities/${id}`)).json()).fields.Priority;
  const open = async (eid = id) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${eid}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-section[data-doc-field="Description"]');
    return page;
  };
  const row = (page, rid) => page.locator(`.wv-activity .wv-act-row[data-id="${rid}"]`);
  const pick = async (page, rid) => { await row(page, rid).locator('.wv-act-what').click(); await page.waitForSelector(`.wv-act-row.sel[data-id="${rid}"]`); };
  const showDoc = async (page, field) => {
    if (!(await page.locator('.wv-activity').count())) await page.click('.activity-btn');
    await page.waitForSelector('.wv-activity .wv-act-row');
    await page.click(`.wv-act-filters button:text-is("${field}")`);
    await page.waitForSelector(`.wv-act-filters button[aria-pressed="true"]:text-is("${field}")`);
    await pick(page, await page.locator('.wv-act-row').first().getAttribute('data-id'));
  };

  test('the header clock-arrow opens one panel for the whole record; a document\'s chip filters it; no per-document button (Feature #315)', async () => {
    const page = await open();
    try {
      await page.click('.activity-btn');
      await page.waitForSelector('.wv-activity .wv-act-row');
      assert.equal(await page.locator('.activity-btn').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await page.locator('.wv-act-filters button[data-filter]').allTextContents(), ['All', 'Description', 'Spec', 'Release note', 'Fields'], 'a chip per document; no Comments chip (Feature #323)');
      assert.equal(await page.locator('.wv-act-head').textContent(), 'Panel›Activity', 'the record crumb, a title and a close button: no counts, no subtitle (Issue #979)');
      const strip = await page.locator('.wv-act-filters').evaluate((f) => {
        const shown = [...f.children].filter((b) => !b.hidden);
        const edge = f.getBoundingClientRect().right;
        return { lines: new Set(shown.map((b) => Math.round(b.getBoundingClientRect().top))).size, clipped: shown.filter((b) => b.getBoundingClientRect().right > edge + 0.5).length };
      });
      assert.deepEqual(strip, { lines: 1, clipped: 0 }, 'the filter chips sit on one line and none is cut (Issue #907)');
      for (const rid of [`r${revs('Description')[0].seq}`, `r${revs('Spec')[0].seq}`]) assert.equal(await row(page, rid).count(), 1, `${rid} listed`);
      assert.match(await page.locator('.wv-activity').textContent(), /Priority/, 'field changes are in the panel');
      assert.doesNotMatch(await page.locator('.wv-activity').textContent(), /looks right/, 'comments stay out of the panel until their redesign (Feature #323)');
      assert.equal(await page.locator('.wv-act-day').first().textContent(), 'Today');
      assert.ok(await page.locator('.wv-act-row .wv-act-who .k-actor .k-label').count() > 0, 'the actor is drawn as a chip (Feature #265)');

      await page.click('.wv-act-filters button:text-is("Spec")');
      await page.waitForSelector('.wv-act-filters button[aria-pressed="true"]:text-is("Spec")');
      const ids = await page.locator('.wv-act-row').evaluateAll((rs) => rs.map((r) => r.dataset.id));
      assert.deepEqual(ids, revs('Spec').map((r) => `r${r.seq}`), 'Spec\'s chip shows Spec\'s versions only');
      assert.equal(await page.locator('.doc-history-btn').count(), 0, 'no document carries its own History button');
      await page.click('.activity-btn');
      await page.waitForSelector('.wv-activity', { state: 'detached' });
      assert.equal(await page.locator('.activity-btn').getAttribute('aria-pressed'), 'false');
    } finally { await page.close(); }
  });

  test('a revision shows its diff in place of its document; Restore writes it back; Undo steps back only that', async () => {
    const page = await open();
    try {
      await showDoc(page, 'Description');
      await page.waitForSelector('.wv-act-row.sel');
      const sec = page.locator('.doc-section[data-doc-field="Description"]');
      await sec.locator('.wv-act-view .wv-act-diff').waitFor();
      assert.match(await sec.locator('.wv-act-diff ins').first().textContent(), /second paragraph/, 'the current version, diffed against the one before');
      assert.equal(await sec.locator(':scope > .doc-section-body').isHidden(), true, 'the editor steps aside while a change is shown');
      assert.equal(await sec.locator('.wv-act-view [contenteditable="true"]').count(), 0, 'read-only');

      const oldest = revs('Description').at(-1);
      await pick(page, `r${oldest.seq}`);
      assert.equal(await page.locator('.wv-act-row.sel > .wv-act-icon').count(), 0, 'the selected row\'s action is its tray button, not a second icon');
      await page.click('.wv-act-row.sel .wv-act-tray .btn-primary');
      assert.equal(await eventually(() => doc(), 'first draft'), 'first draft');
      const entry = weave.getEntity(id).activity.filter((a) => a.kind === 'doc-updated').at(-1);
      assert.equal(entry.detail.restoredFrom, oldest.seq, 'the restore is its own entry naming what it restored');
      await page.waitForSelector('.wv-act-row.sel .wv-act-src:has-text("restored from")');
      assert.equal(revs('Description')[0].restoredFrom, oldest.seq, 'the new revision names the revision it restored (Issue #588)');
      const label = await page.locator('.wv-act-row.sel .wv-act-what').textContent();
      assert.match(label, /restored\s*from/i, `the restore row names the version it came from (${label})`);
      assert.match(await page.locator('.wv-act-row.sel .wv-act-src').getAttribute('title'), new RegExp(String(new Date(oldest.at).getFullYear())), 'its title dates that version');
      await page.locator('.wv-toast .wv-toast-action', { hasText: 'Undo' }).last().click();
      assert.equal(await eventually(() => doc(), 'first draft\n\nsecond paragraph'), 'first draft\n\nsecond paragraph', 'Undo brings the replaced text back');
      assert.match(weave.getDocRevision(id, null, revs('Description')[1].seq).text, /^first draft$/, 'nothing left the log');
    } finally { await page.close(); }
  });

  test('the restore reads as one on the Activity page too (Issue #588)', async () => {
    const entry = weave.activityFeed({ entityId: id }).items.find((a) => a.kind === 'doc-updated' && a.detail.restoredFrom != null);
    assert.ok(entry, 'the test before left a restore entry');
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${base}/#/activity/${id}`, { waitUntil: 'networkidle' });
      const text = await page.locator(`.activity-row[data-href="#/activity/${entry.id}"]`).textContent();
      assert.match(text, /Description restored to the version from/, `the entry reads as a restore (${text})`);
      assert.doesNotMatch(text, /Description edited/);
    } finally { await page.close(); }
  });

  test('Undo refuses once something else was written since', async () => {
    const page = await open();
    try {
      await showDoc(page, 'Description');
      await pick(page, `r${revs('Description').at(-1).seq}`);
      await page.click('.wv-act-row.sel .wv-act-tray .btn-primary');
      assert.equal(await eventually(() => doc(), 'first draft'), 'first draft');
      await page.locator('.wv-toast .wv-toast-action', { hasText: 'Undo' }).last().waitFor();
      weave.setDoc(id, 'someone else wrote', 'Spec');
      await page.locator('.wv-toast .wv-toast-action', { hasText: 'Undo' }).last().click();
      await page.waitForSelector('.wv-toast.err');
      assert.equal(doc(), 'first draft', 'the restore stands: Undo would have stepped back the other write');
      assert.equal(doc('Spec'), 'someone else wrote');
    } finally {
      await page.close();
      weave.setDoc(id, 'first draft\n\nsecond paragraph', 'Description');
      weave.setDoc(id, 'spec two', 'Spec');
    }
  });

  test('restoring the version the document already holds writes nothing and offers no Undo', async () => {
    weave.setDoc(lone, 'other text');
    weave.setDoc(lone, 'only text');
    const before = weave.listDocRevisions(lone).revisions;
    const page = await open(lone);
    try {
      await showDoc(page, 'Description');
      await pick(page, `r${before.at(-1).seq}`);
      await page.click('.wv-act-row.sel .wv-act-tray .btn-primary');
      const t = page.locator('.wv-toast', { hasText: 'already reads as the version from' });
      await t.waitFor();
      assert.equal(await t.locator('.wv-toast-action').count(), 0, 'nothing to undo');
      assert.equal(weave.listDocRevisions(lone).revisions.length, before.length, 'no revision was written');
    } finally { await page.close(); }
  });

  test('a field change sits as a card on top, reverts from its row, and comes back with Undo', async () => {
    const page = await open();
    try {
      await page.click('.activity-btn');
      const change = weave.activityFeed({ entityId: id }).items.find((a) => a.kind === 'field-updated' && a.detail.field === 'Priority');
      await pick(page, `a${change.seq}`);
      await page.waitForSelector('.wv-act-view.top .wv-act-card');
      assert.match(await page.locator('.wv-act-card').textContent(), /Priority\s*P2\s*P1/);
      assert.equal((await page.locator('.wv-act-row.sel .btn-primary').textContent()).trim(), 'Revert to P2');
      await page.click('.wv-act-row.sel .btn-primary');
      assert.equal(await eventually(priority, 'P2'), 'P2');
      await page.locator('.wv-toast .wv-toast-action', { hasText: 'Undo' }).last().click();
      assert.equal(await eventually(priority, 'P1'), 'P1', 'Undo puts the value back');
      await page.waitForSelector('.wv-act-row.undone');
    } finally { await page.close(); }
  });

  test('a change from an empty value offers Clear value, never Revert to null (Issue #908)', async () => {
    weave.updateEntity(lone, { Priority: 'P1' });
    const change = weave.activityFeed({ entityId: lone }).items.find((a) => a.kind === 'field-updated' && a.detail.field === 'Priority');
    assert.equal(change.detail.from, null, 'the change starts from an empty value');
    const page = await open(lone);
    try {
      await page.click('.activity-btn');
      await page.waitForSelector(`.wv-act-row[data-id="a${change.seq}"]`);
      const r = row(page, `a${change.seq}`);
      if (await r.evaluate((n) => n.classList.contains('sel'))) await pick(page, await page.locator('.wv-act-row').last().getAttribute('data-id'));
      assert.equal(await r.locator(':scope > .wv-act-icon').getAttribute('title'), 'Clear value', 'the row icon names the action');
      await pick(page, `a${change.seq}`);
      assert.equal((await page.locator('.wv-act-row.sel .btn-primary').textContent()).trim(), 'Clear value');
      assert.equal((await page.locator('.wv-act-row.sel .wv-act-val').first().textContent()).trim(), '—', 'the empty value reads as a dash beside the button');
      assert.doesNotMatch(await page.locator('.wv-activity').textContent(), /null/);
      await page.click('.wv-act-row.sel .btn-primary');
      assert.equal(await eventually(async () => (await (await fetch(`${base}/api/entities/${lone}`)).json()).fields.Priority, null), null, 'Clear value empties the field');
    } finally { await page.close(); }
  });

  test('a long value wraps inside the panel, and chips that do not fit a 300px context pane wait under More (Issue #907, Feature #348)', async () => {
    const url = 'https://adriany.fibery.io/Task_Management/Task/a-path-that-keeps-going-past-the-panel-edge-1234';
    weave.updateEntity(lone, { Link: url });
    const page = await open(lone);
    try {
      await page.evaluate(() => localStorage.setItem('wv-side-width', '300'));
      await page.click('.activity-btn');
      const r = page.locator('.wv-activity .wv-act-row').filter({ has: page.locator('.name', { hasText: /^Link$/ }) }).first();
      await r.waitFor();
      const fit = await r.evaluate((n) => {
        const list = n.closest('.wv-act-list'), lr = list.getBoundingClientRect();
        const val = [...n.querySelectorAll('.wv-act-val')].find((v) => v.textContent.startsWith('https://'));
        const vr = val.getBoundingClientRect();
        return { text: val.textContent, inside: vr.left >= lr.left - 0.5 && vr.right <= lr.right + 0.5, overflowX: list.scrollWidth - list.clientWidth, lines: Math.round(vr.height / parseFloat(getComputedStyle(val).lineHeight)) };
      });
      assert.equal(fit.text, url, 'the whole value is in the row');
      assert.ok(fit.inside, 'the value stays inside the list');
      assert.ok(fit.overflowX <= 0, 'the list never scrolls sideways');
      assert.ok(fit.lines > 1, 'the long value wraps onto more lines');
      const more = page.locator('.wv-act-filters .wv-act-more');
      assert.equal(await more.isVisible(), true, 'More shows once the chips run out of room');
      const hidden = await page.locator('.wv-act-filters button[data-filter][hidden]').allTextContents();
      assert.ok(hidden.length > 0, 'at least one document chip waits under More');
      await more.click();
      await page.waitForSelector('.wv-menu');
      assert.deepEqual(await page.locator('.wv-menu .wv-menu-label').allTextContents(), hidden, 'More lists exactly the chips the strip left out');
      await page.locator('.wv-menu .wv-menu-label', { hasText: hidden[0] }).click();
      await page.waitForSelector(`.wv-act-filters button[aria-pressed="true"]:text-is("${hidden[0]}")`);
      assert.equal(await page.locator(`.wv-act-filters button[aria-pressed="true"]`).isVisible(), true, 'the chosen chip takes a place on the strip');
    } finally { await page.close(); }
  });

  test('two documents stay apart: Spec compares and restores within Spec; Description is untouched', async () => {
    const page = await open();
    try {
      await showDoc(page, 'Spec');
      await page.waitForSelector('.wv-act-row.sel');
      await page.click('.wv-act-row.sel .wv-act-cmp .picker-face');
      await page.waitForSelector('.picker-pop .picker-list');
      const options = await page.locator('.picker-pop .picker-list > *').count();
      assert.equal(options, revs('Spec').length - 1, 'the picker lists Spec\'s other versions only');
      await page.keyboard.press('Escape');
      const before = doc();
      const oldest = revs('Spec').at(-1);
      await pick(page, `r${oldest.seq}`);
      await page.click('.wv-act-row.sel .wv-act-tray .btn-primary');
      assert.equal(await eventually(() => doc('Spec'), 'spec one'), 'spec one');
      assert.equal(doc(), before, 'Description is as it was');
      await page.locator('.doc-section[data-doc-field="Spec"] .wv-act-view').waitFor();
      assert.equal(await page.locator('.doc-section[data-doc-field="Description"] .wv-act-view').count(), 0, 'only Spec shows a diff');
    } finally { await page.close(); }
  });

  test('in a docked record the Activity button opens the context pane right of the dock, and Escape closes the pane, not the dock (Feature #296, Feature #348)', async () => {
    const page = await open();
    try {
      await page.click('#main button[title="Collapse (⌘⇧E)"]');
      await page.waitForSelector('#dock:not([hidden]) .crumb-actions .activity-btn');
      await page.click('#dock .crumb-actions .activity-btn');
      await page.waitForSelector('.wv-activity .wv-act-row');
      const [panel, dock] = await Promise.all(['.wv-activity', '#dock'].map((sel) => page.locator(sel).evaluate((n) => n.getBoundingClientRect().toJSON())));
      assert.ok(panel.left >= dock.right, `the pane sits right of the dock (${panel.left} >= ${dock.right})`);
      assert.equal(await page.locator('#side > .wv-activity').count(), 1, 'in the context pane');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.wv-activity', { state: 'detached' });
      assert.equal(await page.locator('#dock').isVisible(), true, 'the dock stays open');
    } finally { await page.close(); }
  });

  test('a row\'s action shows on hover; the panel paints in both themes; Escape closes', async () => {
    const page = await open();
    try {
      await page.click('.activity-btn');
      await page.waitForSelector('.wv-act-row:not(.sel) > .wv-act-icon');
      const r = page.locator('.wv-act-row:not(.sel):has(> .wv-act-icon)').first();
      assert.equal(await styleOf(r.locator('> .wv-act-icon'), 'opacity', '0'), '0', 'hidden at rest');
      await r.hover();
      assert.equal(await styleOf(r.locator('> .wv-act-icon'), 'opacity', '1'), '1', 'revealed on hover');

      const paint = async (theme) => {
        await page.evaluate((want) => {
          for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== want; i++) cycleTheme();
        }, theme);
        return page.locator('.wv-activity').evaluate((n) => ({ bg: getComputedStyle(n).backgroundColor, text: getComputedStyle(n.querySelector('.wv-act-row')).color }));
      };
      const light = await paint('light');
      const dark = await paint('dark');
      for (const c of [light, dark]) assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(c.bg), `the panel paints a surface (${JSON.stringify(c)})`);
      assert.notEqual(light.bg, dark.bg, 'the surface follows the theme');
      assert.notEqual(light.text, dark.text, 'the text follows the theme');

      await page.keyboard.press('Escape');
      await page.waitForSelector('.wv-activity', { state: 'detached' });
      assert.equal(await page.locator('.doc-section .wv-act-view').count(), 0, 'Escape returns every document to its editor');
    } finally { await page.close(); }
  });
}
