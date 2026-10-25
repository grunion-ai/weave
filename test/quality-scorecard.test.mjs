import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  answerOf, bandsCovered, ceilings, commitsSince, coverage, entriesOf, history, isoWeek,
  parseLog, probeAnswers, scorecard, seededTypes, tokenShares, widthsIn,
} from '../scripts/quality-scorecard.mjs';
import { PROBE_QUESTION, renderBugReport } from '../src/bugreport.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_CSS = `/* margin: var(--commented-out); z-index: var(--nope); */
.a { margin: 0; padding: var(--space-2) 8px; gap: 4px; }
.b{padding-left:var(--space-1);margin-inline-start:12px}
.c { z-index: 10; row-gap: 2px; column-gap: var(--space-3) }
@media (max-width: 600px) { .d { z-index: var(--z-menu); margin-top: 3px !important; } }
.e { --pad: 4px; scroll-padding: 8px; grid-template-columns: 1fr; }
`;
const fixture = (name) => readFileSync(join(ROOT, 'test/fixtures/quality-scorecard', name), 'utf8');

test('the git log parses into commits with their subjects, dates and files', () => {
  const commits = parseLog(fixture('git-log.txt'));
  assert.equal(commits.length, 13);
  assert.deepEqual(commits[0], {
    sha: 'a1', date: '2026-10-24T10:00:00Z',
    subject: 'grid: a long title clips inside its cell (Issue #1)',
    files: ['public/app.js', 'test/grid-title-browser.test.mjs'],
  });
  assert.deepEqual(commits.at(-1).files, [], 'a merge with no diff still counts as a commit');
});

test('a UI fix names an Issue and touches first-party public code; class-wide means a baseline, a shared probe or a source rule', () => {
  const h = history(parseLog(fixture('git-log.txt')));
  assert.equal(h['UI fixes'], 7, 'Feature commits, server-only fixes, vendored code and reverts are not UI fixes');
  assert.equal(h['Class-wide fixes'], 3, 'the cut-off baseline, the state catalog and the type-scale rule count; the byte budget and the source helper do not');
  assert.equal(h['Generalization rate'], 0.4286);
});

test('repeat fixes are counted per rule class from the subject, and an Issue number is not a pixel size', () => {
  const h = history(parseLog(fixture('git-log.txt')));
  assert.equal(h['Touch repeats'], 2, '#1044 is not 44 px');
  assert.equal(h['Cut-off repeats'], 2);
  assert.equal(h['Alignment repeats'], 1);
});

test('reverts on main are counted whether the sheriff or a person made them', () => {
  assert.equal(history(parseLog(fixture('git-log.txt')))['Reverts'], 2);
});

test('a window with no UI fixes has no generalization rate rather than a fake zero', () => {
  assert.equal(history([])['Generalization rate'], null);
});

test('token shares count spacing and z-index declarations on var(), with comments stripped', () => {
  const t = tokenShares([TOKENS_CSS]);
  assert.deepEqual(t.spacing, { declarations: 8, onTokens: 3 }, 'custom properties and scroll-padding are not spacing declarations');
  assert.deepEqual(t.zIndex, { declarations: 2, onTokens: 1 }, 'a commented-out declaration is not counted');
});

test('widths fall into the five bands the CSS breakpoints cut', () => {
  assert.equal(bandsCovered([390, 1280, 1440]), 2);
  assert.equal(bandsCovered([320, 500, 650, 800, 1440]), 5);
  assert.equal(bandsCovered([]), 0);
  assert.deepEqual(widthsIn("ctx({ viewport: { width: 390, height: 844 } }); x = { viewport: {width:1280} }"), [390, 1280]);
});

test('ceilings read the CI platform of the cut-off baseline and every a11y entry', () => {
  const cutoff = { _: 'note', darwin: { a: 9 }, linux: { a: 2, b: 5, c: 1 } };
  const a11y = { _: 'note', violations: { x: 1100, y: 1101 } };
  assert.equal(entriesOf(cutoff), 3);
  assert.equal(entriesOf(a11y), 2);
  assert.equal(entriesOf({ _: 'note', one: 1, two: 2 }), 2);
  const states = {
    STATES: [{ name: 'board', hold: { cutoff: [1], touch: [2, 3] } }, { name: 'list', hold: { 'touch|phone': [3, 4] } }, { name: 'home' }],
    PROBES: { cutoff: {}, touch: {} },
    held: (p) => ({ cutoff: [{ state: { name: 'board' } }], touch: [{ state: { name: 'board' } }, { state: { name: 'board' } }, { state: { name: 'list' } }] })[p],
  };
  assert.deepEqual(ceilings({ cutoff, a11y, touchBaseline: null, states }), {
    'Cut-off instances': 8, 'Cut-off fingerprints': 3, 'A11y entries': 2,
    'Touch holds': 3, 'Touch baseline entries': 0, 'Held states': 3,
  });
});

test('coverage is the share of catalog states each probe walks', () => {
  const STATES = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
  const walked = (p) => ({ cutoff: [{ state: STATES[0] }, { state: STATES[0] }, { state: STATES[1] }], a11y: [{ state: STATES[3] }] })[p];
  assert.deepEqual(coverage({ STATES, PROBES: { cutoff: {}, a11y: {} }, walked }), { 'Cut-off coverage': 0.5, 'A11y coverage': 0.25 });
});

test('field types seeded are read from the seeds themselves, Name and relations included', () => {
  const make = () => ({ createTable: () => ({}), addField() {}, addRelation() {} });
  const seeds = {
    one: (w) => { const t = w.createTable(); w.addField(t, { type: 'rating' }); w.addRelation(t, {}); },
    two: (w) => { const t = w.createTable(); w.addField(t, { type: 'rating' }); w.addField(t, { type: 'toggle' }); },
  };
  assert.deepEqual([...seededTypes(seeds, make)].sort(), ['rating', 'relation', 'text', 'toggle']);
});

test('the bug template asks which probe would have caught it, and an unanswered template is not an answer', () => {
  const md = renderBugReport({ categories: ['broken-ui'], note: 'chips overlap' }).markdown;
  assert.ok(md.includes(`## ${PROBE_QUESTION}`));
  assert.equal(answerOf(md), null);
  const swap = (answer) => md.replace(/(## Which probe would have caught this\?\n\n)[^\n]+/, `$1${answer}`);
  assert.equal(answerOf(swap('None. No probe walks the board on a phone.')), 'None. No probe walks the board on a phone.');
  assert.equal(answerOf('## Report\n\nno question here'), null);
});

