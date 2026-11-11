import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';

function busy() {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'Task' });
  w.addField(t.id, { name: 'Note', type: 'text' });
  for (let i = 0; i < 6; i++) w.createEntity(t.id, { Name: `r${i}`, Note: 'a' });
  return { w, t };
}

test('many entries share one timestamp, so a ts cursor cannot page the feed', () => {
  const { w } = busy();
  const all = w.activityFeed({ limit: -1 }).items;
  const byTs = new Map();
  for (const r of all) byTs.set(r.ts, (byTs.get(r.ts) ?? 0) + 1);
  assert.ok(Math.max(...byTs.values()) > 1, 'the fixture shares a timestamp across entries');
  const newest = all[0];
  const repeat = w.activityFeed({ since: newest.ts, limit: -1 }).items;
  assert.ok(repeat.some((r) => r.id === newest.id), 'since by ts hands the cursor entry back');
});

test('sinceSeq pages the feed with every entry exactly once', () => {
  const { w } = busy();
  const all = w.activityFeed({ limit: -1 }).items;
  const seen = [];
  let cursor = 0;
  for (let guard = 0; guard < 50; guard++) {
    const page = w.activityFeed({ sinceSeq: cursor, limit: 20 });
    if (!page.items.length) break;
    seen.push(...page.items.map((r) => r.id));
    assert.equal(typeof page.nextSeq, 'number');
    assert.ok(page.nextSeq > cursor, 'the cursor advances');
    cursor = page.nextSeq;
  }
  assert.deepEqual([...seen].sort(), all.map((r) => r.id).sort());
  assert.equal(new Set(seen).size, seen.length, 'no entry is returned twice');
});

test('a page in seq order answers oldest first, so a caller can replay it', () => {
  const { w } = busy();
  const page = w.activityFeed({ sinceSeq: 0, limit: 10 });
  const seqs = page.items.map((r) => r.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(page.nextSeq, Math.max(...seqs));
});

test('a caller that is caught up stays caught up', () => {
  const { w } = busy();
  const top = Math.max(...w.activityFeed({ limit: -1 }).items.map((r) => r.seq ?? 0));
  const page = w.activityFeed({ sinceSeq: top, limit: 20 });
  assert.deepEqual(page.items, []);
  assert.equal(page.nextSeq, top);
});

test('an entry written before #282 carries no seq: a first read returns it, a sinceSeq read does not', () => {
  const { w, t } = busy();
  const row = w.createEntity(t.id, { Name: 'legacy' });
  const e = w.state.entities[row.id];
  e.activity.push({ kind: 'field-updated', ts: '2020-01-01T00:00:00.000Z', actor: 'local', detail: { field: 'Note' } });
  const bare = w.activityFeed({ limit: -1 }).items;
  assert.ok(bare.some((r) => r.ts === '2020-01-01T00:00:00.000Z'), 'a first read returns it');
  const cursored = w.activityFeed({ sinceSeq: 0, limit: -1 }).items;
  assert.ok(!cursored.some((r) => r.ts === '2020-01-01T00:00:00.000Z'), 'a sinceSeq read leaves it behind');
});

test('since keeps its meaning beside sinceSeq', () => {
  const { w, t } = busy();
  const mark = w.activityFeed({ limit: 1 }).items[0].ts;
  w.createEntity(t.id, { Name: 'later' });
  const bySince = w.activityFeed({ since: mark, limit: -1 }).items;
  assert.ok(bySince.length > 0);
  assert.ok(bySince.every((r) => r.ts >= mark));
});

test('the CLI, the route and the MCP tool answer the same page and the same nextSeq', () => {
  const { w } = busy();
  const direct = w.activityFeed({ sinceSeq: 0, limit: 5 });
  const tool = dispatchTool(w, 'weave_activity', { sinceSeq: 0, limit: 5 });
  assert.deepEqual(tool.items.map((r) => r.id), direct.items.map((r) => r.id));
  assert.equal(tool.nextSeq, direct.nextSeq);
});

test('GET /api/activity?sinceSeq= pages without a repeat or a gap, and hands back nextSeq', async () => {
  const { startServer } = await import('../src/server.js');
  const { w } = busy();
  const all = w.activityFeed({ limit: -1 }).items;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const seen = [];
    let cursor = 0;
    for (let guard = 0; guard < 50; guard++) {
      const page = await fetch(`${base}/api/activity?sinceSeq=${cursor}&limit=20`).then((r) => r.json());
      if (!page.items.length) break;
      seen.push(...page.items.map((r) => r.id));
      assert.ok(page.nextSeq > cursor, 'the route advances the cursor');
      cursor = page.nextSeq;
    }
    assert.deepEqual([...seen].sort(), all.map((r) => r.id).sort());
    assert.equal(new Set(seen).size, seen.length, 'the route repeats nothing');
    const caught = await fetch(`${base}/api/activity?sinceSeq=${cursor}`).then((r) => r.json());
    assert.deepEqual(caught.items, []);
    assert.equal(caught.nextSeq, cursor);
    const plain = await fetch(`${base}/api/activity?limit=5`).then((r) => r.json());
    assert.equal(plain.nextSeq, undefined, 'a read with no cursor keeps its old shape');
    assert.equal(plain.items.length, 5);
  } finally {
    server.close();
  }
});

test('the CLI prints the same page and the same nextSeq as the route', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const data = join(mkdtempSync(join(tmpdir(), 'wv-activity-')), 'w.db');
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['bin/weave.js', '--data', data, ...args], { encoding: 'utf8' }));
  execFileSync(process.execPath, ['bin/weave.js', '--data', data, 'space', 'create', 'S'], { stdio: 'ignore' });
  execFileSync(process.execPath, ['bin/weave.js', '--data', data, 'table', 'create', 'S', 'Task'], { stdio: 'ignore' });
  for (let i = 0; i < 4; i++) execFileSync(process.execPath, ['bin/weave.js', '--data', data, 'create', 'Task', `r${i}`], { stdio: 'ignore' });
  const first = cli('activity', '--since-seq', '0', '--limit', '5');
  assert.equal(typeof first.nextSeq, 'number');
  assert.ok(first.items.length > 0 && first.items.length <= 5);
  const seqs = first.items.map((r) => r.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'the CLI page is in seq order');
  assert.equal(first.nextSeq, Math.max(...seqs));
  const caught = cli('activity', '--since-seq', String(first.nextSeq));
  assert.ok(caught.items.every((r) => r.seq > first.nextSeq), 'the next CLI page repeats nothing');
});

test('sinceSeq and since together are refused rather than one silently winning', () => {
  const { w } = busy();
  assert.throws(() => w.activityFeed({ sinceSeq: 0, since: '2020-01-01T00:00:00.000Z' }), /sinceSeq or by since/);
  assert.throws(() => w.activityFeed({ sinceSeq: 'soon' }), /a number/);
});
