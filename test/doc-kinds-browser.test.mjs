import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

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
  const sectionOf = (name) => `.doc-section:has(.doc-section-name:text-is("${name}"))`;

  test('a sniffed mermaid document draws as a diagram, with the source one toggle away', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    const sec = sectionOf('Diagram');
    await page.waitForSelector(`${sec} .doc-diagram pre.mermaid`, { timeout: 20000 });
    assert.equal(await page.$(`${sec} .vditor-ir`), null, 'no markdown editor on a diagram');
    await page.waitForSelector(`${sec} .doc-diagram svg`, { timeout: 20000 });
    const nodes = await page.$$eval(`${sec} .doc-diagram svg .node`, (ns) => ns.length);
    assert.ok(nodes >= 3, `the three nodes are drawn (${nodes})`);
    await page.click(`${sec} .doc-anchor[title="Edit source"]`);
    await page.waitForSelector(`${sec} textarea.doc-source`, { state: 'visible', timeout: 20000 });
    const src = await page.$eval(`${sec} textarea.doc-source`, (t) => t.value);
    assert.ok(src.startsWith('flowchart TD'), 'the code box holds the mermaid source');
    const drawingHidden = await page.$eval(`${sec} .doc-diagram`, (d) => d.classList.contains('hidden'));
    assert.ok(drawingHidden, 'the drawing steps aside while the source is edited');
    await page.close();
  });

  test('a sniffed JSON model edits in the code box, never as prose', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    const sec = sectionOf('Data');
    await page.waitForSelector(`${sec} textarea.doc-source`, { timeout: 20000 });
    assert.equal(await page.$(`${sec} .vditor-ir`), null, 'no markdown editor on a model');
    const v = await page.$eval(`${sec} textarea.doc-source`, (t) => t.value);
    assert.ok(v.includes('"nodes": ["field", "sniff"]'), 'the box holds the JSON verbatim, indentation and all');
    await page.close();
  });
}
