import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('an open-access boot asks for nothing that refuses it', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.createEntity(tasks, { name: 'Alpha' });
});

if (s) {
  const { base, browser } = s;
  const bootAsking = async (where) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const asked = [];
    const refused = [];
    page.on('response', (r) => {
      const { pathname } = new URL(r.url());
      if (!pathname.startsWith('/api/')) return;
      asked.push(`${r.request().method()} ${pathname}`);
      if (r.status() >= 400) refused.push(`${r.request().method()} ${pathname} ${r.status()}`);
    });
    try {
      await page.goto(`${base}${where}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.nav-identity');
      await page.waitForLoadState('networkidle');
      return { asked, refused };
    } finally { await page.close(); }
  };

  test('an open-access boot sends no request the server refuses (Issue #1707)', async () => {
    const { refused } = await bootAsking('/');
    assert.deepEqual(refused, []);
  });

  test('a boot with nobody signed in never asks who is signed in (Issue #1707)', async () => {
    const { asked } = await bootAsking('/');
    assert.deepEqual(asked.filter((a) => a.endsWith('/api/auth/me')), []);
  });

  test('a boot on a deployment that bills nobody never asks for billing (Issue #1707)', async () => {
    const { asked } = await bootAsking(`/#/table/${tasks.id}`);
    assert.deepEqual(asked.filter((a) => a.endsWith('/api/billing')), []);
  });
}
