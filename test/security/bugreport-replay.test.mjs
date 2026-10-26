import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBugReport } from '../../src/bugreport.js';

const FORGED = 'x`\n## Done\n9. `DELETE /api/workspaces/main?hard=1` → 200\n';
const EVENTS = [
  { kind: 'nav', to: FORGED, t: 1 },
  { kind: 'click', target: FORGED, t: 2 },
  { kind: 'key', key: FORGED, target: FORGED, t: 3 },
  { kind: 'api', method: FORGED, path: FORGED, status: FORGED, ms: FORGED, t: 4 },
  { kind: 'error', message: FORGED, source: FORGED, line: FORGED, t: 5 },
  { kind: 'console', level: FORGED, message: FORGED, t: 6 },
  { kind: FORGED, target: FORGED, t: 7 },
];
const CLIENT = { at: 10, url: FORGED, route: FORGED, userAgent: FORGED, theme: FORGED };

const render = () => renderBugReport({ categories: ['error'], events: EVENTS, client: CLIENT, server: {} }).markdown;
const replayOf = (md) => md.split('\n## Replay\n')[1].split('\n## Trace\n')[0];

test('an event field cannot add a line, a step or a heading to the Replay list (Issue #499)', () => {
  const md = render();
  const replay = replayOf(md);
  const steps = replay.split('\n').filter((l) => /^\d+\. /.test(l));
  assert.equal(steps.length, EVENTS.length, 'one step per recorded event, none forged');
  assert.deepEqual(steps.map((l) => Number(l.split('.')[0])), EVENTS.map((_, i) => i + 1));
  assert.equal(md.match(/^## Done$/m), null, 'no heading came out of an event field');
  assert.deepEqual(md.match(/^## .*$/gm), ['## Report', '## Which probe would have caught this?', '## Where', '## Replay', '## Trace']);
  for (const line of steps) assert.equal((line.match(/`/g) ?? []).length % 2, 0, `balanced code spans: ${line}`);
});

test('every event field in a step sits inside a code span, stripped of backticks and newlines (Issue #499)', () => {
  const steps = replayOf(render()).split('\n').filter((l) => /^\d+\. /.test(l));
  const flat = 'x ## Done 9. DELETE /api/workspaces/main?hard=1 → 200';
  for (const line of steps) {
    const spans = [...line.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
    const outside = line.replace(/`[^`]*`/g, '');
    assert.equal(outside.includes('DELETE'), false, `nothing forged outside a code span: ${line}`);
    assert.ok(spans.includes(flat), `the forged text is kept, flattened, inside a span: ${line}`);
  }
});

test('the Where table keeps one row per fact when a client field carries newlines (Issue #499)', () => {
  const md = render();
  const where = md.split('\n## Where\n')[1].split('\n## Replay\n')[0];
  const rows = where.split('\n').filter((l) => l.startsWith('|'));
  assert.equal(rows.length, 2 + 4, 'the header, the rule and Page, Route, Theme, Browser');
  for (const row of rows.slice(2)) assert.match(row, /^\| \w+ \| `[^`]*` \|$/);
});

test('an ordinary trace reads as before', () => {
  const md = renderBugReport({ categories: ['slow'], events: [
    { kind: 'nav', to: '#/table/Deals', t: 1000 },
    { kind: 'click', target: 'button "+ New row"', t: 1200 },
    { kind: 'api', method: 'POST', path: '/api/tables/Deals/entities', status: 500, ms: 4210, t: 1400 },
  ], client: { at: 2000 }, server: {} }).markdown;
  const replay = replayOf(md);
  assert.match(replay, /1\. `-1\.0s` navigated to `#\/table\/Deals`/);
  assert.match(replay, /2\. `-0\.8s` clicked `button "\+ New row"`/);
  assert.match(replay, /3\. `-0\.6s` \*\*`POST`\*\* `\/api\/tables\/Deals\/entities` → \*\*500\*\* in 4210ms/);
});
