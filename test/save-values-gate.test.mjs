import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fnBody, read } from './lib/source.mjs';

const WRITE = /api\(\s*'PATCH',\s*`\/entities\/\$\{[^}]+\}`/g;
const files = readdirSync(new URL('../public/', import.meta.url)).filter((f) => f.endsWith('.js'));

test('every record PATCH in the client goes through saveValues or the save queue, so a stale write from any control repaints and offers Use mine (Issue #1689)', () => {
  const sites = files.flatMap((f) => [...read(`public/${f}`).matchAll(WRITE)].map((m) => `${f}: ${read(`public/${f}`).slice(m.index, m.index + 60)}`));
  const helper = [...fnBody('saveValues').matchAll(WRITE)].length;
  const queue = /send:\s*\(j\)\s*=>\s*api\('PATCH',\s*`\/entities\/\$\{j\.entityId\}`/.test(read('public/app.js')) ? 1 : 0;
  assert.equal(helper, 1, 'saveValues owns the record PATCH');
  assert.equal(queue, 1, 'the cell save queue keeps its own send, whose failures editorFor answers');
  assert.equal(sites.length, helper + queue, `a record PATCH bypasses saveValues:\n${sites.join('\n')}`);
});

test('the save queue and saveValues answer a stale write with one shared toast', () => {
  assert.match(fnBody('saveValues'), /staleToast\(/, 'saveValues raises the stale toast');
  assert.match(fnBody('editorFor'), /staleToast\(/, 'and so does the cell editor');
  assert.match(fnBody('staleToast'), /Use mine/, 'which offers mine back');
});
