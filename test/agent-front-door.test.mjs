import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { Weave } from '../src/engine.js';
import { handleMcpMessage, startMcpServer, primer } from '../src/mcp.js';
import { startServer } from '../src/server.js';
import { renderBlocks, applyBlocks } from '../scripts/agent-docs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const PRIMER = read('src/mcp-primer.md');
const AGENTS = read('AGENTS.md');
const README = read('README.md');

const section = (doc, heading) => {
  const start = doc.indexOf(`\n## ${heading}\n`);
  if (start < 0) return null;
  const end = doc.indexOf('\n## ', start + 1);
  return doc.slice(start + 1, end < 0 ? undefined : end + 1);
};

test('the primer fits what Claude Code keeps and leads with the build', () => {
  assert.ok(PRIMER.length <= 2048, `the primer is ${PRIMER.length} characters; Claude Code keeps 2,048`);
  const first = PRIMER.split('\n')[0];
  assert.match(first, /weave_build/, 'line one names weave_build');
  assert.match(first, /dryRun/, 'line one names dryRun');
  const head = PRIMER.slice(0, 300);
  assert.ok(head.includes('weave_build') && head.includes('dryRun'), 'both in the first 300 characters');
  for (const [what, re] of [
    ['one workspace per domain, named as a slug', /slug/],
    ['a value naming another row is a relation', /relation/],
    ['colour carries meaning, slate otherwise', /slate/],
    ['icons come from the inventory, searched with weave_vocabulary', /weave_vocabulary/],
    ['date grain is a list', /\["year","month"\]/],
    ['replies are compact, verbose for the full object', /verbose:\s*true/],
    ['weave_call reaches the other tools', /weave_call/],
    ['a Sort is "Date desc" (Issue #626)', /"Date desc"/],
    ['a build needs no vocabulary call, at most optionColors and icons (Issue #625)', /optionColors/],
  ]) assert.match(PRIMER, re, `the primer says: ${what}`);
  assert.doesNotMatch(PRIMER, /—/, 'no em dashes');
});

test('initialize serves the primer as instructions (stdio handler)', () => {
  assert.equal(primer(), PRIMER, 'primer() reads the file');
  const r = handleMcpMessage(new Weave(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 't' } } });
  assert.equal(r.result.instructions, PRIMER);
});

test('the stdio server sends the primer on initialize', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  startMcpServer(new Weave(), { input, output });
  const reply = new Promise((resolve) => output.once('data', (d) => resolve(JSON.parse(String(d)))));
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  assert.equal((await reply).result.instructions, PRIMER);
});

test('POST /api/mcp sends the primer on initialize', async () => {
  const { server } = await startServer(new Weave(), { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 't' } } }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).result.instructions, PRIMER);
  } finally {
    server.close();
  }
});

test('AGENTS.md opens with Using weave, and the repo rules sit under Developing weave', () => {
  const headings = AGENTS.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  assert.equal(headings[0], 'Using weave', `the first section is Using weave, not ${headings[0]}`);
  const dev = AGENTS.indexOf('\n## Developing weave\n');
  assert.ok(dev > 0, 'AGENTS.md has a Developing weave section');
  for (const h of ['### Repo map', '### Rules for changing this repo']) {
    assert.ok(AGENTS.indexOf(`\n${h}\n`) > dev, `${h} sits under Developing weave`);
  }
});

test('Using weave carries the primer verbatim and stays a short read', () => {
  const using = section(AGENTS, 'Using weave');
  assert.ok(using, 'AGENTS.md has a Using weave section');
  assert.ok(using.includes('```text\n' + PRIMER.trimEnd() + '\n```'), 'the primer appears verbatim in a text fence');
  assert.ok(using.length <= 11000, `Using weave is ${using.length} bytes; keep the front door short`);
  for (const h of ['Model', 'Surfaces', 'Tool map', 'Plans', 'Pitfalls']) {
    assert.match(using, new RegExp(`\\n### ${h}\\n`), `Using weave has a ${h} part`);
  }
  assert.match(using, /weave mcp --data/, 'the stdio door and how to start it');
  assert.match(using, /POST \/api\/mcp/, 'the HTTP door');
  assert.match(using, /\/w\/<workspace>\/api/, 'the REST door');
  assert.match(using, /claude mcp add/, 'the Claude Code config');
  assert.match(using, /Sort reads[^\n]*Date desc/, 'the Sort pitfall names the accepted form (Issue #626)');
  assert.match(using, /Skip `weave_vocabulary`/, 'the build plan says most builds need no lookup (Issue #625)');
  assert.doesNotMatch(using, /—/, 'no em dashes in the new text');
});

test('the generated blocks in AGENTS.md are current (run node scripts/agent-docs.mjs)', () => {
  const blocks = renderBlocks();
  for (const [name, body] of Object.entries(blocks)) {
    const m = AGENTS.match(new RegExp(`<!-- ${name}:start[^>]*-->\\n([\\s\\S]*?)<!-- ${name}:end -->`));
    assert.ok(m, `AGENTS.md has the ${name} markers`);
    assert.equal(m[1], body, `the ${name} block is stale: run node scripts/agent-docs.mjs`);
  }
  assert.equal(applyBlocks(AGENTS), AGENTS, 'applying the blocks changes nothing');
});

test('the tool map names every tool once, default tools grouped by job', () => {
  const { 'tool-map': map } = renderBlocks();
  const names = [...map.matchAll(/`(weave_[a-z_]+)`/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length, `a tool appears twice: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
  for (const job of ['Build', 'Read and search', 'Write rows', 'Change schema', 'Look up allowed values', 'Everything else']) {
    assert.match(map, new RegExp(`\\| ${job}`), `the default map has a ${job} row`);
  }
});

test('the README points an agent at Using weave before the feature prose', () => {
  const at = README.indexOf('\n## For agents\n');
  assert.ok(at > 0, 'README has a For agents block');
  assert.ok(at < README.indexOf('\n## What weave is\n'), 'it comes before What weave is');
  const block = section(README, 'For agents');
  const lines = block.split('\n').filter((l) => l.trim()).length;
  assert.ok(lines <= 14, `the block is ${lines} lines`);
  assert.match(block, /weave mcp --data/);
  assert.match(block, /weave build/);
  assert.match(block, /AGENTS\.md#using-weave/);
});

test('CLAUDE.md routes a tool user to AGENTS.md before the maintainer rules', () => {
  const claude = read('CLAUDE.md');
  const head = claude.slice(0, claude.indexOf('\n## '));
  assert.match(head, /AGENTS\.md/);
  assert.match(head, /Using weave/);
  assert.match(claude, /## The weave-workspace mandate \(non-negotiable\)/, 'the maintainer rules stay');
});

test('llms.txt lists the agent quickstart first', () => {
  const first = read('llms.txt').split('\n').find((l) => l.startsWith('- ['));
  assert.match(first, /AGENTS\.md#using-weave/);
});
