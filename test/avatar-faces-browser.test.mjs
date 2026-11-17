import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf } from './lib/browser.mjs';

const ISS = 'https://idp.test';
const NAMES = ['Dana Quinn', 'Eli Park', 'Fay Ross', 'Gus Lee', 'Hal Kim', 'Ivy Moss', 'Jon Reyes'];
const textRight = (face) => {
  const range = document.createRange();
  range.selectNodeContents(face.firstChild);
  return range.getBoundingClientRect().right;
};

const s = await launch('avatar faces on people surfaces', (w) => {
  const users = w.getTable('System/Users');
  w.inviteIssuer = ISS;
  const people = NAMES.map((name) => {
    const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
    const row = w.createEntity(users.id, { name, values: { Email: email, Role: 'Editor' } });
    w.redeemIdentityInvite(w.takeOneTime(row.id).invite.code, { issuer: ISS, subject: `user_${email}`, email });
    return row;
  });
  const ada = w.createAccount({ name: 'Ada Lovelace', role: 'editor' }).account;
  w.createAccount({ name: 'weave-fixer', role: 'editor' });
  w.createSpace({ name: 'Ops' });
  const vendor = w.createTable({ space: 'Ops', name: 'Vendor' });
  const table = w.createTable({ space: 'Ops', name: 'Project' });
  w.updateTable(table.id, { systemFields: ['Created By'] });
  w.addRelation(table.id, { name: 'Team', targetDb: users.id, cardinality: 'many-to-many' });
  w.addRelation(table.id, { name: 'Suppliers', targetDb: vendor.id, cardinality: 'many-to-many' });
  const big = w.createEntity(table.id, { name: 'Apollo' });
  w.link(big.id, 'Team', people.map((p) => p.id));
  const small = w.createEntity(table.id, { name: 'Gemini' });
  w.link(small.id, 'Team', people.slice(0, 2).map((p) => p.id));
  const solo = w.createEntity(table.id, { name: 'Vostok' });
  w.link(solo.id, 'Team', [people[0].id]);
  const plain = w.createEntity(table.id, { name: 'Mercury' });
  w.link(plain.id, 'Suppliers', ['Acme', 'Globex'].map((name) => w.createEntity(vendor.id, { name }).id));
  w.actor = 'weave-fixer';
  const stamped = w.createEntity(table.id, { name: 'Skylab' });
  w.actor = 'local';
  return { table, people, ada, big, small, solo, plain, stamped };
});

