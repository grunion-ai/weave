import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'weave-logo-tool-'));
process.env.WEAVE_KEYSTORE = join(dir, 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { TOOLS, dispatchTool } = await import('../../src/mcp.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
const tool = TOOLS.find((t) => t.name === 'weave_workspace');

test('the workspace tool advertises no mime argument, since a logo is typed from its bytes', () => {
  assert.equal(tool.inputSchema.properties.mime, undefined, 'the schema still lists mime');
  assert.doesNotMatch(tool.description, /\bmime\b/i, 'the description still names mime');
});

test('a logo set through the tool is typed from its bytes whatever the caller says', () => {
  const w = new Weave();
  const set = dispatchTool(w, 'weave_workspace', { action: 'logo', name: 'mark.png', contentBase64: PNG });
  assert.equal(set.mime, 'image/png');
  const lied = dispatchTool(w, 'weave_workspace', { action: 'logo', name: 'mark.png', mime: 'text/html', contentBase64: PNG });
  assert.equal(lied.mime, 'image/png');
  assert.equal(w.state.meta.logo.mime, 'image/png');
});
