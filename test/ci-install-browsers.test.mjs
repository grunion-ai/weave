import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { install, APT_CONF, ATTEMPTS, LOCK_WAIT_SECONDS } from '../scripts/ci/install-browsers.mjs';
import { tempDir } from './lib/temp.mjs';

function host({ satisfied = false, cacheInstalls = true, mirrorFails = 0, debs = [], cached = [], lockHeldFor = 0 } = {}) {
  const root = tempDir('weave-ci-install-');
  const cache = join(root, 'cache');
  const archives = join(root, 'archives');
  mkdirSync(archives, { recursive: true });
  if (cached.length) {
    mkdirSync(cache, { recursive: true });
    for (const name of cached) writeFileSync(join(cache, name), name);
  }
  const state = { satisfied, mirrorCalls: 0, calls: [], lines: [], conf: null, lockHeldFor, waited: 0 };
  const run = (cmd, args, input) => {
    const line = [cmd, ...args].join(' ');
    state.calls.push(line);
    if (cmd === 'sudo' && args[0] === 'tee') { state.conf = input; return 0; }
    if (cmd === 'sudo' && args[0] === 'fuser') return state.lockHeldFor > 0 ? 0 : 1;
    if (cmd === 'sudo' && args[0] === 'dpkg' && args[1] === '-i') {
      if (state.lockHeldFor > 0) return 2;
      if (cacheInstalls) state.satisfied = true;
      return cacheInstalls ? 0 : 1;
    }
    if (cmd === 'sudo' && args[0] === 'dpkg') return 0;
    if (line.includes('install-deps --dry-run')) return state.satisfied ? 0 : 1;
    if (line.includes('install --with-deps')) {
      state.mirrorCalls += 1;
      if (state.mirrorCalls <= mirrorFails) return 1;
      for (const name of debs) writeFileSync(join(archives, name), name);
      state.satisfied = true;
      return 0;
    }
    if (line.includes('playwright install')) return 0;
    return 127;
  };
  const log = (line) => state.lines.push(line);
  const wait = (seconds) => { state.waited += seconds; state.lockHeldFor -= seconds; };
  return { state, cache, archives, options: { run, log, wait, cache, archives, conf: join(root, '99weave-apt') } };
}

const mirror = (calls) => calls.filter((line) => line.includes('--with-deps') || /apt-get/.test(line));

test('cached packages install with dpkg, and nothing reaches the Ubuntu mirror (Issue #1438)', () => {
  const { state, options } = host({ cached: ['libwoff1_1.0.2.deb', 'libgstreamer1.0-0_1.24.deb'] });
  const result = install(['chromium', 'webkit'], options);
  assert.equal(result.source, 'cache');
  const dpkg = state.calls.find((line) => line.startsWith('sudo dpkg -i'));
  assert.match(dpkg, /^sudo dpkg -i \S+libgstreamer1\.0-0_1\.24\.deb \S+libwoff1_1\.0\.2\.deb$/,
    'dpkg installs the saved closure as it is; apt-get install --no-download of the same files re-resolved them against the image\'s package lists and asked to fetch (PR run 42654813034, attempts 2 to 4)');
  assert.deepEqual(mirror(state.calls), [], 'a cache hit runs no apt-get at all and no playwright --with-deps');
  assert.ok(state.calls.at(-1).endsWith('install-deps --dry-run chromium webkit'), 'the run ends on Playwright\'s own check that every system dependency is present');
});

test('a dpkg lock held by the runner\'s own apt-get is waited out, then the cache installs', () => {
  const { state, options } = host({ cached: ['libwoff1_1.0.2.deb'], lockHeldFor: 45 });
  assert.equal(install(['chromium'], options).source, 'cache');
  assert.ok(state.waited >= 45 && state.waited <= LOCK_WAIT_SECONDS);
  assert.deepEqual(mirror(state.calls), []);
});

test('a dpkg lock held past the wait falls back to the mirror path, whose apt waits on the lock itself', () => {
  const { state, options } = host({ cached: ['libwoff1_1.0.2.deb'], lockHeldFor: 10_000 });
  state.lockHeldFor = 10_000;
  const run = options.run;
  options.run = (cmd, args, input) => (args.includes('--with-deps') ? (state.lockHeldFor = 0, run(cmd, args, input)) : run(cmd, args, input));
  assert.equal(install(['chromium'], options).source, 'mirror');
  assert.ok(state.waited <= LOCK_WAIT_SECONDS);
  assert.ok(state.lines.some((line) => /dpkg lock/.test(line)));
});

test('a host that already holds every dependency skips apt entirely', () => {
  const { state, options } = host({ satisfied: true });
  assert.equal(install(['chromium'], options).source, 'image');
  assert.equal(state.calls.filter((line) => /^sudo (apt-get|dpkg -i)/.test(line)).length, 0);
  assert.deepEqual(mirror(state.calls), []);
});

