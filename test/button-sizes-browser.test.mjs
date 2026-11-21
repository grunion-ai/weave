import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { BUTTON_SIZES } from '../public/button-sizes.js';

const HELD = JSON.parse(readFileSync(new URL('./button-held.json', import.meta.url), 'utf8'));
let issues, row;
const s = await launch('button sizes', (weave) => {
  weave.createSpace({ name: 'Development', icon: 'lucide:code' });
  issues = weave.createTable({ space: 'Development', name: 'Issue', icon: 'lucide:bug', description: 'Defects and findings.' });
  weave.addField(issues, { name: 'Status', type: 'select', config: { options: ['Open', 'Fixed'] } });
  weave.addField(issues, { name: 'Due', type: 'date' });
  row = weave.createEntity(issues, { name: 'The header mixes button sizes', values: { Status: 'Open', Due: '2026-12-01' } });
  weave.createEntity(issues, { name: 'Second', values: { Status: 'Fixed' } });
});

export const fits = (b, rows = BUTTON_SIZES) => rows.some((r) => Math.abs(b.h - r.height) <= 0.5
  && Math.abs(b.pl - b.pr) <= 0.5 && (b.pl === 0 || Math.abs(b.pl - r.padX) <= 0.5));

test('fits: a button matches a row by height and by its horizontal padding, zero for a square (Feature #387)', () => {
  assert.ok(fits({ h: 28, pl: 0, pr: 0 }));
  assert.ok(fits({ h: 28, pl: 8, pr: 8 }));
  assert.ok(!fits({ h: 28, pl: 4, pr: 4 }), 'md pads 8');
  assert.ok(!fits({ h: 26, pl: 0, pr: 0 }), 'no 26 px step');
  assert.ok(!fits({ h: 28, pl: 8, pr: 10 }), 'one inset on both sides');
});

if (s) {
  const { base, browser } = s;
  const sweep = (page) => page.evaluate(() => {
    const keep = (c) => !/^(active|show|hue-|is-|btn-ghost|btn-outline)/.test(c);
    return [...document.querySelectorAll('button, .btn')].filter((n) => {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && !n.closest('.k, .vditor-toolbar');
    }).map((n) => {
      const cs = getComputedStyle(n);
      return {
        name: `${n.tagName.toLowerCase()}.${[...n.classList].filter(keep).join('.')}`,
        h: Math.round(n.getBoundingClientRect().height * 2) / 2, pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight),
      };
    });
  });
  const screens = (r) => [
    ['home', '#/'], ['table', `#/table/${issues.id}`], ['record', `#/table/${issues.id}?e=${r.id}`], ['page', `#/entity/${r.id}`],
  ];
  const offenders = async () => {
    const out = new Set();
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const [name, hash] of screens(row)) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        try {
          await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#main .view-header, #main .ws-home, #main');
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          for (const b of await sweep(page)) if (!fits(b)) out.add(`${name}@${w} ${b.name} ${b.h} px tall, padded ${b.pl}/${b.pr}`);
          if (name === 'table' && w === 1440) {
            await page.click('#main .table-view-btn');
            await page.waitForSelector('#view-pane:not([hidden]) .vp-acc');
            for (const b of await sweep(page)) if (!fits(b)) out.add(`view@${w} ${b.name} ${b.h} px tall, padded ${b.pl}/${b.pr}`);
          }
        } finally { await page.close(); }
      }
    }
    return [...out].sort();
  };

  test('every visible button on the main screens takes its height and padding from a row of the button table, or is held in test/button-held.json (Feature #387)', async () => {
    const seen = await offenders();
    const held = Object.keys(HELD.held).sort();
    const fresh = seen.filter((f) => !HELD.held[f]);
    const gone = held.filter((f) => !seen.includes(f));
    assert.deepEqual(fresh, [], `buttons that match no row of public/button-sizes.js; give each a step:\n${fresh.join('\n')}`);
    assert.deepEqual(gone, [], `held buttons that now match a row; drop them from test/button-held.json:\n${gone.join('\n')}`);
    for (const f of held) assert.match(String(HELD.held[f]), /^Issue #\d+$/, `${f} names the Issue that tracks it`);
  });
}
