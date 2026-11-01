import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const WORDS = 'Personal Workspace for the Quarterly Planning Offsite Team';
const IPHONE = phoneProfile()?.page ?? null;
const workspace = new Weave();
workspace.state.meta.name = 'scratch';

const s = await launch('phone crumb copy target', (weave) => {
  weave.state.meta.name = 'main';
  weave.markOnboarded();
  workspace.markOnboarded();
  workspace.createSpace({ name: 'Development' });
  workspace.createTable({ space: 'Development', name: 'Issue' });
}, { server: () => ({ workspaces: { scratch: workspace } }) });
if (s) {
  const { browser } = s;
  const base = `${s.base}/w/${workspace.state.meta.id}`;
  const rename = async (name) => {
    const res = await fetch(`${base}/api/workspace`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    assert.equal(res.ok, true, await res.text());
  };
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  for (const [engine, b, profile] of engines) {
    test(`on a phone Copy permalink keeps 44px clear of the header dots at every workspace name length (${engine}, Issue #853)`, async () => {
      const page = await b.newPage(profile);
      const short = [];
      try {
        for (let n = 12; n <= 40; n++) {
          const name = WORDS.slice(0, n).trim();
          await rename(name);
          await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#main .crumb-row > .dl-wrap .dots-btn');
          const got = await page.evaluate(() => {
            const copy = document.querySelector('#main .crumb-copy');
            const r = copy.getBoundingClientRect();
            const cy = r.top + r.height / 2;
            let right = 0;
            let taker = '';
            for (let d = 0.5; d <= 22; d += 0.5) {
              const hit = document.elementFromPoint(r.left + r.width / 2 + d, cy);
              if (!hit || !(hit === copy || copy.contains(hit))) { taker = hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing'; break; }
              right = d;
            }
            return { right, taker };
          });
          if (got.right < 21.5) short.push(`"${name}": ${got.right}px right of centre before ${got.taker} takes the tap`);
        }
      } finally {
        await page.close();
        await rename('Personal Workspace');
      }
      assert.deepEqual(short, [], `Copy permalink loses its 44px target for ${short.length} name lengths:\n${short.join('\n')}`);
    });
  }
}
