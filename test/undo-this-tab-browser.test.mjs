import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let tasks, alpha, beta;
const s = await launch('cmd-z undoes only the writes this tab made', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  weave.addField(tasks, { name: 'Owner', type: 'text' });
  alpha = weave.createEntity(tasks, { name: 'Alpha', values: { Note: 'a0', Owner: 'o0' } });
  beta = weave.createEntity(tasks, { name: 'Beta', values: { Note: 'b0', Owner: 'p0' } });
});

if (s) {
  const { base, browser, weave } = s;
  const stored = (id, f) => weave.readEntity(id).fields[f];
  const cell = (id, f) => `tr[data-eid="${id}"] td[data-field="${f}"]`;
  const reset = () => {
    weave.updateEntity(alpha.id, { Note: 'a0', Owner: 'o0' });
    weave.updateEntity(beta.id, { Note: 'b0', Owner: 'p0' });
  };

  async function tab(theme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme });
    page.undoCalls = [];
    page.on('request', (r) => {
      if (!new URL(r.url()).pathname.endsWith('/api/undo')) return;
      page.undoCalls.push(r.method() === 'POST' ? { POST: JSON.parse(r.postData() || '{}') } : { [r.method()]: new URL(r.url()).search });
    });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${cell(alpha.id, 'Note')} .text-dressed`);
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-bs-theme', t);
      window.__said = [];
      const shown = window.toast;
      window.toast = (msg, ...rest) => { window.__said.push(String(msg)); return shown(msg, ...rest); };
    }, theme);
    return page;
  }
  const posts = (page) => page.undoCalls.filter((c) => c.POST).map((c) => c.POST);
  async function refusalShows(page) {
    const note = page.locator('#wv-toasts .wv-toast.err', { hasText: 'Changed since, so nothing was undone' }).last();
    assert.ok(await note.isVisible(), 'the refusal is on screen as an error toast');
    const [ink, ground] = await note.evaluate((n) => [getComputedStyle(n.querySelector('.wv-toast-msg')).color, getComputedStyle(n).backgroundColor]);
    assert.notEqual(ink, ground, `the refusal reads against its toast (${ink} on ${ground})`);
  }

  async function edit(page, id, f, text) {
    await page.click(`${cell(id, f)} .text-dressed`);
    await page.fill(`${cell(id, f)} input`, text);
    await page.keyboard.press('Tab');
    assert.equal(await eventually(() => stored(id, f), text), text, `${f} saved as ${text}`);
  }
  async function said(page, run) {
    const before = await page.evaluate(() => window.__said.length);
    await run();
    await page.waitForFunction((n) => window.__said.length > n, before);
    return page.evaluate(() => window.__said.at(-1));
  }
  const undo = (page) => said(page, () => page.keyboard.press('ControlOrMeta+z'));

  test('two tabs edit two rows: cmd-z in A waits while B wrote last, then each tab undoes only its own write (Issue #1692)', async () => {
    reset();
    const a = await tab('dark'), b = await tab();
    try {
      await edit(a, alpha.id, 'Note', 'from A');
      await edit(b, beta.id, 'Note', 'from B');

      assert.equal(await undo(a), 'Changed since, so nothing was undone', 'A refuses while B holds the newest write');
      await refusalShows(a);
      assert.deepEqual(posts(a), [], 'and no undo request left tab A');
      assert.equal(stored(beta.id, 'Note'), 'from B', 'B\'s write stands');
      assert.equal(stored(alpha.id, 'Note'), 'from A', 'and so does A\'s');

      assert.equal(await undo(b), 'Undone: Beta');
      assert.deepEqual(posts(b), [{ steps: 1 }], 'B undid one step: its own');
      assert.equal(stored(beta.id, 'Note'), 'b0');
      assert.equal(stored(alpha.id, 'Note'), 'from A', 'B never touched A\'s write');

      assert.equal(await undo(a), 'Undone: Alpha', 'with B\'s write gone, A\'s own write is on top');
      assert.deepEqual(posts(a), [{ steps: 1 }]);
      assert.equal(stored(alpha.id, 'Note'), 'a0');
      assert.equal(stored(beta.id, 'Note'), 'b0');
    } finally { await a.close(); await b.close(); }
  });

  test('two tabs edit the same row: A\'s cmd-z never reverts B\'s later edit of that row (Issue #1692)', async () => {
    reset();
    const a = await tab();
    let b;
    try {
      await edit(a, alpha.id, 'Note', 'note by A');
      b = await tab('dark');
      await edit(b, alpha.id, 'Owner', 'owner by B');

      assert.equal(await undo(a), 'Changed since, so nothing was undone');
      await refusalShows(a);
      assert.deepEqual(posts(a), [], 'the newest entry names A\'s row, but B wrote it, so nothing is sent');
      assert.equal(stored(alpha.id, 'Owner'), 'owner by B');
      assert.equal(stored(alpha.id, 'Note'), 'note by A');

      assert.equal(await undo(b), 'Undone: Alpha');
      assert.equal(stored(alpha.id, 'Owner'), 'o0');
      assert.equal(stored(alpha.id, 'Note'), 'note by A', 'B\'s undo left A\'s edit alone');

      assert.equal(await undo(a), 'Undone: Alpha');
      assert.deepEqual(posts(a), [{ steps: 1 }]);
      assert.equal(stored(alpha.id, 'Note'), 'a0');
    } finally { await a.close(); await b?.close(); }
  });

  test('a tab with no writes of its own sends no undo at all, whoever wrote last (Issue #1692)', async () => {
    reset();
    const a = await tab(), c = await tab();
    try {
      await edit(a, alpha.id, 'Note', 'kept');
      weave.updateEntity(beta.id, { Owner: 'written by an agent' });
      assert.equal(await undo(c), 'Nothing to undo');
      assert.equal(await undo(c), 'Nothing to undo', 'a second press is still nothing');
      assert.deepEqual(c.undoCalls, [], 'tab C sent no undo request, not even a step-count probe');
      assert.equal(stored(alpha.id, 'Note'), 'kept');
      assert.equal(stored(beta.id, 'Owner'), 'written by an agent');
    } finally { await a.close(); await c.close(); }
  });

  test('a paste undoes as one gesture of its own rows, and its Undo refuses once another tab wrote (Issue #1692)', async () => {
    reset();
    const a = await tab();
    let b;
    try {
      const paste = async (text) => {
        await a.locator(`${cell(alpha.id, 'Note')}`).focus();
        const msg = await said(a, () => a.evaluate(([sel, t]) => {
          const data = new DataTransfer();
          data.setData('text/plain', t);
          document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, [cell(alpha.id, 'Note'), text]));
        return msg;
      };

      assert.match(await paste('p1\np2'), /^Pasted/);
      assert.equal(stored(alpha.id, 'Note'), 'p1');
      assert.equal(stored(beta.id, 'Note'), 'p2');
      assert.equal(await undo(a), 'Undone: Beta and 1 more');
      assert.deepEqual(posts(a), [{ steps: 2 }], 'one cmd-z steps back both pasted rows');
      assert.equal(stored(alpha.id, 'Note'), 'a0');
      assert.equal(stored(beta.id, 'Note'), 'b0');

      assert.match(await paste('q1\nq2'), /^Pasted/);
      b = await tab();
      await edit(b, beta.id, 'Owner', 'after the paste');
      const action = a.locator('#wv-toasts .wv-toast', { hasText: 'Pasted' }).last().locator('.wv-toast-action');
      assert.equal(await said(a, () => action.click()), 'Changed since, so nothing was undone');
      await refusalShows(a);
      assert.deepEqual(posts(a), [{ steps: 2 }], 'the paste\'s Undo sent nothing once B wrote after it');
      assert.equal(stored(beta.id, 'Owner'), 'after the paste');
      assert.equal(stored(alpha.id, 'Note'), 'q1');
    } finally { await a.close(); await b?.close(); }
  });
}
