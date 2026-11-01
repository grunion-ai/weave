import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARK,
  ENRICH,
  AREA_LABELS,
  SKIP_AREAS,
  areaLabel,
  areaOf,
  areaFromText,
  parseAttempts,
  isOpsIssue,
  needsDecision,
  rankIssues,
  selectIssues,
  planBatches,
  staleClaims,
  windowFor,
  budget,
  claimNote,
  abortNote,
  fixedNote,
  enrichNote,
  isEnriched,
  enrichCandidates,
  mergedOpenRows,
  parseVerdict,
  parseBatchVerdict,
  changedSinceLastAttempt,
  eligible,
} from '../agents/fixer/core.mjs';

const issue = (publicId, over = {}) => ({
  id: `id-${publicId}`,
  publicId,
  name: over.name ?? `Issue ${publicId}`,
  fields: { Status: 'Open', Severity: 'Medium', ...(over.fields ?? {}) },
  doc: over.doc ?? '',
  updatedAt: over.updatedAt ?? '2026-09-01T00:00:00.000Z',
});

test('parseAttempts reads every fixer line in a description, newest last', () => {
  const doc = [
    'Some repro text.',
    `${MARK} attempt 1 · 2026-09-03T10:00:00.000Z · started · session abc`,
    `${MARK} attempt 1 · 2026-09-03T11:30:00.000Z · abandoned · tests still red after 3 runs`,
    `${MARK} attempt 2 · 2026-09-04T10:00:00.000Z · started · session def`,
  ].join('\n');
  const a = parseAttempts(doc);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => x.outcome), ['started', 'abandoned', 'started']);
  assert.equal(a[1].attempt, 1);
  assert.equal(a[1].detail, 'tests still red after 3 runs');
  assert.equal(a[2].at, '2026-09-04T10:00:00.000Z');
});

test('parseAttempts ignores prose that merely mentions the fixer', () => {
  assert.deepEqual(parseAttempts('The overnight fixer should look at this.'), []);
  assert.deepEqual(parseAttempts(''), []);
});

test('parseAttempts still reads the attempt lines hundreds of tracker rows carry from the Gerrit era', () => {
  const doc = [
    '🌙 overnight-fixer · attempt 1 · 2026-09-03T10:00:00.000Z · started · session abc',
    '🌙 overnight-fixer · attempt 1 · 2026-09-03T11:30:00.000Z · abandoned · Gerrit change 210 abandoned, tests red',
    '',
    '**Not shipped.** Nothing landed on main from this attempt.',
    '',
    '**State:** Gerrit change 210 abandoned; diff attached as overnight-attempt-1.patch.',
    '🌙 overnight-fixer · attempt 2 · 2026-09-05T04:40:00.000Z · fixed · Gerrit 211 → abc1234',
  ].join('\n');
  const a = parseAttempts(doc);
  assert.deepEqual(a.map((x) => [x.attempt, x.outcome]), [[1, 'started'], [1, 'abandoned'], [2, 'fixed']]);
  assert.equal(a[1].detail, 'Gerrit change 210 abandoned, tests red');
  assert.equal(a[2].detail, 'Gerrit 211 → abc1234');
});

test('watcher-filed ops issues are never candidates', () => {
  assert.equal(isOpsIssue(issue(162, { name: 'gerrit/main @ a69ea6dc did not reach GitHub or :4400' })), true);
  assert.equal(isOpsIssue(issue(179, { name: ':4400 is not serving gerrit/main @ 60177f13' })), true);
  assert.equal(isOpsIssue(issue(83, { name: 'tab navigation should start from the row I am on' })), false);
});

test('issues that ask for a decision are skipped', () => {
  assert.equal(needsDecision(issue(65, { name: 'Picker — the staged chip needs a better design, and "numbering" needs deciding' })), true);
  assert.equal(needsDecision(issue(1, { name: 'x', doc: 'Decision pending on the layout.' })), true);
  assert.equal(needsDecision(issue(110, { name: 'Import drops a plain number field' })), false);
});

test('rankIssues: High before Medium before Low, then oldest update first', () => {
  const rows = [
    issue(1, { fields: { Severity: 'Low' }, updatedAt: '2026-08-01T00:00:00Z' }),
    issue(2, { fields: { Severity: 'High' }, updatedAt: '2026-09-02T00:00:00Z' }),
    issue(3, { fields: { Severity: 'High' }, updatedAt: '2026-08-20T00:00:00Z' }),
    issue(4, { fields: { Severity: 'Medium' }, updatedAt: '2026-08-10T00:00:00Z' }),
  ];
  assert.deepEqual(rankIssues(rows).map((r) => r.publicId), [3, 2, 4, 1]);
});

