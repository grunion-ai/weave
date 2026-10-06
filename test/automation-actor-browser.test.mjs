import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const TOKEN = 'VMH4hSRpVOhCwUno';
const s = await launch('automation actor', (w) => {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  w.addField(t.id, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  w.addField(t.id, { name: 'Resolved', type: 'checkbox' });
  w.updateTable(t.id, { systemFields: ['Created By', 'Modified By', 'Activity'] });
  const rule = w.createAutomation(t.id, { name: 'Close out on Done', trigger: { type: 'state-changed', field: 'Stage', toState: 'Done' }, actions: [{ type: 'set-field', field: 'Resolved', value: true }] });
  w.actor = `kyle via ${TOKEN}`;
  const rows = ['Printer', 'Badge', 'Desk'].map((name) => w.createEntity(t.id, { name }));
  w.actor = 'local';
  w.addComment(rows[0].id, { author: 'automation', text: 'Logged by an old rule.' });
  w.addComment(rows[0].id, { author: `workflow:${rule.id}`, text: 'Logged by the rule.' });
  const workflows = Object.values(w.state.tables).find((x) => x.system === 'workflows');
  const broken = w.createEntity(workflows.id, { name: 'Ping the webhook', Health: 'Failed', 'Health Reason': 'The webhook answered 500' });
  return { table: t, rows, rule, workflows, broken };
});

if (s) {
  const { weave, base, browser, table, rows, rule, workflows, broken } = s;
  const wfName = (id) => weave.readEntity(weave.readEntity(id).modifiedBy.replace(/^workflow:/, '')).name;

  const recordPulses = (page) => page.evaluate(() => {
    window.pulses = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        const n = m.target;
        if (m.attributeName !== 'class' || !n.classList.contains('wv-pulse') || window.pulses.some((p) => p.node === n)) continue;
        window.pulses.push({
          node: n, where: n.dataset.field ?? n.dataset.sys ?? n.dataset.block,
          delay: parseFloat(n.style.getPropertyValue('--wv-pulse-delay')), anim: getComputedStyle(n).animationName,
        });
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const pulses = (page) => page.evaluate(() => window.pulses.map(({ where, delay, anim }) => ({ where, delay, anim })));
  const pickState = async (page, scope, name) => {
    await page.locator(`${scope} [data-field="Stage"] button`).first().click();
    await page.waitForSelector('.picker-pop');
    await page.locator('.picker-pop .picker-list').getByText(name, { exact: true }).first().click();
  };

  test('a write through an MCP client is a person chip: the name, "via MCP", never the client id', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    const cell = page.locator(`tr[data-eid="${rows[0].id}"] td[data-sys="Created By"] .k-actor`);
    await cell.waitFor();
    assert.equal(await cell.locator('.k-label').textContent(), 'Kyle', 'the name, not the handle');
    assert.equal(await cell.locator('.av').textContent(), 'K', 'an initial, on the name\'s hue');
    assert.match(await cell.locator('.k-actor-via').textContent(), /via MCP/);
    assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(TOKEN), 'the grid prints no token id');
    await page.goto(`${base}/#/entity/${rows[0].id}`, { waitUntil: 'networkidle' });
    await page.locator('.fieldrow-system[data-field="Created By"] .k-actor').waitFor();
    assert.ok(await page.locator('.activity-item .k-actor').count(), 'the activity pane names the person');
    assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(TOKEN));
    const authors = page.locator('.comment .who');
    await authors.first().waitFor();
    assert.equal(await authors.nth(0).locator('.k-actor-wf.is-inline .k-label').textContent(), 'Automation', 'a legacy author is a neutral Automation label');
    assert.equal(await authors.nth(1).locator('.k-actor-wf a').getAttribute('href'), `#/entity/${rule.id}`, 'a workflow author is the rule\'s chip');
    await page.waitForFunction(() => document.querySelectorAll('.comment .who .k-actor-wf .k-label')[1]?.textContent === 'Close out on Done');
    await page.goto(`${base}/#/activity/${rows[0].id}`, { waitUntil: 'networkidle' });
    await page.locator('.activity-row .k-actor').first().waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(TOKEN));
    await page.close();
  });

  test('a rule that fires from the grid: its cells pulse in order, Modified By is the rule, one toast names it', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await recordPulses(page);
    await pickState(page, `tr[data-eid="${rows[1].id}"]`, 'Done');
    const toast = page.locator('.wv-toast.automation');
    await toast.waitFor();
    assert.match(await toast.textContent(), new RegExp(`Close out on Done ran on #${rows[1].publicId}`));
    const chip = page.locator(`tr[data-eid="${rows[1].id}"] td[data-sys="Modified By"] .k-actor-wf`);
    await page.waitForFunction((name) => document.querySelector(`td[data-sys="Modified By"] .k-actor-wf .k-label`)?.textContent === name, wfName(rows[1].id));
    assert.ok(await chip.locator('.wv-icon').count(), 'the workflow icon leads the chip');
    const wfId = weave.readEntity(rows[1].id).modifiedBy.replace(/^workflow:/, '');
    assert.equal(await chip.locator('a').getAttribute('href'), `#/entity/${wfId}`, 'the chip opens the Workflows row');
    await page.waitForFunction(() => window.pulses.length >= 2);
    const seen = await pulses(page);
    const at = (w) => seen.find((p) => p.where === w);
    assert.ok(at('Resolved') && at('Modified By'), `the rule's cell and Modified By pulse (${JSON.stringify(seen)})`);
    assert.equal(at('Resolved').anim, 'wv-pulse');
    assert.ok(at('Resolved').delay < at('Modified By').delay, 'cause before effect: the field the rule wrote, then who wrote it');
    assert.equal(at('Stage'), undefined, 'the state the reader picked is theirs, not the rule\'s');
    await toast.locator('.wv-toast-action').click();
    await page.waitForFunction((id) => location.hash === `#/entity/${id}`, wfId);
    const ran = weave.readEntity(rows[1].id).activity.findIndex((x) => x.kind === 'automation-ran');
    await page.goto(`${base}/#/activity/${rows[1].id}:${ran}`, { waitUntil: 'networkidle' });
    await page.locator('.fieldrow .k-actor-wf').first().waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(wfId), 'the event page names the rule, never its row id');
    await page.close();
  });

  test('the entity page pulses the rule\'s rows too; reduced motion keeps the chip and toast, no pulse', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/#/entity/${rows[2].id}`, { waitUntil: 'networkidle' });
    await recordPulses(page);
    await pickState(page, '.entity-values', 'Done');
    await page.locator('.wv-toast.automation').waitFor();
    await page.waitForFunction(() => window.pulses.some((p) => p.where === 'Resolved'));
    assert.ok((await pulses(page)).some((p) => p.where === 'Modified By'), 'Modified By pulses on the page as in the grid');
    await page.locator('.fieldrow-system[data-field="Modified By"] .k-actor-wf').waitFor();

    weave.setState(rows[2].id, 'Stage', 'Open');
    weave.updateEntity(rows[2].id, { Resolved: false });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'networkidle' });
    await recordPulses(page);
    await pickState(page, '.entity-values', 'Done');
    await page.locator('.wv-toast.automation').waitFor();
    await page.locator('.fieldrow-system[data-field="Modified By"] .k-actor-wf').waitFor();
    assert.deepEqual(await pulses(page), [], 'no pulse under reduced motion');
    await ctx.close();
  });

  test('a broken rule says why on its Health cell', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${base}/#/table/${workflows.id}`, { waitUntil: 'networkidle' });
    const cell = page.locator(`tr[data-eid="${broken.id}"] td[data-field="Health"] .chip-trigger`);
    await cell.waitFor();
    assert.equal(await cell.getAttribute('title'), 'The webhook answered 500');
    await page.goto(`${base}/#/entity/${broken.id}`, { waitUntil: 'networkidle' });
    const row = page.locator('.entity-values .fieldrow[data-field="Health"] .chip-trigger');
    await row.waitFor();
    assert.equal(await row.getAttribute('title'), 'The webhook answered 500', 'and on the row\'s page');
    await page.close();
  });
}
