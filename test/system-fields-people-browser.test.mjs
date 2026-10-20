import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

const ISS = 'https://idp.test';
const AT = '2026-08-28T17:14:03.000Z';
const member = new Weave();
let memberRow;

const s = await launch('system fields read as people', (w) => {
  w.inviteIssuer = ISS;
  const users = w.getTable('System/Users');
  const invite = w.createEntity(users.id, { name: 'Dana Quinn', values: { Email: 'dana@example.com', Role: 'Architect' } });
  w.redeemIdentityInvite(w.takeOneTime(invite.id).invite.code, { issuer: ISS, subject: 'user_dana', email: 'dana@example.com' });
  w.createAccount({ name: 'claude-code', role: 'editor' });
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  w.updateTable(t.id, { systemFields: ['Created At', 'Modified At', 'Created By', 'Modified By'] });
  w.actor = 'Dana Quinn';
  const row = w.createEntity(t.id, { name: 'Printer' });
  w.actor = 'claude-code via VMH4hSRpVOhCwUno';
  w.updateEntity(row.id, { name: 'Printer jam' });
  w.actor = 'web';
  const other = w.createEntity(t.id, { name: 'Badge' });
  w.actor = 'local';
  w.state.entities[row.id].createdAt = AT;
  const userRow = (name) => w.findEntity(users.id, name);
  member.updateWorkspace({ name: 'member' });
  member.createSpace({ name: 'Desk' });
  const mt = member.createTable({ space: 'Desk', name: 'Ticket' });
  member.updateTable(mt.id, { systemFields: ['Created By', 'Modified By'] });
  member.createAccount({ name: 'desk-bot', role: 'editor' });
  memberRow = member.createEntity(mt.id, { name: 'Monitor' });
  member.state.entities[memberRow.id].createdBy = 'desk-bot';
  member.state.entities[memberRow.id].modifiedBy = 'Dana Quinn';
  return { table: t, row, other, dana: userRow('Dana Quinn'), agent: userRow('claude-code') };
}, { server: () => ({ workspaces: { member } }) });

if (s) {
  const { weave, base, browser, table, row, other, dana, agent } = s;

  for (const colorScheme of ['light', 'dark']) test(`the record header strip shows a friendly stamp and linked Users chips (${colorScheme})`, async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme, timezoneId: 'UTC' });
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      const at = page.locator('.fieldrow-system[data-field="Created At"] .fieldrow-value');
      await at.waitFor();
      assert.equal((await at.innerText()).trim(), 'Aug 28, 2026 5:14 PM');
      assert.match(await at.locator('[title]').getAttribute('title'), /5:14:03 PM UTC/, 'the hover carries seconds and the zone');

      const by = page.locator('.fieldrow-system[data-field="Created By"] .k-actor a');
      await by.waitFor();
      assert.match(await by.getAttribute('href'), new RegExp(`#/entity/${dana.id}$`), 'the chip opens the Users row');
      assert.equal(await by.locator('.k-label').textContent(), 'Dana Quinn');
      assert.equal(await by.locator('.actor-av').textContent(), 'DQ', 'a person wears initials');
      assert.equal(await by.getAttribute('title'), 'Dana Quinn · Architect · dana@example.com');

      const mod = page.locator('.fieldrow-system[data-field="Modified By"] .k-actor a');
      await mod.waitFor();
      assert.match(await mod.getAttribute('href'), new RegExp(`#/entity/${agent.id}$`));
      assert.equal(await mod.locator('.mi-cpu').count(), 1, 'the agent badge identifies automation');
      assert.equal(await mod.locator('.av').count(), 0, 'an agent fallback does not use person initials');
      assert.match(await page.locator('.fieldrow-system[data-field="Modified By"] .k-actor-via').textContent(), /via MCP/);
      assert.doesNotMatch(await page.locator('body').innerText(), /VMH4hSRpVOhCwUno/);
    } finally { await page.close(); }
  });

  test('an actor with no Users row is a muted chip with no link, in the grid as on the record', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, timezoneId: 'UTC' });
    try {
      await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      const web = page.locator(`tr[data-eid="${other.id}"] td[data-sys="Created By"] .k-actor`);
      await web.waitFor();
      await page.locator(`tr[data-eid="${row.id}"] td[data-sys="Created By"] .k-actor a`).waitFor();
      assert.ok(await web.evaluate((n) => n.classList.contains('is-unknown')), 'muted');
      assert.equal(await web.locator('a').count(), 0, 'no link');
      assert.equal(await web.locator('.av').count(), 0, 'no initials beside the word: never "WWeb"');
      assert.equal((await web.innerText()).trim(), 'Web');
      const ink = await web.evaluate((n) => [getComputedStyle(n).color, getComputedStyle(document.body).color]);
      assert.notEqual(ink[0], ink[1], 'quieter than body text');
      assert.equal((await page.locator(`tr[data-eid="${row.id}"] td[data-sys="Created At"]`).innerText()).trim(), 'Aug 28, 2026 5:14 PM');
    } finally { await page.close(); }
  });

  test('a member workspace resolves its actors from the registry\'s Users rows', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, timezoneId: 'UTC' });
    try {
      await page.goto(`${base}/w/member/#/entity/${memberRow.id}`, { waitUntil: 'networkidle' });
      const bot = weave.listEntities(weave.getTable('System/Users').id).find((e) => weave.entityName(e) === 'desk-bot');
      assert.ok(bot, 'the member\'s account is a registry Users row');
      const chip = page.locator('.fieldrow-system[data-field="Created By"] .k-actor a');
      await chip.waitFor();
      assert.equal(await chip.getAttribute('href'), `/#/entity/${bot.id}`, 'the row lives in the hub, so the link leaves the member');
      assert.equal(await chip.locator('.mi-cpu').count(), 1);
      const dana = page.locator('.fieldrow-system[data-field="Modified By"] .k-actor');
      await dana.waitFor();
      assert.ok(await dana.evaluate((n) => n.classList.contains('is-unknown')), 'Dana is a user of the hub, not this member: no match');
    } finally { await page.close(); }
  });

  test('the activity table names the same people', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, timezoneId: 'UTC' });
    try {
      await page.goto(`${base}/#/activity/${row.id}`, { waitUntil: 'networkidle' });
      await page.locator('.activity-row .k-actor a').first().waitFor();
      const hrefs = await page.locator('.activity-row .k-actor a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      assert.ok(hrefs.some((h) => h.endsWith(`#/entity/${dana.id}`)), hrefs.join(' '));
    } finally { await page.close(); }
  });
}
