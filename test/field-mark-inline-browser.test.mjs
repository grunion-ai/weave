import test from 'node:test';
import assert from 'node:assert/strict';
import { APP } from './lib/source.mjs';
import { launch } from './lib/browser.mjs';

test('field marks are inline spans, never superscripts', () => {
  assert.doesNotMatch(APP, /el\('sup', \{ class: 'field-mark'/, 'no field mark is a <sup>');
});

let deals, acme;
const s = await launch('field mark inline', (weave) => {
  weave.createSpace({ name: 'Sales' });
  const companies = weave.createTable({ space: 'Sales', name: 'Company' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addRelation(deals, { name: 'Company', targetDb: companies, cardinality: 'many-to-one', inverseName: 'Deals' });
  weave.addField(deals, { name: 'Company name', type: 'lookup', config: { relationField: 'Company', targetField: 'Name' } });
  weave.addField(deals, { name: 'Double', type: 'formula', config: { expression: 'Amount * 2' } });
  const ini = weave.createEntity(companies, { name: 'Initech' });
  acme = weave.createEntity(deals, { name: 'Acme', values: { Amount: 3, Company: ini.id } });
});

const geometry = (label) => {
  const mark = label.querySelector('.field-mark');
  const text = [...label.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  const range = document.createRange();
  range.selectNodeContents(text);
  const t = range.getBoundingClientRect();
  const m = mark.getBoundingClientRect();
  const glyph = (mark.querySelector('svg') ?? mark).getBoundingClientRect();
  return {
    tag: mark.tagName.toLowerCase(),
    title: mark.getAttribute('title'),
    textMid: t.top + t.height / 2,
    markMid: glyph.top + glyph.height / 2,
    gap: m.left - t.right,
    icon: mark.querySelector('svg') ? Math.round(glyph.width) : null,
    inside: m.top >= t.top - 1 && m.bottom <= t.bottom + 1,
    color: getComputedStyle(mark).color,
    muted: (() => {
      const probe = document.body.appendChild(Object.assign(document.createElement('span'), { style: 'color: var(--tblr-secondary)' }));
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    })(),
  };
};

if (s) {
  const { base, browser } = s;
  for (const colorScheme of ['light', 'dark']) {
    test(`a column header's relation and computed marks sit on the label's centre line (${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-grid thead th.col-head[data-col="Company"] .field-mark');
        for (const col of ['Company', 'Company name', 'Double']) {
          const g = await page.locator(`.wv-grid thead th.col-head[data-col="${col}"] .col-label`).evaluate(geometry);
          assert.equal(g.tag, 'span', `${col}: the mark is an inline span`);
          assert.ok(g.title, `${col}: the mark keeps its tooltip`);
          assert.ok(Math.abs(g.markMid - g.textMid) <= 1, `${col}: mark centre ${g.markMid} vs label centre ${g.textMid}`);
          assert.ok(g.inside, `${col}: the mark stays inside the label's line`);
          assert.ok(g.gap >= 3 && g.gap <= 6, `${col}: about 4px after the label, got ${g.gap}`);
          assert.equal(g.color, g.muted, `${col}: the mark is muted`);
          if (g.icon != null) assert.equal(g.icon, 12, `${col}: the icon is --wv-icon-sm`);
        }
      } finally { await page.close(); }
    });
  }

  test('an entity page field label carries the same inline mark', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
      const label = page.locator('.fieldrow-label', { has: page.locator('.field-mark') }).first();
      await label.waitFor();
      const g = await label.evaluate(geometry);
      assert.equal(g.tag, 'span');
      assert.ok(Math.abs(g.markMid - g.textMid) <= 1, `mark centre ${g.markMid} vs label centre ${g.textMid}`);
    } finally { await page.close(); }
  });
}
