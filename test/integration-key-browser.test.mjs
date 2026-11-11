import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';

const SECRET = 'pasted-integration-value-browser-mnop';

const s = await launch('the Integrations Credential cell is write-only: dots, the hint and Replace', (weave) => {
  weave.updateWorkspace({ name: 'links' });
  weave.markOnboarded();
  weave.createAccount({ name: 'kyle', role: 'architect' });
  const t = weave.getTable('System/Integrations');
  const row = weave.createEntity(t.id, { name: 'Fibery acme', values: { Provider: 'Fibery', Host: 'acme.fibery.io' } });
  return { tableId: t.id, rowId: row.id, session: weave.createSession('kyle').token };
}, { weave: () => new Weave({ keystorePath: join(tempDir('weave-int-ui-'), 'keystore.json') }) });

if (s) {
  const { base, browser, weave, tableId, rowId, session } = s;
  const open = async (theme) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: session, url: base }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/#/table/${tableId}?e=${rowId}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.locator('.integration-key-replace').waitFor();
    return { ctx, page };
  };

  test('the System nav lists Integrations between Users and Activity, and the Credential cell offers no Show or Copy', async () => {
    const { ctx, page } = await open('light');
    const rows = await page.locator('#sidebar .nav-system a.nav-db').evaluateAll((as) => as.map((a) => a.textContent.trim()));
    assert.deepEqual(rows.slice(rows.indexOf('Users'), rows.indexOf('Users') + 3), ['Users', 'Integrations', 'Activity']);
    const actions = await page.locator('.cred-cell button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()));
    assert.deepEqual(actions, ['Add key'], 'no key yet: Add key is the one action');
    assert.equal(await page.locator('.integration-kept').count() >= 5, true, 'the weave-kept columns read, they do not edit');
    assert.equal(await page.locator('.cred-cell input').count(), 0);
    await ctx.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`pasting a key tests it, clears the box and shows only dots and the hint (${theme})`, async () => {
      const real = globalThis.fetch;
      const sent = [];
      globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('https://acme.fibery.io/')) {
          sent.push(init.headers.Authorization);
          return new Response(JSON.stringify([{ success: true, result: [{ 'user/name': 'Acme Bot' }] }]), { status: 200 });
        }
        return real(url, init);
      };
      const { ctx, page } = await open(theme);
      try {
        await page.click('.integration-key-replace');
        const box = page.locator('#modal .integration-key-input');
        await box.waitFor();
        assert.equal(await box.getAttribute('type'), 'password');
        assert.equal(await box.getAttribute('autocomplete'), 'off');
        await box.fill(SECRET);
        await page.click('#modal button[type=submit]');
        await page.waitForFunction(() => !document.querySelector('#modal-back'));
        await page.locator('.cred-cell .integration-key', { hasText: SECRET.slice(-4) }).first().waitFor();
        assert.deepEqual(sent.at(-1), `Token ${SECRET}`, 'the server tested the pasted key against the Host');
        assert.equal((await page.locator('.cred-cell .integration-key').first().innerText()).trim(), `••••${SECRET.slice(-4)}`);
        await page.waitForFunction((want) => [...document.querySelectorAll('.integration-key')].every((c) => c.textContent.trim() === want), `••••${SECRET.slice(-4)}`);
        assert.deepEqual(await page.locator('.cred-cell button').evaluateAll((bs) => bs.map((b) => b.textContent.trim())), ['Replace']);
        const html = await page.content();
        assert.equal(html.includes(SECRET), false, 'the key is nowhere in the page');
        assert.equal(await page.evaluate((k) => [...document.querySelectorAll('input')].some((i) => i.value === k), SECRET), false);
      } finally {
        globalThis.fetch = real;
        await ctx.close();
      }
    });
  }
}
