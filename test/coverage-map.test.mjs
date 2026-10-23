import test from 'node:test';
import assert from 'node:assert/strict';
import { lineIndex, executed, reduceServer, buildMap, serialize, recordsOf, SOURCE } from '../scripts/coverage-map.mjs';

test('offsets become 1-based lines and executed functions become line spans', () => {
  const line = lineIndex('a\nbb\n\nccc');
  assert.deepEqual([0, 1, 2, 4, 5, 6, 9].map(line), [1, 1, 2, 2, 3, 4, 4]);
  const fns = [
    { functionName: '', ranges: [{ startOffset: 0, endOffset: 9, count: 1 }] },
    { functionName: 'b', ranges: [{ startOffset: 2, endOffset: 5, count: 3 }, { startOffset: 3, endOffset: 4, count: 0 }] },
    { functionName: 'dead', ranges: [{ startOffset: 6, endOffset: 9, count: 0 }] },
  ];
  assert.deepEqual(executed(fns, line), [[1, 4], [2, 2]]);
});

test('only first-party src, bin and public scripts are mapped, never vendored code or tests', () => {
  for (const ok of ['src/routes.js', 'bin/weave.js', 'public/app.js', 'public/showcase/demo.js', 'src/lib/x.mjs']) assert.ok(SOURCE.test(ok), ok);
  for (const no of ['public/vendor/mermaid.min.js', 'src/vendor/a.js', 'test/a.test.mjs', 'public/app.css', 'scripts/test.mjs', '']) assert.ok(!SOURCE.test(no), no);
});

test('a V8 dump is attributed to the test file whose URL it holds', () => {
  const root = '/repo';
  const raw = { result: [
    { url: 'node:internal/x', functions: [] },
    { url: 'file:///repo/test/grid-browser.test.mjs', functions: [{ ranges: [{ startOffset: 0, endOffset: 3, count: 1 }] }] },
    { url: 'file:///repo/src/routes.js', functions: [{ ranges: [{ startOffset: 0, endOffset: 6, count: 1 }] }, { ranges: [{ startOffset: 4, endOffset: 6, count: 0 }] }] },
    { url: 'file:///repo/public/vendor/v.js', functions: [{ ranges: [{ startOffset: 0, endOffset: 1, count: 1 }] }] },
  ] };
  assert.deepEqual(reduceServer(raw, root, () => 'ab\ncd\n'), { test: 'test/grid-browser.test.mjs', scripts: [['src/routes.js', [[1, 2]]]] });
  assert.equal(reduceServer({ result: [raw.result[2]] }, root, () => ''), null);
});

test('records from many tests merge into sorted entries over shared, deduplicated test sets', () => {
  const records = [
    { test: 'test/b-browser.test.mjs', scripts: [['src/a.js', [[1, 9], [3, 4]]]] },
    { test: 'test/a-browser.test.mjs', scripts: [['src/a.js', [[1, 9]]], ['public/app.js', [[1, 50], [10, 12]]]] },
    { test: 'test/a-browser.test.mjs', scripts: [['public/app.js', [[10, 12]]]] },
  ];
  const map = buildMap(records, 'c'.repeat(40));
  assert.deepEqual(map, {
    commit: 'c'.repeat(40),
    tests: ['test/a-browser.test.mjs', 'test/b-browser.test.mjs'],
    sets: [[0], [0, 1], [1]],
    files: { 'public/app.js': [[1, 50, 0], [10, 12, 0]], 'src/a.js': [[1, 9, 1], [3, 4, 2]] },
  });
  assert.deepEqual(buildMap([...records].reverse(), map.commit), map);
  assert.deepEqual(JSON.parse(serialize(map)), map);
  assert.deepEqual(buildMap(recordsOf(map), map.commit), map);
});

test('the coverage-map workflow records eight shards on GitHub runners and merges them into one artifact', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('.github/workflows/coverage-map.yml', 'utf8');
  assert.match(src, /^on:\n  pull_request:\n    paths:\n      - scripts\/coverage-map\.mjs\n/m);
  assert.match(src, /schedule:\n    - cron: "\d+ \d+ \* \* 1"\n  workflow_dispatch:\n/);
  assert.match(src, /shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/);
  assert.match(src, /node scripts\/coverage-map\.mjs "--shard=\$SHARD\/8"/);
  assert.match(src, /test "\$\(ls parts\/\*\/coverage-map\.json \| wc -l\)" -eq 8/);
  assert.match(src, /node scripts\/coverage-map\.mjs --merge parts\/\*\/coverage-map\.json/);
  assert.match(src, /name: coverage-map\n          path: test\/coverage-map\.json/);
});

test('the committed map is fresh enough that unmapped browser tests stay a small always-run set', async () => {
  const { readFileSync } = await import('node:fs');
  const { testFiles, lanes } = await import('../scripts/test.mjs');
  const map = JSON.parse(readFileSync('test/coverage-map.json', 'utf8'));
  const unmapped = lanes(testFiles()).browser.filter(f => !map.tests.includes(f));
  assert.ok(unmapped.length <= 20, `${unmapped.length} browser tests are missing from test/coverage-map.json and run on every PR; commit the newest map: gh run download -R grunion-ai/weave -n coverage-map -D test "$(gh run list -R grunion-ai/weave -w coverage-map -s success -L 1 --json databaseId -q '.[0].databaseId')" (or gh workflow run coverage-map first): ${unmapped.join(' ')}`);
});
