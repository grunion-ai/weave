import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { exerciseSurface, pointer, centre, aimAt, quiet } from './lib/reorder-surfaces.mjs';

const s = await launch('left nav drag to reorder (Feature #350)', (weave) => {
  weave.markOnboarded();
  for (const name of ['Alpha', 'Bravo', 'Charlie']) weave.createSpace({ name });
  for (const name of ['One', 'Two', 'Three']) weave.createTable({ space: 'Alpha', name });
  weave.createTable({ space: 'Bravo', name: 'Solo' });
});

if (s) {
  const { base, browser, weave } = s;
  const page = () => browser.newPage({ viewport: { width: 1280, height: 900 } });
  const spaceNames = () => weave.listSpaces().filter((x) => !x.system).map((x) => x.name);
  const tableNames = (space) => weave.listTables(weave.getSpace(space).id).map((t) => t.name);
  const open = async (p) => {
    await p.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await p.waitForSelector('#nav a.nav-db');
    await quiet(p);
  };
  const group = (p, name) => p.locator('#nav .nav-group:not(.wv-reorder-lift)', { has: p.locator(`a.nav-space:text-is("${name}")`) });
  const tableRow = (p, name) => p.locator(`#nav a.nav-db:not(.wv-reorder-lift):has(.nav-db-name:text-is("${name}"))`);
  const spaceKeys = (p) => p.$$eval('#nav .nav-group:not(.wv-reorder-lift)', (gs) => gs.map((g) => {
    const name = g.querySelector('a.nav-space').textContent.trim();
    return g.classList.contains('wv-reorder-slot') ? `[${name}]` : name;
  }));
  const tableKeys = (space) => (p) => p.$$eval('#nav .nav-group:not(.wv-reorder-lift)', (gs, sp) => {
    const g = gs.find((x) => x.querySelector('a.nav-space').textContent.trim() === sp);
    return [...g.querySelectorAll('a.nav-db:not(.wv-reorder-lift)')].map((a) => {
      const name = a.querySelector('.nav-db-name').textContent.trim();
      return a.classList.contains('wv-reorder-slot') ? `[${name}]` : name;
    });
  }, space);
  const writesOn = (p) => {
    const writes = [];
    p.on('request', (r) => { if (r.method() !== 'GET' && !r.url().includes('/query')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    return writes;
  };

  const surfaces = [
    {
      name: 'left nav spaces',
      axis: 'y',
      open,
      handle: (p, key) => group(p, key).locator('.nav-space-row'),
      target: (p, key) => group(p, key),
      keys: spaceKeys,
      saved: spaceNames,
      start: ['Alpha', 'Bravo', 'Charlie'],
      move: { from: 'Charlie', onto: 'Alpha', side: 'before' },
      midway: ['[Charlie]', 'Alpha', 'Bravo'],
      after: ['Charlie', 'Alpha', 'Bravo'],
      cancel: { from: 'Alpha', onto: 'Bravo', side: 'after' },
    },
    {
      name: 'left nav tables',
      axis: 'y',
      open,
      handle: tableRow,
      target: tableRow,
      keys: tableKeys('Alpha'),
      saved: () => tableNames('Alpha'),
      start: ['One', 'Two', 'Three'],
      move: { from: 'Three', onto: 'One', side: 'before' },
      midway: ['[Three]', 'One', 'Two'],
      after: ['Three', 'One', 'Two'],
      cancel: { from: 'One', onto: 'Two', side: 'after' },
    },
  ];

  for (const surface of surfaces) {
    test(`${surface.name}: lift, placeholder, drop and Escape with a mouse (Feature #350)`, async () => {
      const p = await page();
      try { await exerciseSurface(p, surface); } finally { await p.close(); }
    });
  }

  test('a space drags with its tables and lands as one block (Feature #350)', async () => {
    const p = await page();
    try {
      await open(p);
      assert.deepEqual(await spaceKeys(p), ['Charlie', 'Alpha', 'Bravo']);
      const hand = pointer(p);
      await hand.press(await centre(group(p, 'Alpha').locator('.nav-space-row')));
      await hand.nudge();
      await hand.to(await aimAt(group(p, 'Charlie'), 'before', 'y'));
      await quiet(p);
      assert.deepEqual(await spaceKeys(p), ['[Alpha]', 'Charlie', 'Bravo']);
      assert.deepEqual(await tableKeys('Alpha')(p), ['Three', 'One', 'Two'], 'the tables ride inside the placeholder');
      await hand.release();
      await p.waitForFunction(() => !document.querySelector('.wv-reorder-lift, .wv-reorder-slot'), null, { timeout: 5000 });
      await p.waitForLoadState('networkidle');
      assert.deepEqual(spaceNames(), ['Alpha', 'Charlie', 'Bravo']);
      assert.deepEqual(tableNames('Alpha'), ['Three', 'One', 'Two'], 'the tables keep their own order');
    } finally { await p.close(); }
  });

  test('a table dragged onto another space snaps home and writes nothing: its home changes only through Move to space… (Feature #350)', async () => {
    const p = await page();
    try {
      await open(p);
      const alpha = await tableKeys('Alpha')(p);
      const writes = writesOn(p);
      const hand = pointer(p);
      await hand.press(await centre(tableRow(p, 'One')));
      await hand.nudge();
      await hand.to(await aimAt(tableRow(p, 'Solo'), 'after', 'y'));
      await quiet(p);
      assert.equal(await group(p, 'Bravo').locator('.wv-reorder-slot').count(), 0, 'no placeholder opens in Bravo');
      assert.equal(await group(p, 'Alpha').locator('.wv-reorder-slot').count(), 1, 'the placeholder waits in Alpha');
      await hand.release();
      await p.waitForFunction(() => !document.querySelector('.wv-reorder-lift, .wv-reorder-slot'), null, { timeout: 5000 });
      await p.waitForLoadState('networkidle');
      assert.deepEqual(writes, [], 'a drop outside the home space writes nothing');
      assert.deepEqual(await tableKeys('Alpha')(p), alpha, 'Alpha reads as before');
      assert.deepEqual(await tableKeys('Bravo')(p), ['Solo']);
      assert.deepEqual(tableNames('Alpha'), alpha);
      assert.deepEqual(tableNames('Bravo'), ['Solo']);
    } finally { await p.close(); }
  });

  test('a table dropped on its own space row lands first and stays home (Feature #350)', async () => {
    const p = await page();
    try {
      await open(p);
      const before = await tableKeys('Alpha')(p);
      const last = before[before.length - 1];
      const hand = pointer(p);
      await hand.press(await centre(tableRow(p, last)));
      await hand.nudge();
      await hand.to(await aimAt(group(p, 'Alpha').locator('.nav-space-row'), 'after', 'y'));
      await quiet(p);
      await hand.release();
      await p.waitForFunction(() => !document.querySelector('.wv-reorder-lift, .wv-reorder-slot'), null, { timeout: 5000 });
      await p.waitForLoadState('networkidle');
      assert.deepEqual(tableNames('Alpha'), [last, ...before.slice(0, -1)]);
    } finally { await p.close(); }
  });

  test('a plain click on a space or table still opens it (Feature #350)', async () => {
    const p = await page();
    try {
      await open(p);
      await tableRow(p, 'Solo').click();
      await p.waitForFunction(() => /#\/table\//.test(location.hash), null, { timeout: 5000 });
      await group(p, 'Charlie').locator('a.nav-space').click();
      await p.waitForFunction(() => /#\/space\//.test(location.hash), null, { timeout: 5000 });
    } finally { await p.close(); }
  });
}
