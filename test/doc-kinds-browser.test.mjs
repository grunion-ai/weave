import test from 'node:test';
import assert from 'node:assert/strict';
import { eventually, launch, painted } from './lib/browser.mjs';

const MMD = 'flowchart TD\n  F[document field] -->|declared kind?| D{config.kind}\n  D -->|unset| S{sniff}\n';
const JSON_MODEL = '{\n  "graph": "flowchart TD",\n  "nodes": ["field", "sniff"],\n  "edges": 2\n}\n';

let table, row;
const s = await launch('document kinds', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  table = weave.createTable({ space: 'Scratch', name: 'Doc' });
  weave.addField(table, { name: 'Diagram', type: 'document' });
  weave.addField(table, { name: 'Data', type: 'document' });
  row = weave.createEntity(table, { name: 'Sniffed' });
  weave.setDoc(row.id, MMD, 'Diagram');
  weave.setDoc(row.id, JSON_MODEL, 'Data');
});

if (s) {
  const { base, browser } = s;
  const DRAW_BUDGET = 60000;
  const sectionOf = (name) => `.doc-section:has(.doc-section-name:text-is("${name}"))`;

  test('a sniffed mermaid document draws as a diagram, with the source one toggle away', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    const sec = sectionOf('Diagram');
    await painted(page, `${sec} .doc-diagram pre.mermaid`, { timeout: DRAW_BUDGET });
    assert.equal(await page.$(`${sec} .vditor-ir`), null, 'no markdown editor on a diagram');
    await painted(page, `${sec} .doc-diagram svg`, { timeout: DRAW_BUDGET });
    const nodes = await page.$$eval(`${sec} .doc-diagram svg .node`, (ns) => ns.length);
    assert.ok(nodes >= 3, `the three nodes are drawn (${nodes})`);
    await page.click(`${sec} .doc-anchor[title="Edit source"]`);
    await painted(page, `${sec} textarea.doc-source`, { state: 'visible' });
    const src = await page.locator(`${sec} textarea.doc-source`).first().evaluate((t) => t.value);
    assert.ok(src.startsWith('flowchart TD'), 'the code box holds the mermaid source');
    const drawingHidden = await page.$eval(`${sec} .doc-diagram`, (d) => d.classList.contains('hidden'));
    assert.ok(drawingHidden, 'the drawing steps aside while the source is edited');
    await page.close();
  });

  test('the keyboard toggles the diagram source, and the source editor takes the focus', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    const sec = sectionOf('Diagram');
    await painted(page, `${sec} .doc-diagram svg`, { timeout: DRAW_BUDGET });
    const toggle = page.locator(`${sec} .doc-anchor[aria-pressed]`).first();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'the toggle starts unpressed');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await painted(page, `${sec} textarea.doc-source`, { state: 'visible' });
    await eventually(() => toggle.getAttribute('aria-pressed'), 'true', { timeout: 5000 });
    const shown = await toggle.evaluate((b) => ({ label: b.getAttribute('aria-label'), title: b.title }));
    assert.match(shown.label, /^Hide Diagram source$/, 'the label names hiding the source while the source shows');
    assert.equal(shown.title, 'Hide source', 'so does the tooltip');
    const inEditor = await page.locator(`${sec} textarea.doc-source`).first().evaluate((ta) => document.activeElement === ta);
    assert.ok(inEditor, 'the keypress leaves the caret in the source the keypress revealed');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await painted(page, `${sec} .doc-diagram svg`, { timeout: DRAW_BUDGET });
    await eventually(() => toggle.getAttribute('aria-pressed'), 'false', { timeout: 5000 });
    const back = await toggle.evaluate((b) => ({ label: b.getAttribute('aria-label'), title: b.title, focused: document.activeElement === b }));
    assert.equal(back.label, 'Edit Diagram source', 'the label names editing again');
    assert.equal(back.title, 'Edit source', 'so does the tooltip');
    assert.ok(back.focused, 'focus lands back on the toggle a keyboard user can carry on from');
    await page.close();
  });

  test('a sniffed JSON model edits in the code box, never as prose', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    const sec = sectionOf('Data');
    await painted(page, `${sec} textarea.doc-source`);
    assert.equal(await page.$(`${sec} .vditor-ir`), null, 'no markdown editor on a model');
    const v = await page.locator(`${sec} textarea.doc-source`).first().evaluate((t) => t.value);
    assert.ok(v.includes('"nodes": ["field", "sniff"]'), 'the box holds the JSON verbatim, indentation and all');
    await page.close();
  });
}
