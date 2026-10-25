import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../src/mcp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const SELF = 'test/census.test.mjs';

const ALLOW = {};

const METHOD = /(?:rx\.method|m2) === '([A-Z]+)'/g;
const LISTED = /\[((?:'[A-Z]+',? ?)+)\]\.includes\((?:rx\.method|m2)\)/g;
const methodsOn = (line) => [...new Set([
  ...[...line.matchAll(METHOD)].map((m) => m[1]),
  ...[...line.matchAll(LISTED)].flatMap((m) => m[1].match(/[A-Z]+/g)),
])].filter((m) => m !== 'HEAD');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function blockMethods(lines, at) {
  const indent = lines[at].match(/^ */)[0].length;
  const close = new RegExp(`^ {${indent}}\\}`);
  const direct = new RegExp(`^ {${indent + 2}}return `);
  const found = new Set();
  for (let j = at + 1; j < lines.length && !close.test(lines[j]); j++) {
    for (const m of methodsOn(lines[j])) found.add(m);
    if (direct.test(lines[j])) found.add('GET');
  }
  return found.size ? [...found] : ['GET'];
}

const pretty = (re) => re
  .replace(/\(\?:\\\/\(\[\^\/\]\+\?\)\)\?/g, '[/:name]')
  .replace(/\((?:\[\^\/\]\+\??|\.\+|\[A-Za-z0-9_-\]\+)\)/g, ':id')
  .replace(/\(([a-z]+(?:\|[a-z]+)+)\)/g, '{$1}')
  .replace(/\\(.)/g, '$1');

export function listRoutes(file) {
  const lines = read(file).split('\n');
  const routes = new Map();
  const assumed = new Set();
  const add = (method, source, path, guess = false) => {
    const key = `${method} ${path}`;
    if (guess && routes.has(key)) return;
    if (guess) assumed.add(key);
    else assumed.delete(key);
    routes.set(key, { method, source, path, file });
  };
  lines.forEach((line, i) => {
    const explicit = methodsOn(line);
    for (const [, method, path] of line.matchAll(/route === '([A-Z]+) ([^']+)'/g)) add(method, escape(path), path);
    for (const [, path] of line.matchAll(/path === '([^']+)'/g)) {
      if (explicit.length) for (const method of explicit) add(method, escape(path), path);
      else add('GET', escape(path), path, true);
    }
    for (const [, re] of line.matchAll(/path\.match\(\/\^(.+?)\$\/\)/g)) {
      for (const method of explicit.length ? explicit : blockMethods(lines, i)) add(method, re, pretty(re));
    }
  });
  const named = new Set([...routes.keys()].filter((k) => !assumed.has(k)).map((k) => k.slice(k.indexOf(' ') + 1)));
  return [...routes.entries()].filter(([k, r]) => !assumed.has(k) || !named.has(r.path)).map(([, r]) => r);
}

const PARAM = String.raw`(?:\$\{[^}\n]*\}|['"\x60]\s*\+\s*[\w.$[\]()'"]+?\s*\+\s*['"\x60]|['"\x60]\s*\+\s*[\w.$[\]()'"]+|[\w.:~%@-]+)`;
const GROUP = /\((?:\[\^\/\]\+\??|\.\+|\[A-Za-z0-9_-\]\+)\)/g;

export function pathMatcher(source) {
  const body = source.replace(GROUP, PARAM).replace(/\((?=[a-z]+\|)/g, '(?:');
  return new RegExp(`(?<!\\b(?:GET|HEAD|POST|PUT|PATCH|DELETE) )${body}(?![\\w/-])`, 'g');
}

const QUOTED_METHOD = /['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]/g;
const VERB_HELPER = /(?<![.\w])(post|put|patch|del|delete)\w*\s*\(/i;
const quoted = (line) => [...line.matchAll(QUOTED_METHOD)].map((m) => m[1]);
const depth = (line) => (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;

function methodsNear(lines, i) {
  const own = quoted(lines[i]);
  if (own.length) return own;
  const verb = lines[i].match(VERB_HELPER)?.[1].toUpperCase();
  if (verb) return [verb === 'DEL' ? 'DELETE' : verb];
  const near = [];
  if (i > 0 && /[(,]\s*$/.test(lines[i - 1])) near.push(...quoted(lines[i - 1]));
  for (let j = i + 1, open = depth(lines[i]); open > 0 && j < Math.min(lines.length, i + 4); open += depth(lines[j]), j++) near.push(...quoted(lines[j]));
  return near;
}

function testSources(dir = join(ROOT, 'test')) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    if (d.isDirectory()) out.push(...testSources(full));
    else if (d.name.endsWith('.mjs') && relative(ROOT, full) !== SELF) out.push({ file: relative(ROOT, full), text: readFileSync(full, 'utf8') });
  }
  return out;
}

const SOURCES = testSources();

export function routeCallers(route, sources = SOURCES) {
  const re = pathMatcher(route.source);
  const hits = [];
  for (const { file, text } of sources) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      if (!re.test(line)) return;
      const near = methodsNear(lines, i);
      const ok = near.length ? near.includes(route.method) : route.method === 'GET';
      if (ok) hits.push(file);
    });
  }
  return hits;
}

