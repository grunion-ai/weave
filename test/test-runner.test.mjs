/* The runner behind `npm test` — the command the Gerrit gate votes on.

   Issue #44: a different slash-command case failed on roughly every other
   full run while the file alone was green eight times out of eight, and each
   one cost a Verified −1 on a change that was fine. scripts/test.mjs runs the
   files that failed a second time and lets that answer stand.

   The property that makes it safe is asserted here on real runs rather than
   argued: a file that fails every time still fails, a file that fails once
   passes and is named, and only the file that failed is run again. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { RETRIES, argsFor, browserConcurrency, childEnv, lanes, run, testFiles } from '../scripts/test.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/* Two suites in a scratch directory: one that always passes, one whose
   verdict the caller chooses. `flaky` fails until the marker exists, so its
   first run is red and its second is green — a coin toss the runner can win
   without the test having to wait for a real one. */
function fixture(kind) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-runner-'));
  writeFileSync(join(dir, 'good.test.mjs'),
    "import test from 'node:test';\ntest('good', () => {});\n");
  const body = kind === 'broken'
    ? "test('subject', () => { throw new Error('always'); });\n"
    : `import { existsSync, writeFileSync } from 'node:fs';
const mark = ${JSON.stringify(join(dir, 'seen'))};
test('subject', () => {
  const first = !existsSync(mark);
  writeFileSync(mark, '1');
  if (first) throw new Error('flaked');
});
`;
  writeFileSync(join(dir, 'subject.test.mjs'), `import test from 'node:test';\n${body}`);
  return { dir, good: join(dir, 'good.test.mjs'), subject: join(dir, 'subject.test.mjs') };
}

function runFixture(kind) {
  const f = fixture(kind);
  try {
    const said = [];
    // stdio is inherited, so the child's TAP lands in this suite's own output
    // rather than being asserted on; what run() decides is what is asserted.
    const code = run([f.good, f.subject], [], { out: (line) => said.push(line) });
    return { code, said: said.join('\n'), ...f };
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
}

test('the gate runs the suite through scripts/test.mjs', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.test, 'node scripts/test.mjs',
    'weave-review.sh votes on `npm test`; the retry has to be inside what it runs');
});

test('a file that fails once passes on the retry, and the run is green', () => {
  const { code, said, subject } = runFixture('flaky');
  assert.equal(code, 0, 'a failure that does not reproduce must not vote a change down');
  assert.match(said, /RETRIED and green/);
  assert.ok(said.includes(subject), 'the flake is named, not absorbed');
});

test('a file that always fails still fails, and says the retry did not save it', () => {
  const { code, said, subject } = runFixture('broken');
  assert.equal(code, 1, 'a real regression fails twice — the retry cannot hide it');
  assert.match(said, /RETRIED and still red/);
  assert.ok(said.includes(subject));
});

test('only the file that failed runs again', () => {
  const { said, good, subject } = runFixture('flaky');
  const retrying = said.split('\n').find((l) => l.startsWith('# RETRYING'));
  assert.ok(retrying, 'the first run names what it is going back for');
  assert.ok(retrying.includes(subject));
  assert.ok(!retrying.includes(good), 'the 191 suites that passed are not run twice');
  assert.equal(RETRIES, 1, 'a file that needs three goes is broken, not flaky');
});

