import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import { tempDir } from './lib/temp.mjs';

const SPACES = 105;

function busy(w) {
  for (let i = 0; i < SPACES; i++) w.createSpace({ name: `S${i}` });
  return w;
}

for (const [label, open] of [
  ['in memory', () => ({ w: busy(new Weave()), done() {} })],
  ['on disk', () => {
    const dir = tempDir('weave-audit-limit-');
    const w = busy(new Weave({ path: join(dir, 'w.db') }));
    return { w, done() { w.close?.(); rmSync(dir, { recursive: true, force: true }); } };
  }],
]) {
  test(`weave_audit with no limit answers the default page, ${label}`, () => {
    const { w, done } = open();
    try {
      const total = w.listAudit({ limit: -1 }).length;
      assert.ok(total > 100, `the fixture holds more rows than one page (${total})`);
      assert.equal(dispatchTool(w, 'weave_audit', {}).events.length, 100, 'no limit argument answers the default page');
      assert.equal(dispatchTool(w, 'weave_audit', { limit: null }).events.length, 100, 'an explicit null limit answers the default page');
      assert.equal(dispatchTool(w, 'weave_audit', { limit: 5 }).events.length, 5, 'a page size is honoured');
      assert.equal(dispatchTool(w, 'weave_audit', { limit: -1 }).events.length, total, '-1 still reads every row');
    } finally {
      done();
    }
  });
}
