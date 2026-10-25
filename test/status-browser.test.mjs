import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launch } from './lib/browser.mjs';

const s = await launch('public status');
const now = new Date().toISOString();
const day = now.slice(0, 10);
const fixture = () => ({ generatedAt: now, checkedAt: now, status: 'operational', intervalSeconds: 60, historyDays: 90, components: ['weave', 'mcp'].map((id) => ({ id, name: id === 'weave' ? 'Weave web & API' : 'MCP', status: 'operational', latencyMs: 127, checkedAt: now, uptimePercent: 100, days: [{ date: day, status: 'operational', uptimePercent: 100, checks: 3, failures: 0 }] })), incidents: [] });
async function page(data = fixture(), options = {}) {
  const p = await s.browser.newPage(options);
  await p.clock.install();
  await p.route('**/status', async (route) => route.fulfill({ contentType: 'text/html', body: await readFile(new URL('../public/status.html', import.meta.url), 'utf8') }));
  await p.route('**/status.css', async (route) => route.fulfill({ contentType: 'text/css', body: await readFile(new URL('../public/status.css', import.meta.url), 'utf8') }));
  await p.route('**/status.js', async (route) => route.fulfill({ contentType: 'application/javascript', body: await readFile(new URL('../public/status.js', import.meta.url), 'utf8') }));
  await p.route('**/api/status', (route) => route.fulfill({ json: data }));
  await p.goto(`${s.base}/status`);
  return p;
}
if (s) {
  test('status history preserves unknown days and supports keyboard day inspection', async () => {
    const p = await page();
    await p.getByRole('heading', { name: 'All systems operational' }).waitFor();
    assert.equal(await p.locator('.component').count(), 2);
    assert.equal(await p.locator('.day[data-status="unknown"]').count(), 178);
    const last = p.locator('.component').first().locator('.day').last();
    await last.focus();
    assert.match(await p.locator('.component').first().locator('.day-detail').textContent(), /3 checks/);
    await last.press('ArrowLeft');
    assert.match(await p.locator('.component').first().locator('.day-detail').textContent(), /No monitoring data/);
    assert.match(await p.locator('#incidents').textContent(), /No incidents recorded/);
    await p.close();
  });
  test('incident updates are text, include history, and paginate without losing active incidents', async () => {
    const data = fixture();
    data.status = 'degraded';
    data.incidents = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: i ? `Incident ${i}` : '<img src=x onerror=alert(1)>', status: i ? 'resolved' : 'investigating', impact: 'major', components: ['mcp'], startedAt: now, resolvedAt: i ? now : null, updates: [{ status: i ? 'resolved' : 'investigating', message: '<b>Operator update</b>', createdAt: now }, { status: 'identified', message: 'Earlier update', createdAt: now }] }));
    const p = await page(data);
    await p.getByRole('heading', { name: 'Some systems are degraded' }).waitFor();
    assert.equal(await p.locator('.incident').count(), 11);
    assert.equal(await p.locator('#active-incidents .incident').getAttribute('data-status'), 'outage');
    assert.equal(await p.locator('#incidents img, #incidents b').count(), 0);
    await p.getByRole('button', { name: 'Show earlier incidents' }).click();
    assert.equal(await p.locator('.incident').count(), 12);
    assert.match(await p.locator('#active-incidents').textContent(), /Earlier update/);
    await p.close();
  });
  test('failed refresh marks stale data and retry recovers', async () => {
    const p = await page();
    await p.getByRole('heading', { name: 'All systems operational' }).waitFor();
    await p.route('**/api/status', (route) => route.fulfill({ status: 503 }));
    await p.getByRole('button', { name: 'Refresh status' }).click();
    await p.getByText('Status updates are unavailable. Displayed data may be out of date.').waitFor();
    assert.equal(await p.locator('#overall').getAttribute('data-status'), 'unknown');
    assert.equal(await p.locator('.component[data-status=unknown]').count(), 2);
    await p.route('**/api/status', (route) => route.fulfill({ json: fixture() }));
    await p.getByRole('button', { name: 'Try again' }).click();
    await p.getByRole('heading', { name: 'All systems operational' }).waitFor();
    await p.close();
  });
  test('minute refresh updates health and delayed checks never claim current availability', async () => {
    const p = await page();
    await p.getByRole('heading', { name: 'All systems operational' }).waitFor();
    await p.locator('.component').first().locator('.day').last().focus();
    const changed = fixture();
    changed.components[0].latencyMs = 200;
    changed.status = 'outage';
    await p.route('**/api/status', (route) => route.fulfill({ json: changed }));
    await p.clock.runFor(60001);
    await p.getByRole('heading', { name: 'Service disruption' }).waitFor();
    assert.equal(await p.evaluate(() => document.activeElement?.className), 'day');
    changed.checkedAt = '2020-01-01T00:00:00Z';
    changed.components[0].checkedAt = 'invalid';
    changed.components[1].checkedAt = '2020-01-01T00:00:00Z';
    await p.getByRole('button', { name: 'Refresh status' }).click();
    await p.getByRole('heading', { name: 'Current status unavailable' }).waitFor();
    assert.match(await p.locator('#checked').textContent(), /Monitoring data is delayed/);
    assert.equal(await p.locator('.component[data-status=unknown]').count(), 2);
    await p.close();
  });
  for (const theme of ['light', 'dark']) test(`status fits mobile and desktop in ${theme} theme`, async () => {
    const p = await page(fixture(), { colorScheme: theme, viewport: { width: 390, height: 844 } });
    await p.getByRole('heading', { name: 'All systems operational' }).waitFor();
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await p.screenshot({ path: `/tmp/weave-status-${theme}-mobile.png`, fullPage: true });
    await p.setViewportSize({ width: 1280, height: 1000 });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await p.screenshot({ path: `/tmp/weave-status-${theme}-desktop.png`, fullPage: true });
    await p.close();
  });
}
