import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from './lib/browser.mjs';
import { tempDir } from './lib/temp.mjs';

const ROOT = join(import.meta.dirname, '..');
const DOC = ['# Spec', '', 'Blocked by [[Task#1]].', '', '```mermaid', 'graph LR', '  A --> B', '```', '', '```js', 'const x = 1;', '```', ''].join('\n');

if (!chromium) {
  test('an exported document keeps its chips on disk (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  const dir = tempDir('wv-export-1600-');
  const data = join(dir, 'w.db');
  const cli = (...args) => execFileSync(process.execPath, ['bin/weave.js', '--data', data, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  cli('space', 'create', 'Work');
  cli('table', 'create', 'Work', 'Task');
  cli('create', 'Task', 'Upstream');
  cli('create', 'Task', 'Spec');
  cli('doc', 'set', 'Task#2', '--content', DOC);
  const page = join(dir, 'spec.html');
  cli('doc', 'export', 'Task#2', '--format', 'html', '--out', page);
  const href = pathToFileURL(page).href;
  const browser = await chromium.launch();
  test.after(() => browser.close());

  test('a CLI export opened from disk keeps its chip outline and says what it cannot draw (Issue #1600)', async () => {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme: scheme });
      const tab = await context.newPage();
      const missed = [];
      tab.on('requestfailed', (r) => missed.push(r.url()));
      tab.on('response', (r) => { if (r.status() >= 400) missed.push(r.url()); });
      await tab.goto(href);
      const chip = tab.locator('.k-rel').first();
      await chip.waitFor({ state: 'attached' });
      const paint = await chip.evaluate((node) => {
        const cs = getComputedStyle(node);
        return { width: cs.borderTopWidth, colour: cs.borderTopColor, radius: cs.borderTopLeftRadius };
      });
      assert.equal(paint.width, '1px', `${scheme}: the chip outline needs chip.css in the file, not on a server`);
      assert.notEqual(paint.colour, 'rgba(0, 0, 0, 0)', `${scheme}: the outline is drawn, not transparent`);
      assert.equal(paint.radius, '4px', `${scheme}: the outline is the chip's own rounded one`);
      assert.equal(await tab.locator('p.wv-export-note').count(), 1, `${scheme}: the page names the diagram and highlighting it carries no bundles for`);
      assert.deepEqual(missed, [], `${scheme}: an export off its origin must request nothing it cannot have`);
      await context.close();
    }
  });
}
