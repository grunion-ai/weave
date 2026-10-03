/* The entity header and each document's section head hold while the reader
   scrolls (Issue #411).

   Kyle: "entity header should be frozen at the top on scroll, so should each
   document header when scrolling in that document". The full page already
   pinned its header (Issue #321), but the docked pane, the pose a table row
   opens into, set its header back in the flow, so the title, breadcrumbs and
   actions left with the first screen. And no section head pinned anywhere:
   a screen into a long Description, the page no longer said which document
   it was showing, and history, copy and the section menu were out of reach.

   A section head holds under the entity header while its own section is in
   view, then leaves with the section's end, so the next document's head
   takes the same place.

   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const para = (word, n) => Array.from({ length: n }, (_, i) => `${word} paragraph ${i + 1} with enough words to read as prose.`).join('\n\n');

let notes, long;
const s = await launch('sticky entity heads', (weave) => {
  weave.createSpace({ name: 'Work' });
  notes = weave.createTable({ space: 'Work', name: 'Notes' });
  weave.addField(notes, { name: 'Brief', type: 'document' });
  long = weave.createEntity(notes, { name: 'A long read' });
  for (let i = 0; i < 4; i++) weave.createEntity(notes, { name: `other ${i}` });
  weave.setDoc(long.id, para('Description', 80));
  weave.setDoc(long.id, para('Brief', 80), 'Brief');
});

if (s) {
  const { base, browser } = s;

  const open = async (hash, theme = null) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.doc-section-head');
    await page.waitForTimeout(500); // the header height is published on a ResizeObserver
    return page;
  };

  /* One reading of the page: the entity header, each section head, and the
     section each head belongs to, in viewport coordinates. `pane` names the
     box that scrolls: #main on the full page (the window never scrolls since
     Issue #609), #dock in the split. */
  const read = (page, pane) => page.evaluate((pane) => {
    const root = pane === 'dock' ? document.querySelector('#dock') : document;
    const header = root.querySelector(pane === 'dock' ? '.dock-entity > .view-header' : '#main > .view-header');
    const r = (n) => n.getBoundingClientRect();
    const secs = [...root.querySelectorAll('.doc-section')].map((sec) => ({
      name: sec.querySelector('.doc-section-name').textContent.trim(),
      head: r(sec.querySelector('.doc-section-head')).toJSON(),
      sec: r(sec).toJSON(),
    }));
    return { header: r(header).toJSON(), secs, paneTop: r(document.querySelector(pane === 'dock' ? '#dock' : '#main')).top, ih: innerHeight };
  }, pane);
  const scroll = (page, pane, y) => page.evaluate(([pane, y]) => {
    // Instant: Tabler's reboot makes the root scroll smoothly, and a glide
    // would still be under way when the reading is taken.
    document.querySelector(pane === 'dock' ? '#dock' : '#main').scrollTo({ top: y, behavior: 'instant' });
  }, [pane, y]).then(() => page.waitForTimeout(250));
  const section = (reading, name) => reading.secs.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 2, `${msg}: ${a} vs ${b}`);

  /* The scroll offset that puts `name`'s section a given distance above the
     top of its pane, measured in the unscrolled layout. */
  const offsetInto = async (page, pane, name, into) => {
    await scroll(page, pane, 0);
    const at = await read(page, pane);
    return Math.round(section(at, name).sec.top - at.paneTop + into);
  };

  for (const pane of ['page', 'dock']) {
    const hash = pane === 'dock' ? `#/table/${notes.id}?e=${long.id}` : `#/entity/${long.id}`;

    test(`${pane}: the entity header and the Description head hold while the Description scrolls`, async () => {
      const page = await open(hash);
      const readings = [];
      for (const into of [600, 1400]) {
        await scroll(page, pane, await offsetInto(page, pane, 'Description', into));
        readings.push(await read(page, pane));
      }
      const [a, b] = readings;
      near(a.header.top, b.header.top, 'the entity header keeps its top edge between two scroll positions');
      near(a.header.top, a.paneTop, 'and that edge is the top of the pane');
      const [ha, hb] = [section(a, 'Description').head, section(b, 'Description').head];
      near(ha.top, hb.top, 'the Description head keeps its top edge while its body scrolls under it');
      near(ha.top, a.header.bottom, 'and rests against the entity header\'s lower edge');
      assert.ok(section(b, 'Description').sec.top < b.paneTop - 1000, `the section really scrolled a screen past the head: ${JSON.stringify(b)}`);
      await page.close();
    });

    test(`${pane}: a section head leaves with its section, and the next head takes its place`, async () => {
      const page = await open(hash);
      // A little way into Brief: Description has ended above the pane.
      await scroll(page, pane, await offsetInto(page, pane, 'Brief', 400));
      const r = await read(page, pane);
      const desc = section(r, 'Description');
      assert.ok(desc.head.bottom <= desc.sec.bottom + 1, `the Description head stays inside its own section: head ${desc.head.bottom} section ${desc.sec.bottom}`);
      assert.ok(desc.head.bottom <= r.header.bottom + 1, `so it has gone up behind the entity header with its section: ${JSON.stringify(r)}`);
      const brief = section(r, 'Brief');
      near(brief.head.top, r.header.bottom, 'the Brief head now holds under the entity header');
      await page.close();
    });

    test(`${pane}: a collapsed section's head goes by with the page`, async () => {
      const page = await open(hash);
      await page.click(pane === 'dock' ? '#dock .doc-section .doc-caret' : '#main .doc-section .doc-caret');
      await page.waitForTimeout(250);
      await scroll(page, pane, await offsetInto(page, pane, 'Brief', 400));
      const r = await read(page, pane);
      const desc = section(r, 'Description');
      assert.ok(desc.head.bottom <= r.header.bottom + 1, `the folded Description head went by: ${desc.head.bottom}`);
      near(section(r, 'Brief').head.top, r.header.bottom, 'and the open Brief head holds');
      // Unfold again: the choice is stored per browser.
      await page.click(pane === 'dock' ? '#dock .doc-section .doc-caret' : '#main .doc-section .doc-caret');
      await page.close();
    });
  }

  test('the section head paints an opaque band under the entity header, in both themes', async () => {
    for (const theme of ['light', 'dark']) {
      const page = await open(`#/entity/${long.id}`, theme);
      const paint = await page.evaluate(() => {
        const head = getComputedStyle(document.querySelector('#main .doc-section-head'));
        const header = getComputedStyle(document.querySelector('#main > .view-header'));
        return { pos: head.position, bg: head.backgroundColor, main: getComputedStyle(document.querySelector('#main')).backgroundColor, z: Number(head.zIndex), headerZ: Number(header.zIndex) };
      });
      assert.equal(paint.pos, 'sticky', `${theme}: the section head is sticky`);
      assert.equal(paint.bg, paint.main, `${theme}: it wears the panel's background, so text cannot show through`);
      assert.ok(!/rgba\(0, 0, 0, 0\)/.test(paint.bg), `${theme}: and that background is opaque`);
      assert.ok(paint.z > 0 && paint.z < paint.headerZ, `${theme}: it rides over the document and under the entity header: ${paint.z} < ${paint.headerZ}`);
      await page.close();
    }
  });

  test('the docked header holds with the dock\'s own height, and the page reading is untouched', async () => {
    const page = await open(`#/table/${notes.id}?e=${long.id}`);
    const v = await page.evaluate(() => {
      const dock = document.querySelector('#dock');
      const h = dock.querySelector('.dock-entity > .view-header');
      return {
        pos: getComputedStyle(h).position,
        dockV: getComputedStyle(dock).getPropertyValue('--wv-view-h').trim(),
        measured: `${h.getBoundingClientRect().height}px`,
        pageV: getComputedStyle(document.documentElement).getPropertyValue('--wv-view-h').trim(),
        pageMeasured: `${document.querySelector('#main > .view-header').getBoundingClientRect().height}px`,
      };
    });
    assert.equal(v.pos, 'sticky', 'the docked entity header is sticky');
    assert.equal(v.dockV, v.measured, 'the dock carries its own header height');
    assert.equal(v.pageV, v.pageMeasured, 'and the page keeps the table header\'s');
    await page.close();
  });
}
