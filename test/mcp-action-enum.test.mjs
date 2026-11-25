import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';
import { FAMILIES } from '../src/commands.js';

const tool = (name) => TOOLS.find((t) => t.name === name);
const offered = (family) => family.commands.filter((c) => !c.toolRefusal && typeof c.action === 'string').map((c) => c.action);

test('every listed tool with an action property declares an enum (Issue #1567)', () => {
  const bare = TOOLS.filter((t) => t.inputSchema?.properties?.action && !Array.isArray(t.inputSchema.properties.action.enum)).map((t) => t.name);
  assert.deepEqual(bare, []);
});

test('each family action enum is the list the dispatcher offers, so the two cannot drift (Issue #1567)', () => {
  let checked = 0;
  for (const [name, family] of FAMILIES) {
    if (!family.commands.every((c) => (c.actionArg ?? 'action') === 'action')) continue;
    const listed = tool(name);
    if (!listed) continue;
    assert.deepEqual(listed.inputSchema.properties.action.enum, offered(family), name);
    checked++;
  }
  assert.ok(checked >= 9, `checked ${checked} action families`);
});

test('an unknown action still answers the offered list, which matches the enum (Issue #1567)', () => {
  const w = new Weave();
  const enumed = tool('weave_views').inputSchema.properties.action.enum;
  assert.throws(() => dispatchTool(w, 'weave_views', { action: 'lsit' }), (e) => e.message.includes(`(${enumed.join(', ')})`));
});

test('a refused action stays out of the enum and still answers its refusal (Issue #1567)', () => {
  const keys = FAMILIES.get('weave_keys');
  const refused = keys.commands.filter((c) => c.toolRefusal).map((c) => c.action);
  assert.ok(refused.length > 0);
  for (const a of refused) assert.ok(!tool('weave_keys').inputSchema.properties.action.enum.includes(a), a);
  const reveal = keys.commands.find((c) => c.action === 'reveal');
  assert.throws(() => dispatchTool(new Weave(), 'weave_keys', { action: 'reveal', name: 'X' }), (e) => e.message === reveal.toolRefusal);
});

test('weave_stats where carries a type and a description (Issue #1567)', () => {
  const where = tool('weave_stats').inputSchema.properties.where;
  assert.deepEqual(where.type, ['array', 'object', 'null']);
  assert.match(where.description, /weave_query/);
});

test('every untyped weave_table_view layout key is defined in the tool description (Issue #1567)', () => {
  const { description, inputSchema } = tool('weave_table_view');
  const untyped = Object.entries(inputSchema.properties).filter(([, s]) => s.type === undefined).map(([k]) => k);
  assert.ok(untyped.length > 0);
  for (const key of untyped) assert.ok(description.includes(`${key}:`) || description.includes(`${key}.`), `${key} is defined in the description`);
});
