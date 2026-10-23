import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testFiles, lanes } from './test.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CHUNK = 20;
export const SOURCE =/^(?:src|bin|public)\/(?!vendor\/)(?:[^/]+\/)*[^/]+\.m?js$/;

export function lineIndex(src) {
  const starts = [0];
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  return offset => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

export const executed = (functions, line) => functions.filter(f => f.ranges[0]?.count > 0).map(f => [line(f.ranges[0].startOffset), line(Math.max(f.ranges[0].startOffset, f.ranges[0].endOffset - 1))]);

export function reduceServer(raw, root = ROOT, read = file => readFileSync(join(root, file), 'utf8')) {
  const prefix = `${pathToFileURL(root).href.replace(/\/$/, '')}/`;
  const test = raw.result.map(s => s.url).find(u => u.startsWith(`${prefix}test/`) && u.endsWith('.test.mjs'));
  if (!test) return null;
  const scripts = [];
  for (const s of raw.result) {
    const path = s.url.startsWith(prefix) ? s.url.slice(prefix.length) : '';
    if (SOURCE.test(path)) scripts.push([path, executed(s.functions, lineIndex(read(path)))]);
  }
  return { test: test.slice(prefix.length), scripts };
}

export function buildMap(records, commit) {
  const tests = [...new Set(records.map(r => r.test))].sort();
  const index = new Map(tests.map((t, i) => [t, i]));
  const ranges = new Map();
  for (const { test, scripts } of records) for (const [path, fns] of scripts) {
    const byRange = ranges.get(path) ?? ranges.set(path, new Map()).get(path);
    for (const [s, e] of fns) {
      const key = `${s}:${e}`;
      (byRange.get(key) ?? byRange.set(key, new Set()).get(key)).add(index.get(test));
    }
  }
  const sets = [], setIds = new Map(), files = {};
  for (const path of [...ranges.keys()].sort()) {
    files[path] = [...ranges.get(path)]
      .map(([key, held]) => [...key.split(':').map(Number), [...held].sort((a, b) => a - b)])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([s, e, set]) => {
        const id = JSON.stringify(set);
        if (!setIds.has(id)) { setIds.set(id, sets.length); sets.push(set); }
        return [s, e, setIds.get(id)];
      });
  }
  return { commit, tests, sets, files };
}

export const recordsOf = map => Object.entries(map.files).flatMap(([path, entries]) => entries.flatMap(([s, e, set]) => map.sets[set].map(i => ({ test: map.tests[i], scripts: [[path, [[s, e]]]] }))));

export function serialize(map) {
  const rows = list => list.map(x => JSON.stringify(x)).join(',\n');
  const files = Object.entries(map.files).map(([path, entries]) => `${JSON.stringify(path)}:${JSON.stringify(entries)}`).join(',\n');
  return `{"commit":${JSON.stringify(map.commit)},\n"tests":[\n${rows(map.tests)}\n],\n"sets":[\n${rows(map.sets)}\n],\n"files":{\n${files}\n}}\n`;
}

async function main() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--', 'src', 'bin', 'public')) throw new Error('src/, bin/ or public/ differ from HEAD: commit or drop those changes so map lines match the recorded commit');
  const commit = git('log', '-1', '--format=%H', '--', 'src', 'bin', 'public');
  const args = process.argv.slice(2);
  const named = args.filter(a => !a.startsWith('--'));
  const shard = args.find(a => a.startsWith('--shard='))?.slice(8).split('/').map(Number);
  const lane = lanes(testFiles(ROOT), ROOT).browser;
  const out = join(ROOT, 'test/coverage-map.json');
  if (args.includes('--merge')) {
    const maps = named.map(file => JSON.parse(readFileSync(file, 'utf8')));
    if (!maps.length || maps.some(m => m.commit !== maps[0].commit)) throw new Error('--merge needs partial maps generated at one commit');
    const map = buildMap(maps.flatMap(recordsOf), maps[0].commit);
    writeFileSync(out, serialize(map));
    const missing = lane.filter(f => !map.tests.includes(f));
    console.log(`# COVERAGE MAP merged ${maps.length} parts: ${map.tests.length} of ${lane.length} browser files, ${Object.keys(map.files).length} source files, ${map.sets.length} test sets, ${serialize(map).length} bytes at ${map.commit}`);
    if (missing.length) console.log(`# NOT MAPPED (always selected by pr-plan): ${missing.join(' ')}`);
    return;
  }
  const files = named.length ? named : shard ? lane.filter((_, i) => i % shard[1] === shard[0] - 1) : lane;
  const prior = named.length && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  const records = prior?.commit === commit ? recordsOf(prior).filter(r => !files.includes(r.test)) : [];
  const sources = new Map();
  const read = path => sources.get(path) ?? sources.set(path, readFileSync(join(ROOT, path), 'utf8')).get(path);
  const start = Date.now();
  let code = 0, map, text;
  for (let i = 0; i < files.length; i += CHUNK) {
    const dir = mkdtempSync(join(tmpdir(), 'coverage-map-'));
    const server = join(dir, 'server'), client = join(dir, 'client');
    mkdirSync(server); mkdirSync(client);
    const status = await new Promise(done => spawn(process.execPath, ['scripts/test.mjs', '--targeted', ...files.slice(i, i + CHUNK)], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_V8_COVERAGE: server, WEAVE_CLIENT_COVERAGE: client, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(join(ROOT, 'scripts/coverage-hook.mjs')).href}`.trim() },
    }).on('exit', s => done(s ?? 1)));
    code ||= status;
    for (const name of readdirSync(server)) {
      let raw;
      try { raw = JSON.parse(readFileSync(join(server, name), 'utf8')); } catch { continue; }
      const record = reduceServer(raw, ROOT, read);
      if (record) records.push(record);
    }
    for (const name of readdirSync(client)) {
      const { test, scripts } = JSON.parse(readFileSync(join(client, name), 'utf8'));
      records.push({ test, scripts: scripts.filter(([path]) => existsSync(join(ROOT, path))) });
    }
    rmSync(dir, { recursive: true, force: true });
    map = buildMap(records, commit);
    text = serialize(map);
    writeFileSync(out, text);
    console.log(`# COVERAGE MAP ${map.tests.length} of ${lane.length} browser files after ${Math.min(i + CHUNK, files.length)} of ${files.length} run, ${Object.keys(map.files).length} source files, ${map.sets.length} test sets, ${text.length} bytes, ${Math.round((Date.now() - start) / 60000)} min at ${commit}`);
  }
  const missing = lane.filter(f => !map.tests.includes(f));
  if (missing.length) console.log(`# NOT MAPPED (always selected by pr-plan): ${missing.join(' ')}`);
  process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