test('an empty cache installs from the mirror once and keeps the downloaded packages for the next run', () => {
  const { state, cache, options } = host({ debs: ['libwoff1_1.0.2.deb', 'libenchant-2-2_2.3.deb'] });
  const result = install(['chromium', 'webkit'], options);
  assert.equal(result.source, 'mirror');
  assert.equal(result.kept, 2);
  assert.deepEqual(readdirSync(cache).sort(), ['libenchant-2-2_2.3.deb', 'libwoff1_1.0.2.deb']);
  assert.equal(state.mirrorCalls, 1);
});

test('a mirror install that downloads nothing leaves no cache directory, so an empty cache is never saved', () => {
  const { cache, options } = host();
  const result = install(['chromium'], options);
  assert.equal(result.source, 'mirror');
  assert.equal(result.kept, 0);
  assert.equal(existsSync(cache), false);
});

test('a cache that leaves a dependency missing falls back to the mirror and replaces the stale packages', () => {
  const { state, cache, options } = host({ cacheInstalls: false, cached: ['libold_1.deb'], debs: ['libnew_2.deb'] });
  const result = install(['chromium', 'webkit'], options);
  assert.equal(result.source, 'mirror');
  assert.equal(state.mirrorCalls, 1);
  assert.deepEqual(readdirSync(cache), ['libnew_2.deb']);
  assert.ok(state.lines.some((line) => /dpkg could not install the cached packages/.test(line)));
});

test('the mirror path retries, repairs dpkg between attempts and succeeds on the last one', () => {
  const { state, options } = host({ mirrorFails: ATTEMPTS - 1 });
  assert.equal(install(['chromium', 'webkit'], options).source, 'mirror');
  assert.equal(state.mirrorCalls, ATTEMPTS);
  assert.equal(state.calls.filter((line) => line === 'sudo dpkg --configure -a').length, ATTEMPTS - 1);
});

test('a browser install that fails every attempt fails loudly and says no test ran', () => {
  const { state, options } = host({ mirrorFails: ATTEMPTS });
  assert.equal(install(['chromium', 'webkit'], options), null);
  assert.equal(state.mirrorCalls, ATTEMPTS);
  assert.match(state.lines.at(-1), /failed after 3 attempts; no test ran/);
});

test('a mirror install that leaves a dependency missing counts as a failed attempt', () => {
  const { state, options } = host();
  const run = options.run;
  options.run = (cmd, args, input) => (args.includes('--dry-run') ? 1 : run(cmd, args, input));
  assert.equal(install(['webkit'], options), null);
  assert.equal(state.mirrorCalls, ATTEMPTS);
});

test('the apt drop-in bounds the mirror, waits out the runner\'s own apt-get and keeps what it downloads', () => {
  const { state, options } = host({ satisfied: true });
  install(['chromium'], options);
  assert.equal(state.conf, APT_CONF);
  assert.match(APT_CONF, /Acquire::Retries "3";/);
  assert.match(APT_CONF, /Acquire::http::Timeout "20";/);
  assert.ok(Number(APT_CONF.match(/DPkg::Lock::Timeout "(\d+)"/)[1]) >= 300);
  assert.match(APT_CONF, /APT::Keep-Downloaded-Packages "true";/);
  assert.ok(ATTEMPTS >= 3);
});

test('every workflow that installs browsers on the runner goes through the one script, behind a cache keyed on the runner image (Issue #1438)', () => {
  for (const [file, browsers] of [['budgets.yml', 'chromium webkit'], ['dev-soak.yml', 'chromium']]) {
    const workflow = readFileSync(`.github/workflows/${file}`, 'utf8');
    assert.match(workflow, new RegExp(`\\n        run: node scripts/ci/install-browsers\\.mjs ${browsers}\\n`), `${file} runs the shared install`);
    const gating = workflow.split('\n  compatibility:\n')[0];
    assert.doesNotMatch(gating, /playwright install --with-deps|dpkg --configure|99weave-apt/, `${file} keeps no second copy of the install in a gating job`);
    assert.match(workflow, /run: echo "version=\$\{ImageOS\}-\$\{ImageVersion\}" >> "\$GITHUB_OUTPUT"\n/, `${file} reads the runner image version`);
    const key = workflow.match(/path: ~\/\.cache\/weave-apt\n          key: ([^\n]+)\n/);
    assert.ok(key, `${file} caches the apt packages`);
    assert.match(key[1], /\$\{\{ steps\.image\.outputs\.version \}\}/, `${file} keys the packages on the runner image, so a new image never installs another image's packages`);
    assert.match(key[1], /\$\{\{ env\.PLAYWRIGHT_VERSION \}\}/, `${file} keys the packages on the pinned Playwright`);
    assert.ok(key[1].endsWith(browsers.replace(' ', '-')), `${file} keys the packages on the browsers it installs`);
    assert.ok(workflow.indexOf('weave-apt') < workflow.indexOf('scripts/ci/install-browsers.mjs'), `${file} restores the cache before the install`);
  }
});
