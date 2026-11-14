import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

const SECRET = 's3cret-value';
let service, owner;
const s = await launch('credential reveal', (weave) => {
  weave.createSpace({ name: 'Dev' });
  service = weave.createTable({ space: 'Dev', name: 'Service' });
  weave.addField(service.id, { name: 'API Key', type: 'key' });
  weave.addField(service.id, { name: 'Login', type: 'key', config: { keystore: '1password', kind: 'password' } });
  owner = weave.createAccount({ name: 'Credential owner', role: 'architect' }).account;
  weave.actor = `account:${owner.id}`;
  weave.setKey('openai-prod', SECRET);
  service.row = weave.createEntity(service.id, { name: 'OpenAI', values: { 'API Key': 'openai-prod', Login: 'acme-portal' } });
}, { weave: () => new Weave({ keystorePath: join(tempDir('weave-cred-browser-'), 'keystore.json') }) });

if (s) {
  const { base, browser, weave } = s;
  const entityPage = async (id) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.context().addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(owner.id).token, url: base }]);
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
    });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await painted(page, '.entity-grid');
    return page;
  };
  const reveals = () => {
    const vias = weave.listAudit({ limit: 200 }).filter((a) => a.action === 'key-revealed').map((a) => a.detail.via);
    return { show: vias.filter((v) => v === 'show').length, copy: vias.filter((v) => v === 'copy').length };
  };

  test('Show on a local credential reveals the secret the keystore holds, and the reveal is on the record', async () => {
    const page = await entityPage(service.row.id);
    try {
      const before = reveals();
      const actions = page.locator('.fieldrow[data-field="API Key"] .cred-actions');
      await actions.getByRole('button', { name: 'Show' }).click();
      const plain = actions.locator('.cred-plain');
      await plain.waitFor();
      assert.equal(await plain.textContent(), weave.resolveKey('openai-prod'));
      assert.equal(await plain.textContent(), SECRET);
      assert.deepEqual(reveals(), { ...before, show: before.show + 1 });
      assert.ok(!JSON.stringify(weave.listAudit()).includes(SECRET), 'the audit records the action without the secret');
    } finally { await page.close(); }
  });

  test('Copy on a local credential puts the keystore secret on the clipboard and records the reveal as a copy', async () => {
    const page = await entityPage(service.row.id);
    try {
      const before = reveals();
      await page.locator('.fieldrow[data-field="API Key"] .cred-actions').getByRole('button', { name: 'Copy' }).click();
      assert.deepEqual(await eventually(() => page.evaluate(() => window.__copied), [SECRET]), [SECRET]);
      assert.deepEqual(reveals(), { ...before, copy: before.copy + 1 });
      assert.equal(await page.locator('.fieldrow[data-field="API Key"] .cred-plain').count(), 0, 'a copy shows nothing on screen');
    } finally { await page.close(); }
  });

  test('a credential held in 1Password opens through the same link the engine builds for it, and weave reveals nothing', async () => {
    const page = await entityPage(service.row.id);
    try {
      const link = page.locator('.fieldrow[data-field="Login"] a.cred-open');
      await link.waitFor();
      assert.equal(await link.getAttribute('href'), weave.credentialLink(weave.getField(service.id, 'Login'), 'acme-portal'));
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.equal((await link.textContent()).trim(), 'Open in 1Password ↗');
      assert.equal(await page.locator('.fieldrow[data-field="Login"] .cred-actions').count(), 0, 'no Show or Copy for a secret weave never held');
    } finally { await page.close(); }
  });
}
