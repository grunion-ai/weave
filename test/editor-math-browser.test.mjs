import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch } from './lib/browser.mjs';
import { FORMATTING_SAMPLES } from '../src/handbook.js';

let id;
const doc = FORMATTING_SAMPLES.map((sample) => sample.doc).join('\n\n');
const s = await launch('math renders without a rejection', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  const t = weave.createTable({ space: 'Showcase', name: 'Formatting' });
  id = weave.createEntity(t, { name: 'Every construct on one page', doc }).id;
});

if (s) {
  const { base, browser } = s;
  const engines = [['default', browser]];
  if (process.env.WEAVE_BROWSER !== 'webkit') {
    const webkit = await engineOf('webkit');
    if (webkit) engines.push(['webkit', webkit]);
  }

  const load = async (b) => {
    const page = await b.newPage({ viewport: { width: 2022, height: 1210 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.language-math[data-math]').length > 0,
      null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const rendered = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.language-math')];
      const skipped = (n) => ['vditor-wysiwyg__pre', 'vditor-ir__marker--pre']
        .some((c) => n.parentElement?.classList.contains(c));
      const eligible = nodes.filter((n) => !skipped(n));
      return {
        total: nodes.length,
        eligible: eligible.length,
        typeset: eligible.filter((n) => n.querySelector('.katex')).length,
        broken: nodes.filter((n) => n.classList.contains('vditor-reset--error')).length,
      };
    });
    await page.close();
    return { errors, rendered };
  };

  for (const [name, b] of engines) {
    test(`${name}: the showcase page loads math with no unhandled rejection (Issue #470)`, async () => {
      for (let run = 1; run <= 2; run++) {
        const { errors, rendered } = await load(b);
        assert.deepEqual(errors, [], `run ${run} raised a page error`);
        assert.ok(rendered.total > 0, `run ${run} found no math nodes`);
        assert.equal(rendered.broken, 0, `run ${run} left a math node in the error state`);
        assert.ok(rendered.eligible > 0, `run ${run} found no math node Vditor would typeset`);
        assert.equal(rendered.typeset, rendered.eligible,
          `run ${run} typeset ${rendered.typeset} of ${rendered.eligible} eligible math nodes: the guard skips only what left the document`);
      }
    });
  }
}
