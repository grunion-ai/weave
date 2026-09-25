/* The Name column opens wide enough to read (Issue #261, the width half).

   A 2026-09-12 audit measured the Issue and Guide tables at 1440x900 and
   found the Name column showing about 70 px of text: "Looks bro",
   "Quickstar". Name had no default width, so auto table layout gave it the
   min-content of an <input> and handed the slack to Description, Status and
   Severity. The one column a table exists for was the one nobody could read.

   The fix gives the Name column a preferred width of 260px while it carries
   no stored width, and only out of the room the card has to spare: the
   floor must never be the thing that pushes a grid past its card, because
   that flips the wrap from page scroll to its own scroller (a docked record
   lost the page's scroll that way, test/scroll-browser.test.mjs). A stored
   width (a drag, a double-click fit) is the reader's own choice and wins
   outright, narrower than the floor included. All of it is layout, so only
   a live browser can see it; the suite skips without Playwright (house
   rule: zero runtime deps). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

// What the grid gives an unsized Name column when the card has the room, in
// CSS px: the same 260px that caps every unsized cell (public/style.css).
const FLOOR = 260;
// About thirty characters, the length the gate says must read whole.
const THIRTY = 'Quickstart for a new workspace';
// Real Issue titles run long; they are what squeezed the column in the audit.
const LONG = [
  'Looks broken: the Name column truncates in every table at its default width',
  'Slow: opening the Case table freezes the browser for 17 to 52 seconds',
  'Wrong data: trashing rows from the selection bar has no confirmation',
];
const sentence = (n) => `${n}: a sentence long enough to want the whole width of its column`;

// An Issue-shaped table: two selects and prose columns beside Name, each of
// which asks auto layout for room. `prose` sets how crowded it is.
function issueTable(weave, name, prose) {
  const t = weave.createTable({ space: 'Development', name });
  weave.addField(t.id, { name: 'Status', type: 'select', config: { options: ['Open', 'Fixed'] } });
  weave.addField(t.id, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  for (const n of prose) weave.addField(t.id, { name: n, type: 'text' });
  const values = Object.fromEntries(prose.map((n) => [n, sentence(n)]));
  weave.createEntity(t.id, { name: THIRTY, values: { Status: 'Open', Severity: 'Medium', ...values } });
  for (const n of LONG) weave.createEntity(t.id, { name: n, values: { Status: 'Open', Severity: 'High', ...values } });
  return t;
}

let issues, crowded, notes, docked;
const s = await launch('name column width', (weave) => {
  weave.createSpace({ name: 'Development' });
  // Room to spare at 1440x900: here the Name column must reach the floor.
  issues = issueTable(weave, 'Issue', ['Observed', 'Expected', 'Fix shape']);
  // Five prose columns: at 1440x900 the grid still fits its card, with less
  // than 260px left over for Name.
  crowded = issueTable(weave, 'Crowded', ['Observed', 'Expected', 'Fix shape', 'Evidence', 'Impact']);
  // The scroll suite's shape: Name and Description, rows enough to scroll
  // the page, read with a record docked beside the table.
  notes = weave.createTable({ space: 'Development', name: 'Note' });
  docked = weave.createEntity(notes.id, { name: 'Outlined' });
  for (let i = 0; i < 40; i++) weave.createEntity(notes.id, { name: `Row ${i}` });
});

if (s) {
  const { base, browser, weave } = s;
  const nameField = () => Object.values(weave.getTable(issues.id).fields).find((f) => f.name === 'Name');
  const setNameWidth = (width) => weave.updateField(issues.id, nameField().id, { config: { width } });

  const open = async (theme, table = issues, viewport = { width: 1440, height: 900 }) => {
    const page = await browser.newPage({ viewport });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForTimeout(60);
    return page;
  };

  // Take the floor off (or put it back) in the page and let the wrap's
  // ResizeObserver settle. With it off, the grid is what it was before
  // Issue #261, which is the base the fixture has to fit at.
  const floorOn = async (page, on) => {
    await page.evaluate((v) => {
      const th = [...document.querySelectorAll('.wv-grid th.col-head')]
        .find((h) => h.querySelector('.col-label')?.textContent === 'Name');
      const idx = [...th.parentElement.children].indexOf(th);
      for (const row of document.querySelectorAll('.wv-grid tr')) row.children[idx]?.classList.toggle('name-col', v);
    }, on);
    await page.waitForTimeout(150);
  };

  // Which scroll mode the grid's wrap settled in, and how wide the grid is
  // against it. `wv-fit` is page scroll; `wv-grid-scroll` is the wrap's own.
  const readFit = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const th = [...document.querySelectorAll('.wv-grid th.col-head')]
      .find((h) => h.querySelector('.col-label')?.textContent === 'Name');
    return {
      fit: wrap.classList.contains('wv-fit'),
      ownScroll: wrap.classList.contains('wv-grid-scroll'),
      wrap: wrap.clientWidth,
      grid: document.querySelector('.wv-grid').getBoundingClientRect().width,
      name: th.getBoundingClientRect().width,
    };
  });

  // The Name header's rendered width, and whether a given name's editor
  // paints its whole value (an <input> that scrolls is a clipped name).
  const readName = (page, value) => page.evaluate((v) => {
    const th = [...document.querySelectorAll('.wv-grid th.col-head')]
      .find((h) => h.querySelector('.col-label')?.textContent === 'Name');
    const input = [...document.querySelectorAll('.wv-grid td.name-cell input.inline-edit')]
      .find((i) => i.value === v);
    return {
      width: th.getBoundingClientRect().width,
      cell: input.closest('td').getBoundingClientRect().width,
      clipped: input.scrollWidth > input.clientWidth + 1,
    };
  }, value);

  for (const theme of ['light', 'dark']) {
    test(`${theme}: an unsized Name column opens at the floor, and a thirty-character name reads whole`, async () => {
      setNameWidth(null);
      const page = await open(theme);
      try {
        const got = await readName(page, THIRTY);
        assert.ok(got.width >= FLOOR - 0.5, `the Name header renders at least ${FLOOR}px, got ${Math.round(got.width)}px`);
        assert.ok(Math.abs(got.cell - got.width) <= 1, `the cells follow the header: ${Math.round(got.cell)} vs ${Math.round(got.width)}`);
        assert.equal(got.clipped, false, `"${THIRTY}" must render whole in a ${Math.round(got.width)}px column`);
      } finally { await page.close(); }
    });

    test(`${theme}: a stored width narrower than the floor is honoured`, async () => {
      setNameWidth(120);
      const page = await open(theme);
      try {
        const got = await readName(page, THIRTY);
        assert.ok(Math.abs(got.width - 120) <= 1, `the reader's 120px wins over the floor, got ${Math.round(got.width)}px`);
        assert.ok(Math.abs(got.cell - 120) <= 1, `the cells hold the stored width too, got ${Math.round(got.cell)}px`);
      } finally { setNameWidth(null); await page.close(); }
    });

    test(`${theme}: the floor never pushes a crowded grid past its card`, async () => {
      const page = await open(theme, crowded);
      try {
        await floorOn(page, false);
        const bare = await readFit(page);
        assert.equal(bare.fit, true, `the fixture fits its card without the floor (${Math.round(bare.grid)}px in ${bare.wrap}px), or it guards nothing`);
        await floorOn(page, true);
        const got = await readFit(page);
        assert.ok(got.grid <= got.wrap + 1, `the grid fits its card: ${Math.round(got.grid)}px in ${got.wrap}px`);
        assert.equal(got.fit, true, 'the wrap stays in page-scroll mode');
        assert.equal(got.ownScroll, false, 'the wrap does not become its own scroller');
        assert.ok(got.name > bare.name, `Name still takes the room there is: ${Math.round(bare.name)}px before, ${Math.round(got.name)}px with the floor`);
      } finally { await page.close(); }
    });

    test(`${theme}: with a record docked beside the table, the floor leaves the page scrolling`, async () => {
      const page = await open(theme, notes, { width: 1280, height: 700 });
      try {
        await page.click(`tr[data-eid="${docked.id}"] .open-link`);
        await page.waitForSelector('#dock:not([hidden])');
        await page.waitForTimeout(300);
        await floorOn(page, false);
        const bare = await readFit(page);
        assert.equal(bare.fit, true, `the fixture fits the docked card without the floor (${Math.round(bare.grid)}px in ${bare.wrap}px), or it guards nothing`);
        await floorOn(page, true);
        const got = await readFit(page);
        assert.ok(got.grid <= got.wrap + 1, `the grid fits the narrowed card: ${Math.round(got.grid)}px in ${got.wrap}px`);
        assert.equal(got.fit, true, 'the wrap stays in page-scroll mode beside the dock');
        const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        assert.ok(room > 200, `the page behind the dock still scrolls (${room}px of travel)`);
      } finally { await page.close(); }
    });
  }
}