test('the retry breadcrumb is on stdout, where the gate quotes it', () => {
  /* weave-review.sh puts `tail -c 1500` of the run into its Verified +1
     message. The retry runs last, so a suite that keeps needing a second
     chance says so in the review it passed. */
  const f = fixture('flaky');
  try {
    const out = execFileSync(process.execPath, ['scripts/test.mjs', f.good, f.subject],
      { cwd: ROOT, encoding: 'utf8', env: childEnv() });
    assert.match(out, /# RETRYING 1 file\(s\) that failed:/);
    assert.match(out, /# RETRIED and green:/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('importing the runner does not start the suite', () => {
  /* Without a main guard this import spawns `node --test` from inside a test
     file; node:test warns "run() is being called recursively", skips every
     file, and the whole suite reports one passing test — the gate would vote
     +1 on nothing at all. */
  const out = execFileSync(process.execPath, ['-e',
    "import('./scripts/test.mjs').then((m) => console.log('retries', m.RETRIES))"],
  { cwd: ROOT, encoding: 'utf8' });
  assert.equal(out.trim(), `retries ${RETRIES}`);
  assert.doesNotMatch(out, /TAP version|recursively/, 'importing ran no tests');
});

test('the run finds every suite, and keeps the reporter it would have had', () => {
  const onDisk = readdirSync(join(ROOT, 'test'), { recursive: true })
    .filter((f) => f.endsWith('.test.mjs')).map((f) => `test/${f}`).sort();
  assert.deepEqual(testFiles(), onDisk, 'the walk is the whole suite and nothing else');
  assert.ok(onDisk.includes('test/regression/lifecycle.test.mjs'), 'and it descends');
  assert.ok(onDisk.length > 150, `the suite is there (${onDisk.length} files)`);

  // Collecting the failed files must not cost the reader their own reporter:
  // spec on a terminal, tap in the gate's redirected log, as node chooses.
  for (const [tty, want] of [[true, 'spec'], [false, 'tap']]) {
    const args = argsFor(['test/x.test.mjs'], '/tmp/f', [], tty);
    assert.ok(args.includes(`--test-reporter=${want}`), `${want} survives the collector`);
    assert.equal(args.at(-1), 'test/x.test.mjs', 'the files come last');
    assert.equal(args.filter((a) => a === '--test-reporter-destination=stdout').length, 1);
  }
});

test('default node discovery does not launch the suite through scripts/test.mjs (Issue #435)', () => {
  /* `node --test` with no files discovers scripts/test.mjs (it matches
     **\/test.mjs) and runs it as a test file, in a process whose argv[1] is
     the runner itself. The main guard alone let it start a whole second
     suite beside the first. */
  const dir = mkdtempSync(join(tmpdir(), 'weave-discovery-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'test'));
    for (const file of ['test.mjs', 'failed-files.mjs']) writeFileSync(join(dir, 'scripts', file), read(`scripts/${file}`));
    const marker = join(dir, 'runs');
    writeFileSync(join(dir, 'test', 'sentinel.test.mjs'),
      `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(marker)}, 'run\\n');`);
    execFileSync(process.execPath, ['--test', '--test-concurrency=1'], { cwd: dir, encoding: 'utf8', env: childEnv(), timeout: 20000 });
    assert.equal(readFileSync(marker, 'utf8'), 'run\n', 'discovery runs the fixture once; the runner must not run it again');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* Issues #454 and #466. Each browser suite is a Node process with a server
   in it plus a Chromium of four or five processes. At node's default of
   cores minus one files at once, the full suite alone held a ten-core
   machine at load 20 to 27, and the cases that read a paint or a timer
   lost to their own siblings: red in the gate, green alone. */
test('browser suites run in their own lane, capped at half the cores', () => {
  const { unit, browser } = lanes(['test/a.test.mjs', 'test/grid-range-browser.test.mjs', 'test/nav.test.mjs', 'test/test-runner.test.mjs']);
  assert.ok(browser.includes('test/grid-range-browser.test.mjs'), 'a -browser suite is in the browser lane');
  assert.ok(browser.includes('test/nav.test.mjs'), 'and so is a suite that drives the browser harness without the suffix');
  assert.ok(unit.includes('test/test-runner.test.mjs') && unit.includes('test/a.test.mjs'), 'the rest are not');
  assert.equal(browserConcurrency(10), 5);
  assert.equal(browserConcurrency(2), 1);
  assert.equal(browserConcurrency(1), 1, 'never zero');

  const cap = argsFor(['test/x-browser.test.mjs'], '/tmp/f', [], false, 4);
  assert.ok(cap.includes('--test-concurrency=4'), 'the browser lane carries its cap');
  assert.ok(!argsFor(['test/x.test.mjs'], '/tmp/f', [], false).some((a) => a.startsWith('--test-concurrency')), 'the unit lane keeps node\'s default');
  const mine = argsFor(['test/x-browser.test.mjs'], '/tmp/f', ['--test-concurrency=1'], false, 4);
  assert.deepEqual(mine.filter((a) => a.startsWith('--test-concurrency')), ['--test-concurrency=1'], 'a caller\'s own cap wins');
});

test('both lanes run, and a red one lane is red overall', () => {
  const f = fixture('broken');
  try {
    const browserish = join(f.dir, 'late-browser.test.mjs');
    const mark = join(f.dir, 'late-ran');
    writeFileSync(browserish, `import test from 'node:test';\nimport { writeFileSync } from 'node:fs';\ntest('late', () => writeFileSync(${JSON.stringify(mark)}, '1'));\n`);
    const said = [];
    const code = run([f.good, f.subject, browserish], [], { out: (l) => said.push(l) });
    assert.equal(code, 1, 'the unit lane\'s red is the verdict');
    assert.ok(readdirSync(f.dir).includes('late-ran'), 'the browser lane still ran, so one gate names every red');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