export function toolCallers(name, sources = SOURCES) {
  const q = `['"\\x60]${escape(name)}['"\\x60]`;
  const re = new RegExp(`(?:(?<![.\\w])\\w+\\(\\s*(?:[\\w.]+\\s*,\\s*)?|\\b(?:name|tool)\\s*:\\s*)${q}|\\[\\s*${q}\\s*,\\s*\\{`);
  return sources.filter(({ text }) => re.test(text)).map((s) => s.file);
}

export function listCommands(src = read('bin/weave.js')) {
  const names = new Set();
  for (const [, c] of src.matchAll(/command === '([\w-]+)'/g)) names.add(c);
  for (const [, c] of src.matchAll(/^ {4}case '([\w-]+)':/gm)) names.add(c);
  names.delete('help');
  return [...names].sort();
}

export function commandCallers(name, sources = SOURCES) {
  const q = `['"]${escape(name)}['"]`;
  const re = new RegExp(`(?:(?<![.\\w])\\w+\\(\\s*\\[?\\s*${q}|\\[[^\\]\\n]*?\\b\\w+\\s*,\\s*${q})`);
  return sources.filter(({ text }) => /weave\.js/.test(text) && re.test(text)).map((s) => s.file);
}

const ROUTES = [...listRoutes('src/routes.js'), ...listRoutes('src/applet.js')];
const COMMANDS = listCommands();
const census = () => [
  ...ROUTES.map((r) => ({ key: `${r.method} ${r.path}`, callers: routeCallers(r) })),
  ...TOOLS.map((t) => ({ key: `mcp ${t.name}`, callers: toolCallers(t.name) })),
  ...COMMANDS.map((c) => ({ key: `cli ${c}`, callers: commandCallers(c) })),
];

test('the census sees the dispatcher, the applet, the MCP tool list and the CLI command table', () => {
  const keys = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
  for (const k of ['GET /api/health', 'POST /api/entities/:id/link', 'POST /api/entities/:id/unlink', 'DELETE /api/entities/:id/files/:id',
    'PATCH /api/automations/:id', 'DELETE /api/automations/:id', 'PATCH /t/entity/:id', 'GET /t/entity/:id', 'DELETE /api/keys/:id/share',
    'POST /api/keys/:id/share', 'GET /api/relation-map.mmd', 'PUT /api/entities/:id/doc', 'POST /api/entities/:id/doc']) {
    assert.ok(keys.has(k), `the route list lacks ${k}`);
  }
  assert.ok(!keys.has('GET /api/keys/:id/share'), 'the key share route answers POST and DELETE only');
  assert.ok(keys.has('POST /api/views/:id/share') && !keys.has('GET /api/views/:id/share'), 'a method list on the matching line is read');
  assert.ok(keys.has('POST /api/build') && !keys.has('GET /api/build'), 'a path a guard names is not a GET route when the dispatcher serves it under another method');
  assert.ok(keys.has('GET /status') && keys.has('GET /privacy'), 'a path only a guard names stays a GET route');
  assert.ok(ROUTES.length > 170, `only ${ROUTES.length} routes derived`);
  for (const r of ROUTES) assert.doesNotThrow(() => pathMatcher(r.source), `${r.method} ${r.path} builds no matcher`);
  assert.ok(TOOLS.length > 50, `only ${TOOLS.length} MCP tools`);
  for (const c of ['audit', 'undo', 'quality', 'delete', 'serve', 'mcp', 'link']) assert.ok(COMMANDS.includes(c), `the command table lacks ${c}`);
});

