import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const GATES = ['pr.yml', 'test.yml'];
const IMAGE = /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[0-9a-f]{64}$/;
const workflow = (file) => readFileSync(`.github/workflows/${file}`, 'utf8');
const tools = JSON.parse(readFileSync('.github/test-tools/package.json', 'utf8'));
const lock = JSON.parse(readFileSync('.github/test-tools/package-lock.json', 'utf8'));

function job(source, name) {
  const at = source.indexOf(`\n  ${name}:\n`);
  assert.ok(at >= 0, `the workflow has a ${name} job`);
  return source.slice(at + 1).split(/\n(?=  \S)/)[0];
}

function containerOf(file) {
  const steps = job(workflow(file), 'test');
  const at = steps.indexOf('\n    container:\n');
  assert.ok(at >= 0, `${file} runs its test job in a container`);
  const block = steps.slice(at + 1).split(/\n(?=    \S)/)[0];
  const image = block.match(/^      image: \$\{\{ matrix\.lane == 'browser' && '([^']+)' \|\| '' \}\}$/m);
  const options = block.match(/^      options: (.+)$/m);
  assert.ok(image && options, `${file} starts its browser shards in a container and leaves every other lane on the runner`);
  return { image: image[1], options: options[1].trim().split(/\s+/), volumes: [...block.matchAll(/^        - (.+)$/gm)].map((m) => m[1]) };
}

const sources = (dir = 'test') => readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.mjs')).map((f) => readFileSync(join(dir, String(f)), 'utf8'));

test('the browser shards of the PR gate and the CI gate start from one Playwright image pinned by digest (Feature #368)', () => {
  const [pr, main] = GATES.map(containerOf);
  assert.match(pr.image, IMAGE, 'the image is named by its Playwright release and its @sha256 digest, so a moved tag never changes the browsers under test');
  assert.equal(main.image, pr.image, 'a pull request passes on the engines main runs');
});

test('the pinned image carries the browsers of the driver every shard installs (Feature #368)', () => {
  const version = containerOf('pr.yml').image.match(IMAGE)[1];
  const why = 'the image holds the engines of one Playwright release under /ms-playwright, and a driver of another release launches none of them; bump .github/test-tools and the image tag and digest together';
  assert.equal(tools.devDependencies.playwright, version, why);
  assert.equal(lock.packages['node_modules/playwright'].version, version, why);
  assert.equal(lock.packages['node_modules/playwright-core'].version, version, why);
});

test('the browser container runs as the runner user, on the host IPC namespace, behind an init process (Feature #368)', () => {
  for (const file of GATES) {
    const { options } = containerOf(file);
    assert.equal(options[options.indexOf('--user') + 1], '1001',
      `${file}: the checkout belongs to the runner user, uid 1001, and git refuses a repository another user owns, which fails the shard's git rev-parse in scripts/ci-test.mjs and git ls-files in scripts/test-manager.mjs`);
    assert.ok(options.includes('--ipc=host'), `${file}: Chromium and WebKit share memory between their processes, and a container's own /dev/shm holds 64 MB`);
    assert.ok(options.includes('--init'), `${file}: the test manager detaches its server, and an init process reaps it and every browser process a shard leaves behind, as the runner's own init does`);
  }
});

test('every .localhost host a test names resolves inside the browser container (Feature #368)', () => {
  const named = new Set(sources().flatMap((source) => [...source.matchAll(/\b([a-z0-9-]+)\.localhost\b/g)].map((m) => `${m[1]}.localhost:127.0.0.1`)));
  assert.ok(named.size > 0, 'the multi-host journeys name their hosts');
  for (const file of GATES) {
    const { options } = containerOf(file);
    const added = options.flatMap((option, i) => (option === '--add-host' ? [options[i + 1]] : []));
    assert.deepEqual([...named].filter((host) => !added.includes(host)), [],
      `${file}: the runner resolves every *.localhost name through systemd-resolved and the image has no such resolver, so Node's getaddrinfo (route.fetch, page.request) and WebKit's loads fail with ENOTFOUND unless the container lists the host`);
  }
});

test('the browser container reads the runner\'s fonts beside the image\'s own (Feature #368)', () => {
  for (const file of GATES) {
    assert.ok(containerOf(file).volumes.includes('/usr/share/fonts:/usr/local/share/fonts/runner:ro'),
      `${file}: the layout probes were calibrated on the runner's fonts, and the image has no DejaVu, so test/line-endings-gate-browser.test.mjs breaks its 14px sans-serif and monospace lines elsewhere and test/grid-scroll-edge-browser.test.mjs overflows a table that fits`);
  }
});

test('no gating shard installs browsers or system packages at test time (Feature #368)', () => {
  for (const file of GATES) {
    const gating = workflow(file).split('\n  compatibility:\n')[0];
    assert.doesNotMatch(gating, /install-browsers|playwright install|install-deps|apt-get|dpkg|sudo |weave-apt|ms-playwright|ImageOS/,
      `${file} takes its browsers and their system packages from the image; an apt install at test time timed the step out on main 13 times between 2026-11-05 and 2026-11-09`);
  }
});

test('a step in the browser container calls no tool the image lacks (Feature #368)', () => {
  for (const file of GATES) {
    assert.doesNotMatch(job(workflow(file), 'test'), /(?:^|[\s;|&(])gh\s/m, `${file}: the Playwright image ships Node and git, not the GitHub CLI`);
  }
  assert.match(job(workflow('test.yml'), 'test'),
    /- name: Durations the plan job used\n        uses: actions\/download-artifact@[0-9a-f]{40}\n        with:\n          pattern: plan-history\n          path: ci-history\n          merge-multiple: true\n/,
    'each shard takes the plan job\'s durations through the artifact action, which runs inside the container and downloads nothing when the plan kept no history');
});