test('the scorecard counts probe answers on rows touched in the window, and how many read none', () => {
  const md = renderBugReport({ categories: ['broken-ui'], note: 'x' }).markdown;
  const row = (answer, updatedAt) => ({ updatedAt, fields: { Description: answer ? md.replace(/(## Which probe would have caught this\?\n\n)[^\n]+/, `$1${answer}`) : md } });
  const rows = [
    row('**none**', '2026-10-24T00:00:00Z'),
    row('None: the touch probe skips the board', '2026-10-23T00:00:00Z'),
    row('The cut-off sweep, once the board is in the catalog', '2026-10-22T00:00:00Z'),
    row('', '2026-10-22T00:00:00Z'),
    row('none', '2026-10-01T00:00:00Z'),
  ];
  assert.deepEqual(probeAnswers(rows, { since: new Date('2026-10-18T00:00:00Z') }), { 'Probe answers': 3, 'Probe answers none': 2 });
  assert.deepEqual(probeAnswers(null, { since: new Date(0) }), { 'Probe answers': null, 'Probe answers none': null });
});

test('the row is named by its ISO week', () => {
  assert.equal(isoWeek(new Date('2026-10-25T12:00:00Z')), '2026-W43');
  assert.equal(isoWeek(new Date('2026-10-19T00:00:00Z')), '2026-W43');
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53');
  assert.equal(isoWeek(new Date('2025-12-29T12:00:00Z')), '2026-W01');
});

test('only commits inside the window are read from git', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (args, date) => execFileSync('git', ['-C', dir, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git(['init', '-q', '-b', 'main'], '2026-10-01T00:00:00Z');
  writeFileSync(join(dir, 'old.css'), 'a{}');
  git(['add', 'old.css'], '2026-10-01T00:00:00Z');
  git(['commit', '-q', '-m', 'old fix (Issue #1)'], '2026-10-01T00:00:00Z');
  writeFileSync(join(dir, 'new.css'), 'b{}');
  git(['add', 'new.css'], '2026-10-24T00:00:00Z');
  git(['commit', '-q', '-m', 'new fix (Issue #2)'], '2026-10-24T00:00:00Z');
  const commits = commitsSince(dir, new Date('2026-10-18T00:00:00Z'));
  assert.deepEqual(commits.map((c) => [c.subject, c.files]), [['new fix (Issue #2)', ['new.css']]]);
});

test('the scorecard of this repo is one row of numbers for every metric', async () => {
  const row = await scorecard(ROOT, { now: new Date(), days: 7 });
  assert.match(row.Name, /^\d{4}-W\d{2}$/);
  assert.match(row.Commit, /^[0-9a-f]{7,}$/);
  assert.ok(row['Field types seeded'] >= 12 && row['Field types seeded'] <= 22, String(row['Field types seeded']));
  assert.ok(row['Width bands covered'] >= 2 && row['Width bands covered'] <= 5);
  for (const k of ['Cut-off coverage', 'Flicker coverage', 'Budgets coverage', 'A11y coverage', 'Touch coverage']) {
    assert.ok(row[k] > 0 && row[k] <= 1, `${k} = ${row[k]}`);
  }
  for (const [k, v] of Object.entries(row)) {
    if (['Name', 'Commit', 'Measured'].includes(k)) continue;
    assert.ok(v === null || Number.isFinite(v), `${k} is a number, got ${JSON.stringify(v)}`);
  }
  assert.equal(row['Probe answers'], null, 'no tracker rows were handed in');
});