test('the matchers find a call in each shape a test writes one', () => {
  const route = (method, path) => ROUTES.find((r) => r.method === method && r.path === path);
  const src = (text) => [{ file: 'x.mjs', text }];
  const link = route('POST', '/api/entities/:id/link');
  assert.equal(routeCallers(link, src("await call('POST', `/api/entities/${e.id}/link`, { body })")).length, 1);
  assert.equal(routeCallers(link, src("await req(port, 'POST', '/api/entities/' + e.id + '/link', {})")).length, 1);
  assert.equal(routeCallers(link, src("await call('GET', `/api/entities/${e.id}/link`)")).length, 0, 'the method counts');
  assert.equal(routeCallers(link, src("await call('POST', `/api/entities/${e.id}/linked`)")).length, 0, 'the whole path counts');
  assert.equal(routeCallers(link, src("await post(`${base}/api/entities/${e.id}/link`, { field })")).length, 1, 'a verb helper names the method');
  assert.equal(routeCallers(link, src("await fetch(`${base}/api/entities/${e.id}/link`, {\n  method: 'POST',\n  body,\n})")).length, 1, 'an options object on the next lines names it');
  assert.equal(routeCallers(link, src("['entity.link', ['link'], 'weave_link', 'link', ['POST /api/entities/:ref/link']],")).length, 0, 'a route label is not a call');
  const map = route('GET', '/api/relation-map.mmd');
  assert.equal(routeCallers(map, src("await fetch(`${base}/w/acme/api/relation-map.mmd`)")).length, 1);
  assert.equal(routeCallers(map, src("const r = await get('/api/relation-map.mmd');\nawait call('POST', '/api/other');")).length, 1, 'a neighbour line does not lend its method');
  assert.equal(routeCallers(route('POST', '/api/start/invites/:id/:id'), src("await s.apex('POST', '/api/start/invites/acme/' + 'a'.repeat(64), { body: {} })")).length, 1);
  assert.equal(toolCallers('weave_undo', src("call(w, 'weave_undo', {})")).length, 1);
  assert.equal(toolCallers('weave_undo', src("dispatchTool(w, 'weave_undo', {})")).length, 1);
  assert.equal(toolCallers('weave_undo', src("params: { name: 'weave_undo', arguments: {} }")).length, 1);
  assert.equal(toolCallers('weave_undo', src("  ['weave_undo', { steps: 1 }],")).length, 1, 'a name and arguments pair fed to a loop is a call');
  assert.equal(toolCallers('weave_undo', src("assert.ok(names.includes('weave_undo'))")).length, 0, 'a mention is not a call');
  assert.equal(toolCallers('weave_undo', src("for (const n of ['weave_undo', 'weave_audit']) assert.ok(TOOLS.find((t) => t.name === n));")).length, 0, 'a list of names is not a call');
  const bin = "const BIN = join(ROOT, 'bin', 'weave.js');\n";
  assert.equal(commandCallers('audit', src(`${bin}cli('audit', '--limit', '5')`)).length, 1);
  assert.equal(commandCallers('audit', src(`${bin}spawnSync('node', [BIN, 'audit'])`)).length, 1);
  assert.equal(commandCallers('delete', src(`${bin}cli('comment', 'delete', id)`)).length, 0, 'a subcommand is not the top-level command');
  assert.equal(commandCallers('audit', src("cli('audit')")).length, 0, 'a file that never names the binary calls no command');
});

test('Issue #1080: every route, MCP tool and CLI command has a test that calls it', () => {
  const missing = census().filter((e) => !e.callers.length && !(e.key in ALLOW)).map((e) => e.key);
  assert.deepEqual(missing, [], `no test calls:\n  ${missing.join('\n  ')}`);
});

test('the allow-list is short, reasoned and current', () => {
  const entries = Object.entries(ALLOW);
  assert.ok(entries.length <= 3, `${entries.length} allow-listed entries; call them instead`);
  const all = new Map(census().map((e) => [e.key, e.callers]));
  for (const [key, reason] of entries) {
    assert.ok(all.has(key), `${key} is allow-listed but no longer exists`);
    assert.ok(typeof reason === 'string' && reason.trim().length > 10, `${key} needs a one-line reason`);
    assert.deepEqual(all.get(key), [], `${key} is allow-listed but ${all.get(key)[0]} calls it now`);
  }
});
