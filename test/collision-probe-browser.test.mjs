import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf } from './lib/browser.mjs';
import { probe } from './lib/collision.mjs';

const PAGE = `<!doctype html><html><head><style>
  html, body { margin: 0; font: 14px/20px -apple-system, "Helvetica Neue", Arial, sans-serif; }
  body { height: 100vh; }
  .bar { position: relative; height: 32px; display: flex; align-items: center; gap: 8px; }
  .chip { display: inline-block; padding: 2px 8px; background: #eef; }
</style></head><body><div id="stage"></div></body></html>`;

const s = await launch('collision probe');

if (s) {
  const { browser } = s;
  const engines = { chromium: async () => browser, webkit: () => engineOf('webkit') };

  const stage = async (engine, html) => {
    const page = await engine.newPage({ viewport: { width: 390, height: 700 } });
    await page.setContent(PAGE);
    await page.evaluate((h) => { document.getElementById('stage').innerHTML = h; }, html);
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  const findings = async (engine, html, root) => {
    const page = await stage(engine, html);
    try {
      return await page.evaluate(probe, root === undefined ? { root: '#stage' } : root);
    } finally { await page.close(); }
  };
  const kinds = (got) => got.map((f) => f.kind);

  const FLAGGED = [
    {
      name: 'a toolbar dropped onto the breadcrumb is an overlap',
      html: `<div class="bar"><span class="crumb-nm">Tasks of the quarter</span><span class="toolbar" style="position:absolute;left:40px;top:6px">Activity</span></div>`,
      want: 'overlap', selector: /span\.crumb-nm$/, other: /span\.toolbar$/,
    },
    {
      name: 'tile fields pulled onto the tile title are an overlap',
      html: `<div class="tile" style="position:relative;width:200px;height:60px"><div class="tile-title" style="position:absolute;left:8px;top:8px">Vendor contract review</div><div class="tile-field" style="position:absolute;left:8px;top:12px">Due Friday</div></div>`,
      want: 'overlap', selector: /div\.tile-title$/, other: /div\.tile-field$/,
    },
    {
      name: 'an icon laid over a label is an overlap',
      html: `<div class="bar"><span class="k">Owner</span><svg class="ico" width="16" height="16" style="position:absolute;left:4px;top:8px"><rect width="16" height="16"/></svg></div>`,
      want: 'overlap', selector: /span\.k$/, other: /svg\.ico$/,
    },
    {
      name: 'a solid button laid over a label is an overlap',
      html: `<div class="bar"><span class="k">Owner</span><button class="act" style="position:absolute;left:4px;top:4px;background:#fff;border:1px solid #ccc">Add</button></div>`,
      want: 'overlap', selector: /button\.act$/, other: /span\.k$/,
    },
    {
      name: 'a control pushed past the right edge of the phone is a protrusion',
      html: `<div class="bar"><button class="act" style="position:absolute;left:360px;width:120px">Activity</button></div>`,
      want: 'protrusion', selector: /button\.act$/,
    },
    {
      name: 'a control cut by the left edge is a protrusion',
      html: `<div class="bar"><button class="act" style="position:absolute;left:-30px;width:120px">Activity</button></div>`,
      want: 'protrusion', selector: /button\.act$/,
    },
  ];

  const QUIET = [
    {
      name: 'a popover laid over the page it opened from',
      html: `<div class="bar"><span class="k">Owner</span></div><div class="pop" style="position:absolute;left:0;top:0;z-index:40;background:#fff"><span class="opt">Kyle Adriany</span></div>`,
    },
    {
      name: 'a dialog over the row behind it',
      html: `<div class="bar"><span class="k">Vendor contract review</span></div><dialog open style="position:absolute;left:0;top:0;margin:0;border:0"><span class="t">Delete this record?</span></dialog>`,
    },
    {
      name: 'a sticky header over the rows that scrolled under it',
      html: `<div style="height:60px;overflow:auto"><div class="head" style="position:sticky;top:0;background:#fff">Name</div><div class="row">Vendor contract review</div><div class="row">Another row entirely</div></div>`,
      prepare: () => { document.querySelector('[style*="overflow"]').scrollTop = 20; },
    },
    {
      name: 'a drag ghost over the row it was lifted from',
      html: `<div class="bar"><span class="k">Vendor contract review</span><span class="drag-ghost" style="position:absolute;left:4px;top:4px">Vendor contract review</span></div>`,
    },
    {
      name: 'two chips that meet at a one pixel seam',
      html: `<div class="bar" style="display:block"><span class="chip" style="position:absolute;left:0;top:0;width:100px">Open</span><span class="chip" style="position:absolute;left:99px;top:0;width:100px">Blocked</span></div>`,
    },
    {
      name: 'a label and the text node inside it',
      html: `<label class="k" style="display:block"><span class="t">Owner</span></label>`,
    },
    {
      name: 'a skip link parked off the left edge',
      html: `<a class="skip-link" href="#main" style="position:absolute;left:-9999px">Skip to content</a><div class="bar"><span class="k">Owner</span></div>`,
    },
    {
      name: 'a visually hidden label stacked on the text that replaced it',
      html: `<div class="bar" style="display:block;position:relative"><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Owner</span><span class="k">Owner</span></div>`,
    },
    {
      name: 'rows that scrolled out of their own scroll container',
      html: `<div style="height:40px;overflow:auto"><div class="row">Vendor contract review</div><div class="row">Another row entirely</div><div class="row">A third row here</div></div>`,
      prepare: () => { document.querySelector('[style*="overflow"]').scrollTop = 30; },
    },
    {
      name: 'a bare drag grip whose negative margins reach over the label beside it',
      html: `<div class="bar" style="display:flex;align-items:center;padding-left:24px"><button class="view-grip" style="border:0;background:none;padding:9px 5px;margin-inline:-8px -10px"><svg width="14" height="14"><rect width="14" height="14"/></svg></button><a class="view-name" href="#x">Standard</a></div>`,
    },
    {
      name: 'a line-clamped title whose hidden lines fall where the field below it sits',
      html: `<div class="tile" style="width:160px"><a class="tile-title" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">Task 0: a title that runs well past the column so the cell has to end it somewhere</a><dt class="tile-field" style="margin:0">Owner</dt></div>`,
    },
    {
      name: 'an ellipsis label whose hidden text runs under the caret beside it',
      html: `<span class="k" style="display:inline-flex;max-width:120px"><span class="k-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Billing rewrite with a name long enough to wrap in a chip</span><button class="mention-caret">v</button></span>`,
    },
    {
      name: 'a wide table inside its own horizontal scroller',
      html: `<div class="wv-grid-scroll" style="width:200px;overflow-x:auto"><div style="width:900px"><span class="k">A column header far wider than the scroller</span></div></div>`,
    },
  ];

  for (const [engineName, get] of Object.entries(engines)) {
    for (const c of FLAGGED) {
      test(`${c.name} (${engineName})`, async (t) => {
        const engine = await get();
        if (!engine) return t.skip(`${engineName} cannot launch here`);
        const page = await stage(engine, c.html);
        try {
          const got = await page.evaluate(probe, { root: '#stage' });
          assert.deepEqual(kinds(got), [c.want], JSON.stringify(got));
          assert.match(got[0].selector, c.selector);
          if (c.other) assert.match(got[0].with, c.other);
          assert.ok(got[0].px > 2, `px names how far they meet (${got[0].px})`);
          assert.ok(got[0].text.length > 0 && got[0].text.length <= 60, 'text is a short excerpt');
        } finally { await page.close(); }
      });
    }
    for (const c of QUIET) {
      test(`${c.name} is not a collision (${engineName})`, async (t) => {
        const engine = await get();
        if (!engine) return t.skip(`${engineName} cannot launch here`);
        const page = await stage(engine, c.html);
        try {
          if (c.prepare) await page.evaluate(c.prepare);
          assert.deepEqual(await page.evaluate(probe, { root: '#stage' }), []);
        } finally { await page.close(); }
      });
    }

    test(`a page wider than the viewport is a page-wide finding (${engineName})`, async (t) => {
      const engine = await get();
      if (!engine) return t.skip(`${engineName} cannot launch here`);
      const page = await stage(engine, `<div style="width:620px"><span class="k">A row far wider than the phone</span></div>`);
      try {
        const got = await page.evaluate(probe, null);
        const wide = got.filter((f) => f.kind === 'page-wide');
        assert.equal(wide.length, 1, JSON.stringify(got));
        assert.equal(wide[0].selector, 'html');
        assert.ok(wide[0].px >= 200, `px names how far the page runs past the viewport (${wide[0].px})`);
      } finally { await page.close(); }
    });

    test(`a page no wider than the viewport reports no page-wide finding (${engineName})`, async (t) => {
      const engine = await get();
      if (!engine) return t.skip(`${engineName} cannot launch here`);
      const page = await stage(engine, `<div class="bar"><span class="k">Owner</span></div>`);
      try {
        assert.deepEqual(await page.evaluate(probe, null), []);
      } finally { await page.close(); }
    });
  }

  test('the probe stays inside the root it is given', async () => {
    const page = await stage(browser, `<div class="bar"><span class="crumb-nm">Tasks</span><span class="toolbar" style="position:absolute;left:4px;top:6px">Activity</span></div><div class="other"><span class="x">quiet</span></div>`);
    try {
      assert.deepEqual(kinds(await page.evaluate(probe, '.other')), []);
      assert.deepEqual(kinds(await page.evaluate(probe, '.absent')), []);
      assert.deepEqual(kinds(await page.evaluate(probe, '#stage')), ['overlap']);
    } finally { await page.close(); }
  });

  test('the probe leaves nothing behind in the page', async () => {
    const page = await stage(browser, `<div class="bar"><span class="crumb-nm">Tasks</span><span class="toolbar" style="position:absolute;left:4px;top:6px">Activity</span></div>`);
    try {
      const before = await page.evaluate(() => document.querySelectorAll('*').length);
      await page.evaluate(probe, null);
      assert.equal(await page.evaluate(() => document.querySelectorAll('*').length), before);
    } finally { await page.close(); }
  });
}
