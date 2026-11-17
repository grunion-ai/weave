import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('the Users new-row form and the token dialog name the workspace', (weave) => {
  weave.updateWorkspace({ name: 'net' });
  weave.markOnboarded();
  return { usersId: weave.listTables().find((t) => t.system === 'users').id };
});

if (s) {
  const { base, browser, usersId } = s;
  const openForm = async (page, theme) => {
    await page.goto(`${base}/#/table/${usersId}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.locator('.wv-grid').waitFor();
    await page.keyboard.press('Shift+Enter');
    await page.locator('#modal h2', { hasText: 'New user' }).waitFor();
  };

  for (const theme of ['light', 'dark']) {
    test(`the new-user form shows the workspace the account will belong to (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await openForm(page, theme);
      const face = page.locator('#modal .wv-user-workspace .picker-face');
      assert.equal((await face.innerText()).trim(), 'net', 'the field is filled with the default workspace');
      assert.equal(await page.locator('#modal input[name=workspace]').inputValue(), 'net');
      assert.match(await page.locator('#modal .wv-user-workspace-hint').textContent(), /cannot move/);
      await page.close();
    });
  }

  test('the one-time token dialog names the role and the workspace', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openForm(page, 'dark');
    await page.fill('#modal input[name=name]', 'agent-architect');
    await page.click('#modal .wv-user-role .picker-face');
    await page.locator('.picker-pop .picker-row', { has: page.getByText('Architect', { exact: true }) }).click();
    await page.waitForFunction(() => !document.querySelector('.picker-pop'));
    assert.equal((await page.locator('#modal .wv-user-role .picker-face').innerText()).trim(), 'Architect');
    await page.click('#modal button[type=submit]');
    await page.locator('#modal h2', { hasText: 'Architect token for net' }).waitFor();
    assert.match(await page.locator('#modal p').first().textContent(), /agent-architect/);
    assert.match(await page.locator('#modal .wv-user-secret').inputValue(), /^wv_/);
    await page.close();
  });
}