if (s) {
  const { base, browser, weave, table, people, ada, big, small, solo, plain, stamped } = s;
  const grid = async (colorScheme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    return page;
  };
  const cell = (page, row, field) => page.locator(`tr[data-eid="${row.id}"] td[data-field="${field}"]`);

  for (const colorScheme of ['light', 'dark']) test(`a compact cell of faces draws five linked faces, then +N (${colorScheme})`, async () => {
    const page = await grid(colorScheme);
    try {
      const pile = cell(page, big, 'Team').locator('.wv-face-pile');
      await pile.waitFor();
      const faces = pile.locator(':scope > a');
      assert.equal(await faces.count(), 5, 'five faces');
      assert.equal(await cell(page, big, 'Team').locator('.k-rel').count(), 0, 'a pile replaces the chips');
      assert.match(await faces.first().getAttribute('href'), new RegExp(`#/entity/${people[0].id}$`));
      assert.equal(await faces.first().getAttribute('title'), 'Dana Quinn');
      assert.equal((await faces.first().locator('.wv-av').textContent()).trim(), 'DQ');
      assert.equal((await pile.locator('.k-more').innerText()).trim(), '+2');
      assert.equal(await pile.locator('.k-more').getAttribute('title'), 'Ivy Moss, Jon Reyes');
      const [first, second] = [await faces.nth(0).boundingBox(), await faces.nth(1).boundingBox()];
      assert.ok(second.x < first.x + first.width, 'neighbouring faces overlap');
      const ring = await faces.first().locator('.wv-av').evaluate((n) => getComputedStyle(n).boxShadow);
      assert.notEqual(ring, 'none', 'a ring keeps overlapping faces apart');
      for (let i = 0; i < 4; i++) {
        const right = await faces.nth(i).locator('.wv-av').evaluate(textRight);
        const next = await faces.nth(i + 1).boundingBox();
        assert.ok(right <= next.x, `the next face leaves the initials of face ${i + 1} whole: text ends at ${right}, next face at ${next.x}`);
      }
    } finally { await page.close(); }
  });

  test('the phone list keeps the pile, where a cell with no chip is hidden', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      const pile = cell(page, big, 'Team').locator('.wv-face-pile');
      await pile.waitFor({ state: 'visible' });
      assert.equal(await pile.locator(':scope > a').count(), 5);
      const count = await pile.locator('.k-more').boundingBox();
      const box = await cell(page, big, 'Team').locator('.wv-cb').boundingBox();
      assert.ok(count.height <= box.height, `the count fits its ${box.height}px cell at ${count.height}px`);
    } finally { await page.close(); }
  });

  test('two faces draw no overflow count', async () => {
    const page = await grid();
    try {
      const pile = cell(page, small, 'Team').locator('.wv-face-pile');
      await pile.waitFor();
      assert.equal(await pile.locator(':scope > a').count(), 2);
      assert.equal(await pile.locator('.k-more').count(), 0);
    } finally { await page.close(); }
  });

  test('a list of rows without faces stays chips', async () => {
    const page = await grid();
    try {
      const box = cell(page, plain, 'Suppliers');
      await box.locator('.k-rel').first().waitFor();
      assert.equal(await box.locator('.k-rel').count(), 2);
      assert.equal(await box.locator('.wv-face-pile').count(), 0);
    } finally { await page.close(); }
  });

  test('a click on a face opens that row and nothing else', async () => {
    const page = await grid();
    try {
      const face = cell(page, big, 'Team').locator('.wv-face-pile > a').first();
      await face.click();
      await page.waitForURL(new RegExp(`${people[0].id}$`));
      assert.equal(await page.locator('.picker-pop, .link-search').count(), 0, 'no link picker opens behind it');
    } finally { await page.close(); }
  });

  test('one linked face stays a chip', async () => {
    const page = await grid();
    try {
      const box = cell(page, solo, 'Team');
      await box.locator('.k-rel').first().waitFor();
      assert.equal(await box.locator('.k-rel').count(), 1);
      assert.equal(await box.locator('.wv-face-pile').count(), 0);
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) test(`an actor chip wears the Users row's face at the grid's avatar size (${colorScheme})`, async () => {
    const page = await grid(colorScheme);
    try {
      const chip = page.locator(`tr[data-eid="${stamped.id}"] td[data-sys="Created By"] .k-actor`);
      const face = chip.locator('.actor-av');
      await face.waitFor();
      assert.equal((await face.textContent()).trim(), 'WF', 'a one-word handle takes its initials across the dash');
      assert.equal(await chip.locator('.av').count(), 0, 'the Users face replaces the hashed initials');
      assert.equal(await face.locator('.av-badge').count(), 1, 'an agent keeps its badge');
      const want = await face.evaluate((n) => getComputedStyle(n.closest('.wv-grid')).getPropertyValue('--wv-av').trim());
      assert.match(want, /^\d+px$/);
      await styleOf(face, 'width', want);
    } finally { await page.close(); }
  });

  test('the identity panel swaps its hashed initials for the Users row face', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(ada.id).token, url: base }]);
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}/`, { waitUntil: 'load' });
      const face = page.locator('#sidebar .nav-account-chip .wv-av.nav-account-av');
      await face.waitFor();
      assert.equal((await face.innerText()).trim(), 'AL');
      assert.equal(await page.locator('#sidebar .nav-account-chip .nav-account-av').count(), 1, 'one face, swapped in place');
      await styleOf(face, 'width', '22px');
    } finally { await ctx.close(); }
  });
}
