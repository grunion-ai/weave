import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf } from './lib/browser.mjs';
import { probe } from './lib/cutoff.mjs';

const LONG = 'A label long enough that no narrow box can hold it on one line';
const PAGE = `<!doctype html><html><head><style>
  html, body { margin: 0; font: 14px/20px -apple-system, "Helvetica Neue", Arial, sans-serif; }
  body { overflow: hidden; height: 100vh; }
  .one { white-space: nowrap; }
</style></head><body><div id="stage"></div></body></html>`;

const s = await launch('cutoff probe');

if (s) {
  const { browser } = s;
  const engines = { chromium: async () => browser, webkit: () => engineOf('webkit') };

  const stage = async (engine, html) => {
    const page = await engine.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent(PAGE);
    await page.evaluate((h) => { document.getElementById('stage').innerHTML = h; }, html);
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  const findings = async (engine, html, prepare) => {
    const page = await stage(engine, html);
    try {
      if (prepare) await page.evaluate(prepare);
      return await page.evaluate(probe, '#stage');
    } finally { await page.close(); }
  };
  const kinds = (got) => got.map((f) => f.kind);

  const FLAGGED = [
    {
      name: 'text cut by its overflow-hidden box is clipped (rule 1)',
      html: `<div class="box one" style="width:120px;overflow:hidden"><span class="t">${LONG}</span></div>`,
      want: 'clipped', selector: /div\.box\.one > span\.t$/,
    },
    {
      name: 'text cut by a farther overflow-hidden ancestor is clipped (rule 1)',
      html: `<div class="outer" style="width:120px;overflow:hidden"><div class="inner one" style="width:600px"><span class="t">${LONG}</span></div></div>`,
      want: 'clipped', selector: /span\.t$/,
    },
    {
      name: 'wrapped lines cut by a fixed height are clipped (rule 1)',
      html: `<div class="box" style="width:120px;height:20px;overflow:hidden">${LONG}</div>`,
      want: 'clipped', selector: /div\.box$/,
    },
    {
      name: 'overflow: clip on one axis still cuts (rule 1)',
      html: `<div class="box one" style="width:120px;overflow-x:clip">${LONG}</div>`,
      want: 'clipped', selector: /div\.box\.one$/,
    },
    {
      name: 'a truncated ellipsis box is an ellipsis, counted once (rule 2)',
      html: `<div class="box one" style="width:120px;overflow:hidden;text-overflow:ellipsis">${LONG}</div>`,
      want: 'ellipsis', selector: /div\.box\.one$/,
    },
    {
      name: 'an ellipsis box whose text sits in a child is one ellipsis on the box (rule 2)',
      html: `<div class="box one" style="width:120px;overflow:hidden;text-overflow:ellipsis"><span class="label">${LONG}</span></div>`,
      want: 'ellipsis', selector: /div\.box\.one$/,
    },
    {
      name: 'a line-clamped box with more lines than the clamp is a line-clamp (rule 3)',
      html: `<div class="box" style="width:120px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${LONG} ${LONG}</div>`,
      want: 'line-clamp', selector: /div\.box$/,
    },
    {
      name: 'an input whose value is wider than the input is a field-value (rule 4)',
      html: `<input class="f" style="width:90px" value="${LONG}">`,
      want: 'field-value', selector: /input\.f$/,
    },
    {
      name: 'a textarea whose value runs past its rows is a field-value (rule 4)',
      html: `<textarea class="f" rows="1" style="width:120px">${LONG} ${LONG}</textarea>`,
      want: 'field-value', selector: /textarea\.f$/,
    },
    {
      name: 'an empty input whose placeholder is wider than the input is a field-placeholder (rule 5)',
      html: `<input class="f" style="width:90px" placeholder="${LONG}">`,
      want: 'field-placeholder', selector: /input\.f$/,
    },
    {
      name: 'an empty textarea whose placeholder wraps past its height is a field-placeholder (rule 5)',
      html: `<textarea class="field-desc" style="width:160px;height:58px;padding:8px 12px" placeholder="What this field holds and how it is written — shown under the label and to agents in the schema"></textarea>`,
      want: 'field-placeholder', selector: /textarea\.field-desc$/,
    },
  ];

  const QUIET = [
    {
      name: 'the skip link parked above the viewport',
      html: `<a class="skip-link" href="#main" style="position:fixed;left:12px;top:-48px;padding:8px 14px">Skip to content</a>`,
    },
    {
      name: 'a skip link parked above its overflow-hidden parent',
      html: `<div style="position:relative;height:200px;overflow:hidden"><a class="skip-link" href="#main" style="position:absolute;left:12px;top:-48px;padding:8px 14px">Skip to content</a></div>`,
    },
    {
      name: 'a 1px clip-rect visually-hidden label',
      html: `<span class="sr-only" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">${LONG}</span>`,
    },
    {
      name: 'a clip-path visually-hidden label',
      html: `<span class="vh" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap">${LONG}</span>`,
    },
    {
      name: 'text inside an overflow:auto container',
      html: `<div class="one" style="width:120px;overflow:auto">${LONG}</div>`,
    },
    {
      name: 'text inside an overflow:scroll container that sits in an overflow-hidden box',
      html: `<div style="width:300px;overflow:hidden"><div class="one" style="width:120px;overflow-x:scroll"><span>${LONG}</span></div></div>`,
    },
    {
      name: 'a cut box hidden by visibility',
      html: `<div class="one" style="width:120px;overflow:hidden;visibility:hidden">${LONG}</div><input style="width:90px;visibility:hidden" value="${LONG}">`,
    },
    {
      name: 'a cut box under an ancestor at zero opacity',
      html: `<div style="opacity:0"><div class="one" style="width:120px;overflow:hidden;text-overflow:ellipsis">${LONG}</div><input style="width:90px" placeholder="${LONG}"></div>`,
    },
    {
      name: 'a cut box that is display:none',
      html: `<div class="one" style="width:120px;overflow:hidden;display:none">${LONG}</div>`,
    },
    {
      name: 'text, a value and a placeholder that each fit exactly',
      html: `<div class="exact one" style="overflow:hidden;text-overflow:ellipsis;display:inline-block"><span>${LONG}</span></div>
        <div class="exact-clip one" style="overflow:hidden;display:inline-block"><span>${LONG}</span></div>
        <input class="exact-in" style="box-sizing:content-box;padding:2px;border:1px solid" value="${LONG}">
        <input class="exact-ph" style="box-sizing:content-box;padding:2px;border:1px solid" placeholder="${LONG}">
        <textarea style="width:220px;height:400px" placeholder="${LONG}"></textarea>`,
      prepare: () => {
        for (const box of document.querySelectorAll('.exact, .exact-clip')) box.style.width = `${Math.ceil(box.firstElementChild.getBoundingClientRect().width)}px`;
        const m = document.createElement('span');
        m.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        document.body.append(m);
        for (const f of document.querySelectorAll('.exact-in, .exact-ph')) {
          const cs = getComputedStyle(f);
          m.style.font = cs.font;
          m.style.letterSpacing = cs.letterSpacing;
          m.textContent = f.value || f.placeholder;
          f.style.width = `${Math.ceil(m.getBoundingClientRect().width)}px`;
        }
        m.remove();
      },
    },
  ];

  for (const [engineName, get] of Object.entries(engines)) {
    for (const c of FLAGGED) {
      test(`${c.name} (${engineName})`, async (t) => {
        const engine = await get();
        if (!engine) return t.skip(`${engineName} cannot launch here`);
        const got = await findings(engine, c.html);
        assert.deepEqual(kinds(got), [c.want], JSON.stringify(got));
        assert.match(got[0].selector, c.selector);
        assert.ok(got[0].px > 1, `px names how far it is cut (${got[0].px})`);
        assert.ok(got[0].text.length > 0 && got[0].text.length <= 60, 'text is a short excerpt');
      });
    }
    for (const c of QUIET) {
      test(`${c.name} is not a cut-off (${engineName})`, async (t) => {
        const engine = await get();
        if (!engine) return t.skip(`${engineName} cannot launch here`);
        assert.deepEqual(await findings(engine, c.html, c.prepare), []);
      });
    }
  }

  test('the probe reads the whole page when it is given no root', async () => {
    const page = await stage(browser, `<div class="box one" style="width:120px;overflow:hidden">${LONG}</div>`);
    try {
      const got = await page.evaluate(probe);
      assert.deepEqual(kinds(got), ['clipped']);
      assert.match(got[0].selector, /^div#stage > div\.box\.one$/);
    } finally { await page.close(); }
  });

  test('the probe stays inside the root it is given', async () => {
    const page = await stage(browser, `<div class="box one" style="width:120px;overflow:hidden">${LONG}</div><div class="pop"><input style="width:90px" value="${LONG}"></div>`);
    try {
      assert.deepEqual(kinds(await page.evaluate(probe, '.pop')), ['field-value']);
      assert.deepEqual(await page.evaluate(probe, '.absent'), []);
    } finally { await page.close(); }
  });

  test('the placeholder mirror leaves nothing behind in the page', async () => {
    const page = await stage(browser, `<input style="width:90px" placeholder="${LONG}">`);
    try {
      const before = await page.evaluate(() => document.querySelectorAll('*').length);
      await page.evaluate(probe);
      assert.equal(await page.evaluate(() => document.querySelectorAll('*').length), before);
    } finally { await page.close(); }
  });
}