test('selectIssues drops attempted, in-progress, ops, and decision issues and caps at max', () => {
  const rows = [
    issue(10, { fields: { Severity: 'High' }, doc: `${MARK} attempt 1 · 2026-09-03T11:30:00.000Z · abandoned · red` }),
    issue(11, { fields: { Severity: 'High', Status: 'In Progress' } }),
    issue(12, { fields: { Severity: 'High' }, name: ':4400 is not serving gerrit/main @ abc' }),
    issue(13, { fields: { Severity: 'High' }, name: 'needs deciding: chip' }),
    issue(14, { fields: { Severity: 'High' } }),
    issue(15, { fields: { Severity: 'Medium' } }),
    issue(16, { fields: { Severity: 'Medium' } }),
    issue(17, { fields: { Severity: 'Low' } }),
  ];
  const { picked, skipped } = selectIssues(rows, { max: 3 });
  assert.deepEqual(picked.map((r) => r.publicId), [14, 15, 16]);
  assert.equal(skipped.find((s) => s.publicId === 10).reason, 'attempted');
  assert.equal(skipped.find((s) => s.publicId === 11).reason, 'in-progress');
  assert.equal(skipped.find((s) => s.publicId === 12).reason, 'ops');
  assert.equal(skipped.find((s) => s.publicId === 13).reason, 'decision');
});

test('selectIssues: a fixed attempt does not block a re-opened issue', () => {
  const rows = [issue(20, { doc: `${MARK} attempt 1 · 2026-09-03T11:30:00.000Z · fixed · GitHub PR 200` })];
  assert.equal(selectIssues(rows, { max: 1 }).picked.length, 1);
});

test('selection reads the Description field a tracker row carries when it has no doc', () => {
  const row = issue(21);
  delete row.doc;
  row.fields.Description = `${MARK} attempt 1 · 2026-09-03T11:30:00.000Z · abandoned · red`;
  const { picked, skipped } = selectIssues([row], { max: 1 });
  assert.equal(picked.length, 0);
  assert.equal(skipped[0].reason, 'attempted');
});

test('staleClaims finds In Progress rows whose last fixer line is a start older than the window', () => {
  const now = new Date('2026-09-05T03:00:00Z');
  const rows = [
    issue(30, { fields: { Status: 'In Progress' }, doc: `${MARK} attempt 1 · 2026-09-04T03:05:00.000Z · started · session abc` }),
    issue(31, { fields: { Status: 'In Progress' }, doc: `${MARK} attempt 1 · 2026-09-05T02:59:00.000Z · started · session xyz` }),
    issue(32, { fields: { Status: 'In Progress' }, doc: 'Kyle is on this one.' }),
    issue(33, { fields: { Status: 'Open' }, doc: `${MARK} attempt 1 · 2026-09-04T03:05:00.000Z · started · session abc` }),
  ];
  assert.deepEqual(staleClaims(rows, { now, hours: 12 }).map((r) => r.publicId), [30]);
});

test('budget: no new issue after the cutoff, hard stop after the deadline', () => {
  const day = (h, m = 0) => new Date(Date.UTC(2026, 8, 5, h, m));
  const b = (now) => budget(now, { start: day(3), noNewAfter: day(5), hardStop: day(6, 30) });
  assert.deepEqual(b(day(3, 10)), { canStart: true, mustStop: false, minutesLeft: 200 });
  assert.deepEqual(b(day(5, 1)), { canStart: false, mustStop: false, minutesLeft: 89 });
  assert.deepEqual(b(day(6, 31)), { canStart: false, mustStop: true, minutesLeft: 0 });
});

test('windowFor maps the budget onto the fire: no new Issue after 2 h, hard stop at 3 h 30', () => {
  const w = windowFor(new Date('2026-10-05T16:02:00Z'));
  assert.equal(w.start.toISOString(), '2026-10-05T16:02:00.000Z');
  assert.equal(w.noNewAfter.toISOString(), '2026-10-05T18:02:00.000Z');
  assert.equal(w.hardStop.toISOString(), '2026-10-05T19:32:00.000Z');
});

