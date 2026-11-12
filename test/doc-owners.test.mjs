import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CLAUDE = read('CLAUDE.md');
const DEV = read('DEVELOPMENT.md');
const AGENTS = read('AGENTS.md');
const CONTRIBUTING = read('CONTRIBUTING.md');
const MAINTAINER = { 'CLAUDE.md': CLAUDE, 'DEVELOPMENT.md': DEV, 'AGENTS.md': AGENTS, 'CONTRIBUTING.md': CONTRIBUTING };

const section = (doc, heading) => {
  const level = heading.match(/^#+/)[0];
  const start = doc.indexOf(`\n${heading}\n`);
  if (start < 0) return null;
  const next = [...doc.slice(start + 1).matchAll(/\n(#+) /g)].find((m) => m[1].length <= level.length);
  return doc.slice(start + 1, next ? start + 1 + next.index + 1 : undefined);
};

const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');
const anchors = (doc) => new Set(doc.split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, ''))));

const REQUIRED = [['Dev gate', 'dev.yml'], ['PR gate', 'pr.yml'], ['security scan', 'security.yml']];

test('CLAUDE.md is a routing table: every route resolves to an owner heading and every gate exists', () => {
  const links = [...CLAUDE.matchAll(/\]\(([^)#\s]+)(?:#([^)\s]+))?\)/g)].filter(([, path]) => !/^https?:/.test(path));
  assert.ok(links.length >= 10, `CLAUDE.md routes to ${links.length} owners`);
  for (const [, path, anchor] of links) {
    assert.ok(existsSync(join(ROOT, path)), `CLAUDE.md routes to ${path}, which does not exist`);
    if (anchor) assert.ok(anchors(read(path)).has(anchor), `CLAUDE.md routes to ${path}#${anchor}, which names no heading there`);
  }
  for (const [, gate] of CLAUDE.matchAll(/`(test\/[\w./-]+\.test\.mjs)`/g)) {
    assert.ok(existsSync(join(ROOT, gate)), `CLAUDE.md names the gate ${gate}, which does not exist`);
  }
  const rows = section(CLAUDE, '## House rules').split('\n').filter((l) => l.startsWith('| ') && !/^\| (Concern|---)/.test(l));
  assert.ok(rows.length >= 12, `the House rules table has ${rows.length} rows`);
  for (const row of rows) assert.match(row, /\]\([^)]+\)/, `every rule routes to its owner: ${row}`);
  assert.ok(CLAUDE.length <= 6000, `CLAUDE.md is ${CLAUDE.length} bytes; it routes, the owners hold the rules`);
});

test('each named fact has one owner among the maintainer docs', () => {
  const FACTS = [
    ['the Node floor', /22\.16/, 'CONTRIBUTING.md'],
    ['the release order', /changelog-fold\.mjs/, 'DEVELOPMENT.md'],
    ['the browser waits', /\batRest\b/, 'DEVELOPMENT.md'],
    ['the required checks', /`security scan`/, 'DEVELOPMENT.md'],
    ['the tracker read copy and its renumbering', /renumber/, 'DEVELOPMENT.md'],
    ['the vendored versions, which README renders from the lock', /\b(mermaid|DOMPurify|KaTeX|Vditor|highlight\.js|@tabler\/core)\s+v?\d+\.\d/i, null],
  ];
  for (const [fact, re, owner] of FACTS) {
    const stating = Object.keys(MAINTAINER).filter((name) => re.test(MAINTAINER[name]));
    assert.deepEqual(stating, owner ? [owner] : [], `${fact}: stated in ${stating.join(', ') || 'no doc'}, owned by ${owner ?? 'README.md'}`);
  }
});

test('DEVELOPMENT.md names exactly the required checks the workflows run', () => {
  for (const [check, file] of REQUIRED) {
    assert.match(read(`.github/workflows/${file}`), new RegExp(`\\n    name: ${check}\\n`), `${file} runs the ${check} job`);
  }
  const flow = section(DEV, '## Daily flow');
  const at = flow.indexOf('checks are required');
  assert.ok(at > 0, 'Daily flow says which checks are required');
  const sentence = flow.slice(at - 6, at + flow.slice(at).search(/\.(\s|$)/));
  assert.match(sentence, /^Three /, 'the count matches the three required checks');
  for (const [check] of REQUIRED) assert.match(sentence, new RegExp(`\`${check}\``), `the required checks name ${check}`);
  for (const [name, doc] of Object.entries(MAINTAINER)) {
    assert.doesNotMatch(doc, /Two checks are required|is the required check|the required `Dev gate`/, `${name} names fewer required checks than branch protection`);
    assert.doesNotMatch(doc, /under six minutes|fifteen-minute job timeout/, `${name} carries a stale gate number`);
  }
});

test('test runs have one policy: targeted locally, the full suite on CI', () => {
  const runs = section(DEV, '## Running tests');
  assert.ok(runs, 'DEVELOPMENT.md has a Running tests section');
  assert.match(runs, /CI owns full verification/);
  assert.match(runs, /npm test -- --targeted/);
  assert.match(runs, /Never invoke bare `node --test`/);
  assert.match(runs, /\.github\/test-tools/, 'the Playwright pin browser runs install');
  for (const ledger of ['a11y-baseline', 'byte-budget', 'click-budget', 'cutoff-baseline', 'feedback-budget', 'flicker-fixed', 'onboarding-steps', 'render-budget', 'touch-baseline', 'touch-held', 'vitals-budget']) {
    assert.ok(existsSync(join(ROOT, `test/${ledger}.json`)), `test/${ledger}.json exists`);
    assert.match(runs, new RegExp(`test/${ledger}\\.json`), `Running tests lists the ${ledger} ledger`);
  }
  assert.doesNotMatch(DEV, /Use `npm test` for full verification|Full landing verification remains mandatory|optional, for debugging a failure/, 'no second policy');
  const repoMap = section(AGENTS, '### Repo map');
  assert.doesNotMatch(repoMap, /`node --test` suites/, 'the repo map describes the runner, not bare node --test');
  assert.match(repoMap, /\| `test\/` \|[^\n]*`npm test`/);
});

test('the tracker has one owner, and CLAUDE.md names the offline read copy', () => {
  const tracker = section(DEV, '## The tracker');
  assert.ok(tracker, 'DEVELOPMENT.md has a tracker section');
  for (const fact of [/https:\/\/weave\.grunion\.ai\/w\/weave/, /`docs\/development\.json`/, /WEAVE_TRACKER_CANONICAL=1/, /renumber/, /node bin\/weave\.js --data/, /Quality\/Suite/, /enriched/]) {
    assert.match(tracker, fact, `the tracker section says ${fact}`);
  }
  const mandate = section(CLAUDE, '## The weave-workspace mandate (non-negotiable)');
  assert.match(mandate, /DEVELOPMENT\.md#the-tracker/);
  assert.match(mandate, /`docs\/development\.json`/);
  assert.match(mandate, /node bin\/weave\.js --data/);
  assert.match(mandate, /https:\/\/weave\.grunion\.ai\/w\/weave/);
  assert.doesNotMatch(CLAUDE, /curl[^\n]*127\.0\.0\.1:4400/, 'the local instance answers 401 without a sign-in');
});

test('rules carry no incident history', () => {
  for (const [name, doc] of [['CLAUDE.md', CLAUDE], ['DEVELOPMENT.md', DEV]]) {
    assert.deepEqual(doc.match(/\b\d{11}\b/g) ?? [], [], `${name} cites run ids; they belong on the Issue row`);
    assert.deepEqual(doc.match(/\b20\d\d-\d\d-\d\d\b/g) ?? [], [], `${name} carries dates; they belong on the Issue row`);
    assert.deepEqual(doc.match(/\bPR #\d+/g) ?? [], [], `${name} retells pull requests; they belong on the Issue row`);
  }
  for (const [name, doc] of Object.entries(MAINTAINER)) assert.doesNotMatch(doc, /Gerrit/, `${name} still describes the retired Gerrit queue`);
  assert.doesNotMatch(CLAUDE, /weaver/, 'the rename aside is history');
});

test('AGENTS.md and CONTRIBUTING.md point at the owners instead of restating them', () => {
  const rules = section(AGENTS, '### Rules for changing this repo');
  assert.match(rules, /CONTRIBUTING\.md#the-rules/);
  assert.match(rules, /DEVELOPMENT\.md/);
  assert.ok(rules.length <= 1200, `AGENTS.md Rules for changing this repo is ${rules.length} bytes; it points, CONTRIBUTING.md holds the rules`);
  assert.doesNotMatch(AGENTS, /installs each new release\s+tag/, 'production follows the production branch, not release tags');
  const theRules = section(CONTRIBUTING, '## The rules');
  for (const rule of [/Zero runtime dependencies/, /No build step/, /Both themes/, /Never commit workspace data/, /No inline comments/, /changelog\.d\//, /SOUL\.md/]) {
    assert.match(theRules, rule, `CONTRIBUTING.md owns ${rule}`);
  }
});
