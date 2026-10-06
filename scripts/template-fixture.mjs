#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { templateDoc } from '../src/engine.js';

const arg = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const base = arg('--base', 'http://127.0.0.1:4400/w/weave').replace(/\/+$/, '');
const space = arg('--space', 'CRM');
const slug = space.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = arg('--out', fileURLToPath(new URL(`../test/fixtures/templates/${slug}.json`, import.meta.url)));

const res = await fetch(`${base}/api/schema`);
if (!res.ok) {
  console.error(`GET ${base}/api/schema answered ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const entry = (await res.json()).find((s) => s.space === space);
if (!entry) {
  console.error(`${base} has no space named '${space}'`);
  process.exit(1);
}
if (!entry.template) console.error(`warning: '${space}' is not marked as a template on ${base}`);
const { doc, skipped } = templateDoc(entry, { name: space });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`${out}: ${doc.tables.length} tables, ${doc.tables.reduce((n, t) => n + t.fields.length, 0)} fields${skipped.length ? `, ${skipped.length} skipped (relations leaving the space)` : ''}`);