test('notes: claim, abort, and fixed lines parse back and carry the detail', () => {
  const c = claimNote({ attempt: 2, at: '2026-09-05T03:01:00.000Z', session: 'sess-1' });
  assert.equal(parseAttempts(c)[0].outcome, 'started');
  assert.equal(parseAttempts(c)[0].attempt, 2);
  const a = abortNote({
    attempt: 2, at: '2026-09-05T04:40:00.000Z', reason: 'tests red after 3 runs',
    tried: ['Serialized the browser suite with concurrency 1', 'Retry-once wrapper on fixture start'],
    hypothesis: 'The fixture starves because 500 tests share one Chromium',
    evidence: 'not ok 12 - slash: table (timeout 30000ms)',
    change: 210, patch: 'overnight-attempt-2.patch', worktree: 'removed',
  });
  const p = parseAttempts(a);
  assert.equal(p[0].outcome, 'abandoned');
  assert.equal(p[0].detail, 'tests red after 3 runs');
  assert.match(a, /Serialized the browser suite/);
  assert.match(a, /PR 210 closed/);
  assert.match(a, /overnight-attempt-2\.patch/);
  assert.match(a, /```\nnot ok 12/);
  const f = fixedNote({ attempt: 2, at: '2026-09-05T04:40:00.000Z', change: 211, sha: 'abc1234', tests: ['test/grid.test.mjs: tab starts from the focused row'], verified: 'GET /api/health sha abc1234, startedAt 04:39Z' });
  assert.equal(parseAttempts(f)[0].outcome, 'fixed');
  assert.match(f, /PR 211/);
  assert.match(f, /abc1234/);
});

test('abortNote never claims a patch or change it does not have', () => {
  const a = abortNote({ attempt: 1, at: '2026-09-05T04:40:00.000Z', reason: 'session budget exhausted', tried: [], hypothesis: '', evidence: '' });
  assert.doesNotMatch(a, /\.patch/);
  assert.match(a, /nothing was pushed/);
});

test('abortNote tells a merged PR that failed live verification from an unmerged one', () => {
  const at = '2026-10-14T04:40:00.000Z';
  const before = abortNote({ attempt: 1, at, reason: 'three failed gates', change: 123 });
  assert.match(before, /Nothing landed on main/);
  assert.match(before, /PR 123 closed/);
  const after = abortNote({ attempt: 1, at, reason: 'merged but deploy verification failed', change: 123, merged: 'abc1234', evidence: 'health sha 9f9f9f9' });
  assert.equal(parseAttempts(after)[0].outcome, 'abandoned');
  assert.doesNotMatch(after, /Nothing landed on main/);
  assert.doesNotMatch(after, /closed/);
  assert.match(after, /PR 123 merged as abc1234/);
  assert.match(after, /not verified live/i);
  assert.match(after, /health sha 9f9f9f9/);
});

test('no note the core writes carries Gerrit wording', () => {
  const at = '2026-10-14T04:40:00.000Z';
  const notes = [
    claimNote({ attempt: 1, at, session: 's' }),
    abortNote({ attempt: 1, at, reason: 'red', tried: ['a'], hypothesis: 'h', evidence: 'e', change: 5, patch: 'x.patch', worktree: 'removed' }),
    abortNote({ attempt: 1, at, reason: 'red', change: 5, merged: 'abc1234' }),
    abortNote({ attempt: 1, at, reason: 'red' }),
    fixedNote({ attempt: 1, at, change: 5, sha: 'abc1234', tests: ['t'], verified: 'ok' }),
    enrichNote({ at, session: 's', from: [1], repro: 'r', pointers: ['p'], fixShape: 'f', tests: ['t'] }),
  ];
  for (const n of notes) assert.doesNotMatch(n, /gerrit/i, n);
});

test('parseVerdict accepts the subagent JSON block and rejects anything else', () => {
  const v = parseVerdict('prose before\n```json\n{"outcome":"fixed","change":211,"sha":"abc1234","tests":["a"],"verified":"ok"}\n```\nafter');
  assert.equal(v.outcome, 'fixed');
  assert.equal(v.change, 211);
  assert.equal(parseVerdict('no json here').outcome, 'unknown');
  assert.equal(parseVerdict('```json\n{"outcome":"shipped"}\n```').outcome, 'unknown');
});

test('areaOf names the part of weave an Issue lives in, from its text', () => {
  assert.equal(areaOf(issue(1, { doc: 'x\nflicker-fp: open-row|transient|div.a > div.b' })), 'flicker');
  assert.equal(areaOf(issue(2, { name: 'security finding S-12: token in URL' })), 'security');
  assert.equal(areaOf(issue(3, { name: 'Looks broken: clicking a cell in a side-scrolling grid jumps to the top' })), 'grid');
  assert.equal(areaOf(issue(4, { name: 'Error: the document editor drops a paste' })), 'editor');
  assert.equal(areaOf(issue(5, { name: 'Wrong data: rollup sums the wrong field' })), 'formula');
  assert.equal(areaOf(issue(6, { name: 'Something odd' })), 'other');
});

test('areaOf: loader, style and the watcher words', () => {
  assert.equal(areaOf(issue(1, { name: 'Slow: a finished page waits behind the loader' })), 'loader');
  assert.equal(areaOf(issue(2, { name: 'Looks broken: state colours are locked to their category' })), 'style');
  assert.equal(areaOf(issue(3, { name: 'Error: ai.grunion.weave-fixer-watchdog exits 1 on every fire' })), 'gate');
  assert.equal(areaOf(issue(4, { name: 'Gap: /api/health has no chip for the watcher heartbeats' })), 'gate');
});

test('areaOf reads the Area field first and falls back to the text', () => {
  assert.equal(areaOf(issue(1, { name: 'Looks broken: grid header overlaps', fields: { Area: 'Editor' } })), 'editor');
  assert.equal(areaOf(issue(2, { name: 'Looks broken: grid header overlaps', fields: { Area: null } })), 'grid');
  assert.equal(areaOf(issue(3, { name: 'Odd', fields: { Area: 'MCP' } })), 'mcp');
});

test('every area the core can name has a label on the Area select, and back', () => {
  const keys = ['grid', 'editor', 'formula', 'loader', 'style', 'dock', 'nav', 'toast', 'import', 'flicker', 'mcp', 'gate', 'auth', 'security',
    'hosting', 'server', 'workspace', 'picker', 'layout', 'fields', 'vendor', 'other'];
  assert.deepEqual(Object.keys(AREA_LABELS).sort(), [...keys].sort());
  assert.equal(areaLabel('mcp'), 'MCP');
  assert.equal(areaLabel('grid'), 'Grid');
  for (const k of keys) assert.equal(areaOf(issue(9, { fields: { Area: areaLabel(k) } })), k);
});

test('areaFromText splits the old Other bucket into its clusters', () => {
  const cases = [
    ['Error: a push to GitHub main does not start a Railway build', 'hosting'],
    ['Slow: the first live self-update stalled every request for about ten seconds after the switch', 'hosting'],
    ['Error: every push to main takes the hosted instance down for minutes', 'hosting'],
    ['Error: a request with a malformed percent-escape in the path ended the server process', 'server'],
    ['Wrong data: the entity activity log silently truncates at 500 entries', 'server'],
    ['Simultaneous boots race the WAL switch: busy_timeout was set too late', 'server'],
    ['Wrong data: automation order is not stored and rules load unsorted', 'server'],
    ['Workspaces cannot be deleted from the UI', 'workspace'],
    ['Looks broken: Skip setup on the last onboarding step drops the workspace name the person just confirmed', 'workspace'],
    ['Error: template exercise rerun in the same minute is refused', 'workspace'],
    ['Pickers opened inside a dialog render behind the backdrop', 'picker'],
    ['Bloat: popover dismiss logic is hand-rolled at fifteen sites in app.js', 'picker'],
    ['Date range: start and end must be picked in ONE dialog', 'picker'],
    ['Looks broken: the page layout breaks at a narrow window width, then snaps back', 'layout'],
    ['Looks broken: left panel needs minimum width to avoid responsive break', 'layout'],
    ['Converting a number field to percent should multiply display by 100', 'fields'],
    ['Looks broken: system fields cannot be reordered with the other fields', 'fields'],
    ['Bloat: 73% of the vendored Tabler CSS is never used', 'vendor'],
    ['Error: the vendored dompurify 3.4.12 carries an open XSS advisory', 'vendor'],
    ['Slow: npm test hangs forever when a serve-boot test times out under load', 'gate'],
    ['Error: CI actions could be replaced upstream, and the workflow token was not limited to read', 'gate'],
    ['⌘K search ignored publicId', 'nav'],
    ['Single-writer: CLI and server must not write one workspace file concurrently', 'server'],
    ['sort should be field aware meaning for date time its something list oldest to newest', 'fields'],
    ['Error: opening a table in WebKit raises a ResizeObserver loop error', 'grid'],
    ['Bloat: 24 test files boot their own server and 110 blocks repeat the start-close pattern', 'gate'],
    ['Looks broken + Slow + Error: hover preview not working for name field in this db', 'picker'],
    ['Looks broken: a fast view-tab drag does nothing', 'grid'],
  ];
  for (const [name, want] of cases) assert.equal(areaFromText(issue(1, { name, fields: { Area: 'Other' } })), want, name);
});

test('areaFromText ignores the Area field; areaOf still prefers it', () => {
  const row = issue(1, { name: 'Workspaces cannot be deleted from the UI', fields: { Area: 'Grid' } });
  assert.equal(areaFromText(row), 'workspace');
  assert.equal(areaOf(row), 'grid');
});

test('planBatches groups like Issues by area and symptom, orders batches by their best Issue, and caps the run', () => {
  const rows = [
    issue(40, { fields: { Severity: 'High', Symptom: ['Looks broken'] }, name: 'Looks broken: grid header overlaps', updatedAt: '2026-09-01T00:00:00Z' }),
    issue(41, { fields: { Severity: 'Low', Symptom: ['Looks broken'] }, name: 'Looks broken: grid cell clips the chip', updatedAt: '2026-08-01T00:00:00Z' }),
    issue(42, { fields: { Severity: 'Medium', Symptom: ['Looks broken'] }, name: 'Looks broken: grid row height wobbles', updatedAt: '2026-09-02T00:00:00Z' }),
    issue(43, { fields: { Severity: 'Medium', Symptom: ['Error'] }, name: 'Error: the document editor drops a paste' }),
    issue(44, { fields: { Severity: 'Medium', Symptom: ['Error'] }, name: 'Error: grid paste throws' }),
    issue(45, { fields: { Severity: 'High', Status: 'In Progress' }, name: 'grid busy' }),
  ];
  const { batches, skipped } = planBatches(rows, { maxIssues: 5, batchSize: 3 });
  assert.deepEqual(batches.map((b) => b.key), ['grid|Looks broken', 'editor|Error', 'grid|Error']);
  assert.deepEqual(batches[0].issues.map((r) => r.publicId), [40, 42, 41], 'High leads, then Medium, then Low');
  assert.equal(batches.flatMap((b) => b.issues).length, 5);
  assert.equal(skipped.find((x) => x.publicId === 45).reason, 'in-progress');
  const small = planBatches(rows, { maxIssues: 2, batchSize: 3 });
  assert.deepEqual(small.batches.map((b) => b.issues.map((r) => r.publicId)), [[40, 42]], 'the cap trims the last batch');
});

test('planBatches skips the areas judgment always drops, and re-plans around judgment drops', () => {
  const rows = [
    issue(80, { fields: { Severity: 'High', Symptom: ['Error'] }, name: 'Error: security finding S-11, details held until the fix lands' }),
    issue(81, { fields: { Severity: 'High', Symptom: ['Error'] }, name: 'Error: signing in takes five screens' }),
    issue(82, { fields: { Severity: 'Medium', Symptom: ['Looks broken'] }, name: 'Looks broken: a fresh load shows no loader for a second' }),
    issue(83, { fields: { Severity: 'Medium', Symptom: ['Looks broken'] }, name: 'Looks broken: the rope loops with no sign of progress' }),
    issue(84, { fields: { Severity: 'Medium', Symptom: ['Looks broken'] }, name: 'Looks broken: grid header overlaps' }),
  ];
  const p = planBatches(rows, { maxIssues: 3 });
  assert.deepEqual(p.batches.map((b) => b.key), ['loader|Looks broken', 'grid|Looks broken']);
  assert.deepEqual(p.batches[0].issues.map((r) => r.publicId), [82, 83]);
  assert.equal(p.skipped.find((x) => x.publicId === 80).reason, 'area:security');
  assert.equal(p.skipped.find((x) => x.publicId === 81).reason, 'area:auth');
  const again = planBatches(rows, { maxIssues: 3, exclude: [82] });
  assert.deepEqual(again.batches.flatMap((b) => b.issues.map((r) => r.publicId)), [83, 84]);
  assert.equal(again.skipped.find((x) => x.publicId === 82).reason, 'judgment');
  assert.equal(planBatches(rows, { skipAreas: [] }).batches[0].key, 'security|Error', 'the skip list is an option');
});

test('SKIP_AREAS names the areas judgment always drops', () => {
  assert.deepEqual([...SKIP_AREAS], ['auth', 'security']);
});

test('enrichNote writes a line selection never reads as an attempt, and isEnriched sees it', () => {
  const at = '2026-10-05T03:10:00.000Z';
  const n = enrichNote({ at, session: 's1', from: [451, 452], repro: 'reproduced on :4400 at 1440x900', pointers: ['public/app.js:6122 setPad'], fixShape: 'measure once per frame', tests: ['test/grid-window-browser.test.mjs: spacer holds'] });
  assert.ok(n.startsWith(ENRICH));
  assert.match(n, /#451, #452/);
  assert.match(n, /public\/app\.js:6122/);
  assert.deepEqual(parseAttempts(n), [], 'an enrichment is not an attempt, so it never blacklists the row');
  const row = issue(50, { doc: `text\n\n${n}` });
  assert.equal(selectIssues([row], { max: 1 }).picked.length, 1);
  assert.equal(isEnriched(row, { now: new Date('2026-10-06T00:00:00Z') }), true);
  assert.equal(isEnriched(row, { now: new Date('2026-10-20T00:00:00Z'), days: 7 }), false, 'old notes go stale');
});

test('rankIssues puts an enriched Issue ahead of a bare one of the same severity', () => {
  const n = enrichNote({ at: new Date().toISOString(), session: 's', from: [1], repro: 'r', pointers: [], fixShape: 'f' });
  const rows = [issue(60, { updatedAt: '2026-08-01T00:00:00Z' }), issue(61, { updatedAt: '2026-09-01T00:00:00Z', doc: n }), issue(62, { fields: { Severity: 'High' } })];
  assert.deepEqual(rankIssues(rows).map((r) => r.publicId), [62, 61, 60]);
});

test('enrichCandidates: open Issues in the areas the run worked, not worked this run, not enriched lately', () => {
  const now = new Date('2026-10-05T05:00:00Z');
  const fresh = enrichNote({ at: '2026-10-04T05:00:00Z', session: 's', from: [1], repro: 'r', pointers: [], fixShape: 'f' });
  const rows = [
    issue(70, { name: 'Looks broken: grid header overlaps' }),
    issue(71, { name: 'Looks broken: grid footer clips' }),
    issue(72, { name: 'Looks broken: grid totals wrap', doc: fresh }),
    issue(73, { name: 'Error: the document editor drops a paste' }),
    issue(74, { name: 'Looks broken: grid busy', fields: { Status: 'In Progress' } }),
  ];
  const got = enrichCandidates(rows, { areas: ['grid'], worked: [70], max: 5, now });
  assert.deepEqual(got.map((r) => r.publicId), [71]);
});

test('parseBatchVerdict reads one verdict per Issue, accepts "verdict" for "outcome", and marks a missing Issue unknown', () => {
  const report = 'prose\n```json\n{"issues":[{"publicId":451,"outcome":"fixed","change":600,"sha":"97f4cb3"},{"publicId":452,"verdict":"abandoned","reason":"red"}],"enriched":[289]}\n```';
  const v = parseBatchVerdict(report, { expect: [451, 452, 453] });
  assert.deepEqual(v.issues.map((i) => [i.publicId, i.outcome]), [[451, 'fixed'], [452, 'abandoned'], [453, 'unknown']]);
  assert.deepEqual(v.enriched, [289]);
  const s2 = parseBatchVerdict('```json\n{"issues":[{"publicId":7,"outcome":"skipped","reason":"context"}]}\n```', { expect: [7] });
  assert.equal(s2.issues[0].outcome, 'skipped', 'an Issue the batch never reached is skipped: never claimed, nothing to undo');
  assert.deepEqual(parseBatchVerdict('no block', { expect: [1] }).issues, [{ publicId: 1, outcome: 'unknown' }]);
});

test('parseBatchVerdict turns unusable worker output into unknown outcomes instead of throwing', () => {
  const unknown = { issues: [{ publicId: 1, outcome: 'unknown' }], enriched: [] };
  for (const body of ['null', '42', '"fixed"', 'true', '[]', '{"issues":', '{}', '{"issues":null,"enriched":null}']) {
    assert.deepEqual(parseBatchVerdict('```json\n' + body + '\n```', { expect: [1] }), unknown, body);
  }
  assert.deepEqual(parseBatchVerdict('', { expect: [1] }), unknown);
  const mixed = parseBatchVerdict('```json\n{"issues":[null,7,"x",[],{"publicId":2,"outcome":"fixed"}]}\n```', { expect: [1, 2] });
  assert.deepEqual(mixed.issues.map((i) => [i.publicId, i.outcome]), [[2, 'fixed'], [1, 'unknown']]);
});

test('mergedOpenRows reports open rows a merged main subject names, and skips reverts', () => {
  const log = [
    'bdaaa4fc loader: leave on the woven pose instead of the cycle end (Issue #392) (#200)',
    '06c1df7e Merge "loader: the rope runs on the compositor (Issue #390)"',
    '1a2b3c4d pickers: title and hint (Issues #798, #799) (#210)',
    '5e6f7a8b grid: two fixes (Issues #10 and #11)',
    '79c56e3e Revert "share: Share is a header button on every shareable page (Issue #765)"',
    '9a9a9a9a docs: PR #392 follow-up (Feature #39)',
    '8b8b8b8b loader: second pass (Issue #392)',
    '',
  ];
  const rows = [392, 390, 798, 799, 10, 11, 765, 39, 7].map((n) => issue(n));
  rows[1].fields.Status = 'In Progress';
  const found = mergedOpenRows(log, rows);
  assert.deepEqual(found.map((r) => r.publicId), [392, 390, 798, 799, 10, 11]);
  assert.deepEqual(found[0], { publicId: 392, id: 'id-392', name: 'Issue 392', status: 'Open', commits: [log[0], log[6]] });
  assert.equal(found[1].status, 'In Progress');
  assert.deepEqual(found.find((r) => r.publicId === 799).commits, [log[2]]);
  assert.deepEqual(mergedOpenRows([], rows), []);
});

const NOW = new Date('2026-10-31T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const line = (attempt, at, outcome, detail = 'x') => `${MARK} attempt ${attempt} · ${at} · ${outcome} · ${detail}`;

const trackerIssue = (over = {}) => ({
  db: 'Development/Issue',
  publicId: 900,
  name: over.name ?? 'Looks broken: grid header overlaps',
  fields: { Name: over.name ?? 'Looks broken: grid header overlaps', Status: 'Open', Severity: 'Medium', Description: over.doc ?? '', ...(over.fields ?? {}) },
});

const trackerFeature = (over = {}) => ({
  db: 'Development/Feature',
  publicId: 192,
  name: 'A feature',
  fields: { Name: 'A feature', Status: 'Planned', Description: over.doc ?? '', ...(over.fields ?? {}) },
});

test('changedSinceLastAttempt: a row with no attempt line has changed', () => {
  assert.equal(changedSinceLastAttempt(trackerIssue()), true);
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc: 'Just a report.' })), true);
});

test('changedSinceLastAttempt: a fixed last attempt means the row is open to work again', () => {
  const doc = line(1, hoursAgo(80), 'fixed', 'GitHub PR 5 → abc1234');
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc })), true);
});

test('changedSinceLastAttempt: an abandoned last attempt with nothing after it has not changed', () => {
  const doc = `Report text.\n\n${line(1, hoursAgo(80), 'abandoned', 'tests red')}`;
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc })), false);
});

test('changedSinceLastAttempt: the full note bodies the core writes are not human content', () => {
  const at = hoursAgo(80);
  const abort = abortNote({ attempt: 1, at, reason: 'tests red', tried: ['serialised the suite', 'retry wrapper'], hypothesis: 'one Chromium shared', evidence: 'not ok 12\n\nsecond line', change: 5, patch: 'a.patch', worktree: 'removed' });
  const enrich = enrichNote({ at: hoursAgo(70), session: 's', from: [3], repro: 'on :4400', pointers: ['public/app.js:1 x'], fixShape: 'measure once', tests: ['test/a.test.mjs: holds'] });
  const doc = `Report text.\n\n${abort}\n\n${enrich}`;
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc })), false);
  const merged = abortNote({ attempt: 1, at, reason: 'deploy check failed', change: 5, merged: 'abc1234' });
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc: merged })), false);
});

test('changedSinceLastAttempt: a human line after the last attempt means the row changed', () => {
  const abort = abortNote({ attempt: 1, at: hoursAgo(80), reason: 'tests red', tried: ['a'], hypothesis: 'h', evidence: 'e' });
  const doc = `${abort}\n\nKyle, 2026-10-30: the repro needs a narrow window, try 900px.`;
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc })), true);
  const bullets = `${line(1, hoursAgo(80), 'abandoned', 'red')}\n- new repro step from QA`;
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc: bullets })), true);
});

test('changedSinceLastAttempt: a human line before the last attempt does not count', () => {
  const doc = `Kyle: early note.\n${line(1, hoursAgo(80), 'abandoned', 'red')}`;
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc })), false);
});

test('changedSinceLastAttempt: Agent Ready always counts as a change', () => {
  const doc = line(1, hoursAgo(80), 'abandoned', 'red');
  assert.equal(changedSinceLastAttempt(trackerIssue({ doc, fields: { Agent: 'Ready' } })), true);
});

test('changedSinceLastAttempt reads a doc field as well as the Description field', () => {
  const row = { ...trackerIssue(), doc: line(1, hoursAgo(80), 'abandoned', 'red') };
  delete row.fields.Description;
  assert.equal(changedSinceLastAttempt(row), false);
  assert.equal(changedSinceLastAttempt({ ...row, doc: `${row.doc}\nnew facts from a person` }), true);
});

test('eligible: an open Issue with no attempt is eligible', () => {
  assert.equal(eligible(trackerIssue(), { now: NOW }), true);
});

test('eligible: a Fixed Issue is not', () => {
  assert.equal(eligible(trackerIssue({ fields: { Status: 'Fixed' } }), { now: NOW }), false);
});

test('eligible: In Progress without a live claim stays eligible', () => {
  assert.equal(eligible(trackerIssue({ fields: { Status: 'In Progress' } }), { now: NOW }), true);
});

test('eligible: SKIP_AREAS rows are not, by the Area field or by the text', () => {
  assert.equal(eligible(trackerIssue({ fields: { Area: 'Auth' } }), { now: NOW }), false);
  assert.equal(eligible(trackerIssue({ fields: { Area: 'Security' } }), { now: NOW }), false);
  assert.equal(eligible(trackerIssue({ name: 'Error: signing in takes five screens' }), { now: NOW }), false);
  assert.equal(eligible(trackerIssue({ fields: { Area: 'Grid' } }), { now: NOW }), true);
});

test('eligible: a live claim blocks, a stale claim does not', () => {
  const live = trackerIssue({ fields: { Status: 'In Progress' }, doc: line(1, hoursAgo(2), 'started', 'session a') });
  assert.equal(eligible(live, { now: NOW }), false);
  const edge = trackerIssue({ fields: { Status: 'In Progress' }, doc: line(1, hoursAgo(11.9), 'started', 'session a') });
  assert.equal(eligible(edge, { now: NOW }), false);
  const stale = trackerIssue({ fields: { Status: 'In Progress' }, doc: `${line(1, hoursAgo(13), 'started', 'session a')}\nKyle: use the narrow window repro.` });
  assert.equal(eligible(stale, { now: NOW }), true);
});

test('eligible: a stale claim nobody has touched since counts as a failed attempt', () => {
  const stale = trackerIssue({ fields: { Status: 'In Progress' }, doc: line(1, hoursAgo(13), 'started', 'session a') });
  assert.equal(eligible(stale, { now: NOW }), false);
});

test('eligible: Agent No and Agent Needs Kyle block; Agent Ready and unset do not', () => {
  assert.equal(eligible(trackerIssue({ fields: { Agent: 'No' } }), { now: NOW }), false);
  assert.equal(eligible(trackerIssue({ fields: { Agent: 'Needs Kyle' } }), { now: NOW }), false);
  assert.equal(eligible(trackerIssue({ fields: { Agent: 'Ready' } }), { now: NOW }), true);
  assert.equal(eligible(trackerIssue({ fields: { Agent: null } }), { now: NOW }), true);
});

test('eligible: a row from the dev bug forwarder waits for Agent Ready', () => {
  const forwarded = (agent) => trackerIssue({ fields: { Instance: 'https://dev.weave.grunion.ai', ...(agent === undefined ? {} : { Agent: agent }) } });
  assert.equal(eligible(forwarded(), { now: NOW }), false);
  assert.equal(eligible(forwarded(null), { now: NOW }), false);
  assert.equal(eligible(forwarded('Ready'), { now: NOW }), true);
  assert.equal(eligible(forwarded('No'), { now: NOW }), false);
  assert.equal(eligible(trackerIssue({ fields: { Instance: '' } }), { now: NOW }), true);
});

test('eligible: an Issue whose last attempt failed needs a change since', () => {
  const failed = line(1, hoursAgo(80), 'abandoned', 'tests red');
  assert.equal(eligible(trackerIssue({ doc: failed }), { now: NOW }), false);
  assert.equal(eligible(trackerIssue({ doc: `${failed}\nKyle: try the narrow window.` }), { now: NOW }), true);
  assert.equal(eligible(trackerIssue({ doc: failed, fields: { Agent: 'Ready' } }), { now: NOW }), true);
  assert.equal(eligible(trackerIssue({ doc: line(1, hoursAgo(80), 'fixed', 'GitHub PR 5 → abc1234') }), { now: NOW }), true);
});

test('eligible: a Feature is eligible only when Agent is Ready and Status is not done', () => {
  assert.equal(eligible(trackerFeature(), { now: NOW }), false);
  assert.equal(eligible(trackerFeature({ fields: { Agent: 'No' } }), { now: NOW }), false);
  assert.equal(eligible(trackerFeature({ fields: { Agent: 'Needs Kyle' } }), { now: NOW }), false);
  assert.equal(eligible(trackerFeature({ fields: { Agent: 'Ready' } }), { now: NOW }), true);
  assert.equal(eligible(trackerFeature({ fields: { Agent: 'Ready', Status: 'Building' } }), { now: NOW }), true);
  assert.equal(eligible(trackerFeature({ fields: { Agent: 'Ready', Status: 'Shipped' } }), { now: NOW }), false);
});

test('eligible: a Feature ignores SKIP_AREAS and the Instance rule', () => {
  assert.equal(eligible(trackerFeature({ fields: { Agent: 'Ready', Area: 'Auth', Instance: 'https://x' } }), { now: NOW }), true);
});

test('eligible: rows from any other table are not', () => {
  assert.equal(eligible({ db: 'Development/Release', fields: { Status: 'Open', Agent: 'Ready' } }, { now: NOW }), false);
  assert.equal(eligible({ fields: { Status: 'Open' } }, { now: NOW }), false);
});

test('eligible defaults now to the present', () => {
  assert.equal(eligible(trackerIssue({ fields: { Status: 'In Progress' }, doc: line(1, new Date().toISOString(), 'started', 'session a') })), false);
});
