import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { launch, hold } from './lib/browser.mjs';

let solo;
const s = await launch('workspace delete, last workspace', (weave) => {
  seedWeaver(weave);
  weave.markOnboarded();
  solo = new Weave();
  solo.state.meta.name = 'solo';
  solo.markOnboarded();
}, { server: () => ({ workspaces: { solo } }) });

if (s) {
  const { base, browser, weave } = s;

  for (const theme of ['light', 'dark']) {
    test(`${theme}: deleting your last workspace lands on the weave workspace (Feature #347)`, async () => {
      solo.state.meta.deletedAt = null;
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      try {
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(`${base}/w/${solo.state.meta.id}/`);
        await page.waitForSelector('#main .view-header .dots-btn[title="Workspace actions"]');
        assert.equal(weave.state.meta.name, 'weave', 'the hub root is the weave docs workspace');
        await page.click('#main .view-header .dots-btn[title="Workspace actions"]');
        await page.locator('.wv-menu .wv-menu-row', { hasText: 'Delete workspace…' }).click();
        await page.fill('#modal input[name="confirm"]', 'solo');
        await hold(page.locator('#modal .ws-delete-go'));
        await page.waitForURL((u) => u.pathname === '/');
        await page.waitForFunction(() => document.querySelector('#ws-name')?.textContent.trim() === 'weave');
        assert.ok(solo.state.meta.deletedAt, 'solo is deleted');
        assert.equal(await page.locator('#ws-list .ws-icon[title^="solo "]').count(), 0, 'and off the rail');
      } finally {
        if (solo.state.meta.deletedAt) await fetch(`${base}/api/workspaces/solo/restore`, { method: 'POST' });
        await page.close();
      }
    });
  }
}
