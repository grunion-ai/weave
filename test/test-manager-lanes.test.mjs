import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { request, fingerprint, REACHING } from '../scripts/test-manager.mjs';
import { REACHING as SHERIFF_REACHING } from '../scripts/sheriff.mjs';
import { lanes } from '../scripts/test.mjs';
import { managerHarness, stubBrowserDriver } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

const { ROOT, scratch, env } = managerHarness('weave-lanes-test-');
const signals = tempDir('weave-lanes-signal-');
await request({ type: 'status' }, { directory: scratch, start: true });

function write(root, path, body) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
  return join(root, path);
}
function worktree(files = {}) {
  const root = realpathSync(tempDir('weave-lanes-root-'));
  for (const name of ['test.mjs', 'test-manager.mjs', 'failed-files.mjs']) write(root, `scripts/${name}`, readFileSync(join(ROOT, 'scripts', name)));
  for (const [path, body] of Object.entries(files)) write(root, path, body);
  stubBrowserDriver(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}
const held = (release) => `import test from 'node:test';\nimport { existsSync } from 'node:fs';\ntest('held', async () => { while (!existsSync(${JSON.stringify(release)})) await new Promise((r) => setTimeout(r, 20)); });\n`;
const quick = "import test from 'node:test';\ntest('quick', () => {});\n";
function cli(root, args) {
  const child = spawn(process.execPath, [join(root, 'scripts/test.mjs'), '--timeout=60000', ...args], { cwd: root, env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  return { child, done: new Promise((r) => child.on('close', (code) => r({ code, out }))) };
}
const status = () => request({ type: 'status' }, { directory: scratch });
async function until(check, what) {
  for (let i = 0; i < 400; i++) {
    const now = await status().catch(() => null);
    if (now && check(now)) return now;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`the manager never showed ${what}: ${JSON.stringify(await status().catch((e) => e.message))}`);
}
const holds = (path) => (s) => s.active?.files?.includes(path);
const queues = (path) => (s) => s.queued?.some((job) => job.files.includes(path));

test('two unit-only targeted runs from two worktrees run beside a browser job and finish while it holds the slot', { timeout: 90_000 }, async () => {
  const one = worktree(), two = worktree();
  const release = join(signals, 'slot-1'), unitRelease = join(signals, 'units-1');
  const browser = write(one, 'test/hold-browser.test.mjs', held(release));
  const unitA = write(one, 'test/a.test.mjs', held(unitRelease)), unitB = write(two, 'test/b.test.mjs', held(unitRelease));
  const slot = cli(one, ['--targeted', browser]);
  try {
    await until(holds(browser), 'the browser job in the slot');
    const a = cli(one, ['--targeted', unitA]);
    const b = cli(two, ['--targeted', unitB]);
    const both = await until((s) => s.unit?.length === 2, 'two jobs in the unit lane');
    assert.equal(both.active.lane, 'browser', 'the slot holds the browser job');
    assert.ok(both.active.files.includes(browser));
    assert.deepEqual(both.unit.map((job) => job.lane), ['unit', 'unit']);
    assert.deepEqual(new Set(both.unit.map((job) => job.root)), new Set([one, two]), 'one unit job from each worktree');
    assert.equal(both.queued.length, 0, 'neither unit job waits behind the browser job');
    writeFileSync(unitRelease, '');
    for (const r of await Promise.all([a.done, b.done])) {
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /^# TEST MANAGER running \S+ in the unit lane: 1 file\(s\)$/m, r.out);
    }
    const after = await status();
    assert.ok(holds(browser)(after), 'both unit runs finished while the browser job still held the slot');
    assert.equal(after.unit.length, 0);
  } finally { writeFileSync(unitRelease, ''); writeFileSync(release, ''); }
  const r = await slot.done;
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^# TEST MANAGER running \S+ in the browser slot: 1 file\(s\)$/m, r.out);
});

test('an edit outside what a queued run can read leaves it valid, and leaves the running job green', { timeout: 90_000 }, async () => {
  const root = worktree({ 'changelog.d/lanes-1677.md': '- before\n' });
  const release = join(signals, 'slot-2');
  const holder = write(root, 'test/hold-browser.test.mjs', held(release));
  const next = write(root, 'test/next-browser.test.mjs', quick);
  const first = cli(root, ['--targeted', holder]);
  let second;
  try {
    await until(holds(holder), 'the first browser job in the slot');
    second = cli(root, ['--targeted', next]);
    await until(queues(next), 'the second browser job queued behind the first');
    writeFileSync(join(root, 'changelog.d/lanes-1677.md'), '- written while the run waited\n');
    writeFileSync(join(root, 'notes.md'), 'a note written mid-run\n');
  } finally { writeFileSync(release, ''); }
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.out);
  assert.equal(b.code, 0, b.out);
  assert.doesNotMatch(b.out, /changed while queued/);
});

test('an edit to code a queued run can load still voids it', { timeout: 90_000 }, async () => {
  const root = worktree({ 'src/x.js': 'export const x = 1;\n' });
  const release = join(signals, 'slot-3');
  const holder = write(root, 'test/hold-browser.test.mjs', held(release));
  const next = write(root, 'test/next-browser.test.mjs', quick);
  const first = cli(root, ['--targeted', holder]);
  let second;
  try {
    await until(holds(holder), 'the first browser job in the slot');
    second = cli(root, ['--targeted', next]);
    await until(queues(next), 'the second browser job queued behind the first');
    writeFileSync(join(root, 'src/x.js'), 'export const x = 2;\n');
  } finally { writeFileSync(release, ''); }
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.notEqual(a.code, 0, a.out);
  assert.match(a.out, /worktree changed during tests/);
  assert.notEqual(b.code, 0, b.out);
  assert.match(b.out, /worktree changed while queued/);
});

test('a request from an older client, with no lane and no scope, waits for the slot and keeps the whole-tree fingerprint', { timeout: 90_000 }, async () => {
  const root = worktree();
  const release = join(signals, 'slot-4');
  const holder = write(root, 'test/hold-browser.test.mjs', held(release));
  const suite = write(root, 'test/older.test.mjs', quick);
  const first = cli(root, ['--targeted', holder]);
  let older;
  try {
    await until(holds(holder), 'the browser job in the slot');
    older = request({ type: 'run', root, node: process.execPath, files: [suite], flags: [], env, fingerprint: fingerprint(root, [suite]) }, { directory: scratch });
    const waiting = await until(queues(suite), 'the older request queued for the slot');
    assert.equal(waiting.queued.find((job) => job.files.includes(suite)).lane, 'browser');
    assert.equal(waiting.unit.length, 0);
    writeFileSync(join(root, 'notes.md'), 'a note\n');
  } finally { writeFileSync(release, ''); }
  assert.equal((await first.done).code, 0);
  const result = await older;
  assert.equal(result.code, 1);
  assert.match(result.error, /worktree changed while queued/);
});

test('a unit-lane job that asks for a browser is told its suite is in the wrong lane', { timeout: 60_000 }, async () => {
  const root = worktree();
  const suite = write(root, 'test/reaches.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../scripts/test-manager.mjs';
test('asks for a browser', async () => {
  const r = await request({ type: 'browser', job: process.env.WEAVE_TEST_JOB });
  assert.equal(r.code, 1);
  assert.match(r.error, /unit lane/);
  assert.match(r.error, /test\\/lib\\/browser\\.mjs/);
});
`);
  const r = await cli(root, ['--targeted', suite]).done;
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /in the unit lane/);
});

test('a suite that imports the browser harness after a semicolon on one line is in the browser lane', () => {
  const dir = tempDir('weave-lanes-classify-');
  const one = write(dir, 'one-line.test.mjs', `import test from 'node:test'; import { chromium } from ${JSON.stringify('file:///x/test/lib/browser.mjs')}; test('x', () => {});`);
  const plain = write(dir, 'plain.test.mjs', quick);
  assert.deepEqual(lanes([one, plain]), { unit: [plain], browser: [one] });
});

test('the manager reads the same paths as reaching code as the sheriff does', () => {
  assert.equal(REACHING.source, SHERIFF_REACHING.source);
});

test('the reach fingerprint ignores a fragment, a note and an unnamed doc but not code; the whole-tree one sees every file', () => {
  const root = worktree({ 'changelog.d/x-1677.md': '- a\n', 'src/x.js': 'export const x = 1;\n', 'docs/guide.md': 'guide\n' });
  const suite = write(root, 'test/x.test.mjs', "import test from 'node:test';\nimport { x } from '../src/x.js';\ntest('x', () => {});\n");
  const reach = () => fingerprint(root, [suite], 'reach');
  const tree = () => fingerprint(root, [suite]);
  const [r0, t0] = [reach(), tree()];
  writeFileSync(join(root, 'changelog.d/x-1677.md'), '- b\n');
  writeFileSync(join(root, 'notes.md'), 'note\n');
  writeFileSync(join(root, 'docs/guide.md'), 'changed\n');
  assert.equal(reach(), r0, 'nothing the suite can read changed');
  assert.notEqual(tree(), t0, 'the whole-tree fingerprint an older client sends still covers every file');
  writeFileSync(join(root, 'src/x.js'), 'export const x = 2;\n');
  assert.notEqual(reach(), r0, 'code the suite loads changed');
});

test('the reach fingerprint covers a non-code path the suite, or a module or script it names, mentions', () => {
  const root = worktree({ 'docs/guide.md': 'guide\n', 'README.md': 'readme\n', 'SOUL.md': 'soul\n', 'src/serve.js': "export const guide = 'docs/guide.md';\n", 'src/voice.js': "globalThis.voice = 'SOUL.md';\n", 'scripts/readme.mjs': "export const page = 'README.md';\n" });
  const suite = write(root, 'test/y.test.mjs', "import test from 'node:test';\nimport { guide } from '../src/serve.js';\nimport '../src/voice.js';\nconst script = 'scripts/readme.mjs';\ntest('y', () => {});\n");
  const steps = [['docs/guide.md', 'a module the suite imports names docs/'], ['SOUL.md', 'a module the suite imports for its side effects names SOUL.md'], ['README.md', 'a script the suite names mentions README.md']];
  let last = fingerprint(root, [suite], 'reach');
  for (const [path, why] of steps) {
    writeFileSync(join(root, path), 'changed\n');
    const now = fingerprint(root, [suite], 'reach');
    assert.notEqual(now, last, why);
    last = now;
  }
});
