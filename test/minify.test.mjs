import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { minifyJs, minifyCss, createMinified } from '../src/minify.js';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { ROOT } from './lib/source.mjs';
import { firstPartyAssets } from './lib/bytes.mjs';

const PUBLIC = join(ROOT, 'public');
const ASSETS = firstPartyAssets(PUBLIC);

test('minifyJs drops indentation, comments and spaces beside punctuation, and keeps every line', () => {
  const src = 'function f (a, b) {\n    if (a === b) {\n        return a + b; // sum\n    }\n\n    return  a * b;\n}\n';
  const out = minifyJs(src);
  assert.equal(out, 'function f(a,b){\nif(a===b){\nreturn a+b;\n}\n\nreturn a*b;\n}\n');
  assert.equal(out.split('\n').length, src.split('\n').length, 'a stack trace line still points at the source line');
});

test('minifyJs leaves strings, templates and regular expressions byte for byte', () => {
  const cases = [
    ["const s = 'a  b // not a comment';", "const s='a  b // not a comment';"],
    ['const s = "a /* b */ c";', 'const s="a /* b */ c";'],
    ['const t = `a  ${ x + `inner  ${ y }  text` }  b`;', 'const t=`a  ${x+`inner  ${y}  text`}  b`;'],
    ['const t = `${ { a: 1 }.a }  ${"}"}`;', 'const t=`${{a:1}.a}  ${"}"}`;'],
    ['const r = /a b[/ ]c/g.test(s);', 'const r=/a b[/ ]c/g.test(s);'],
    ['x = y => /  x/.test(y);', 'x=y=>/  x/.test(y);'],
    ['if (!x) return /re  /i;', 'if(!x)return/re  /i;'],
  ];
  for (const [src, want] of cases) assert.equal(minifyJs(src), want);
});

test('minifyJs keeps the spaces that change meaning', () => {
  assert.equal(minifyJs('a + +b; c - -d; e + ++f;'), 'a+ +b;c- -d;e+ ++f;');
  assert.equal(minifyJs('x = 1 .toString();'), 'x=1 .toString();');
  assert.equal(minifyJs('if (a < !--b) c();'), 'if(a< !--b)c();');
  assert.equal(minifyJs('const a = b / c; d = /re/ in e;'), 'const a=b/c;d=/re/ in e;');
  assert.equal(minifyJs('return typeof x;'), 'return typeof x;');
  assert.equal(minifyJs('a = b\n++c'), 'a=b\n++c', 'ASI sees the same line break');
  assert.equal(minifyJs('i++ / 2 / 3'), 'i++/2/3', 'a slash after a postfix increment divides');
  assert.equal(minifyJs('x.in / 2 / y'), 'x.in/2/y', 'a property named like a keyword divides');
});

test('a block comment that spans lines keeps its line breaks', () => {
  assert.equal(minifyJs('a /* one\ntwo */ b'), 'a\nb');
});

test('minifyJs refuses source it cannot read, so the server falls back to the file', () => {
  assert.throws(() => minifyJs("const s = 'open"));
  assert.throws(() => minifyJs('const t = `open'));
  assert.throws(() => minifyJs('f({'));
});

test('minifyCss drops comments and spaces beside braces, separators and colons, and keeps selectors apart', () => {
  const src = '/* note */\n.a .b > .c,\n.d:hover {\n  color: red;\n  margin: 0 auto;\n  width: calc(100% - 2px);\n}\n@media (max-width: 600px) and (hover: none) { .e { content: "a  b"; } }\n';
  assert.equal(minifyCss(src), '.a .b>.c,.d:hover{color:red;margin:0 auto;width:calc(100% - 2px);}@media (max-width:600px) and (hover:none){.e{content:"a  b";}}');
  assert.equal(minifyCss('.\\31 0 { a: b }'), '.\\31 0{a:b}', 'the space ending a hex escape stays');
});

test('createMinified serves a file it cannot minify as written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-minify-'));
  try {
    const bad = join(dir, 'bad.js');
    writeFileSync(bad, "const s = 'open\n");
    const minified = createMinified();
    assert.equal(minified(bad, statSync(bad), () => readFileSync(bad)).toString(), "const s = 'open\n");
    const good = join(dir, 'good.js');
    writeFileSync(good, 'let  a = 1;\n');
    let reads = 0;
    const read = () => { reads++; return readFileSync(good); };
    assert.equal(minified(good, statSync(good), read).toString(), 'let a=1;\n');
    minified(good, statSync(good), read);
    assert.equal(reads, 1, 'computed once per file version');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const TOKENS = `
const { tokenizer } = require('internal/deps/acorn/acorn/dist/acorn');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
(async () => {
  const { minifyJs } = await import(pathToFileURL(process.argv[1]).href);
  const files = JSON.parse(process.argv[2]);
  const read = (src, sourceType) => [...tokenizer(src, { ecmaVersion: 'latest', sourceType, locations: true })]
    .map((t) => [t.type.label, t.value instanceof RegExp ? String(t.value) : typeof t.value === 'bigint' ? String(t.value) : t.value, t.loc.start.line]);
  const tokens = (src) => { try { return read(src, 'script'); } catch { return read(src, 'module'); } };
  const differ = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const a = JSON.stringify(tokens(src));
    const b = JSON.stringify(tokens(minifyJs(src)));
    if (a !== b) differ.push(f);
  }
  process.stdout.write(JSON.stringify(differ));
})().catch((e) => { console.error(e); process.exit(1); });
`;

test('every first-party script minifies to the same token stream on the same lines (Node\'s own acorn)', () => {
  const files = ASSETS.filter((p) => /\.m?js$/.test(p)).map((p) => join(PUBLIC, p));
  assert.ok(files.length > 10);
  const out = execFileSync(process.execPath, ['--expose-internals', '-e', TOKENS, join(ROOT, 'src/minify.js'), JSON.stringify(files)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.deepEqual(JSON.parse(out), []);
});

test('every first-party stylesheet loses only whitespace and comments', () => {
  for (const p of ASSETS.filter((x) => x.endsWith('.css'))) {
    const src = readFileSync(join(PUBLIC, p), 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
    assert.equal(strip(minifyCss(src)), strip(src), p);
    assert.ok(minifyCss(src).length < src.length, `${p} shrinks`);
  }
});

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the server sends first-party scripts and styles minified, minified before compressing, and vendored files as written (Issue #1001)', async () => {
  const { server, port } = await startServer(new Weave(), { port: 0 });
  try {
    const app = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    const plain = await get(port, '/app.js');
    assert.equal(plain.body.toString(), minifyJs(app));
    assert.ok(plain.body.length < app.length * 0.9, `app.js loses a tenth or more (${plain.body.length} of ${app.length})`);
    const zipped = await get(port, '/app.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(gunzipSync(zipped.body).toString(), minifyJs(app));
    const css = await get(port, '/style.css');
    assert.equal(css.body.toString(), minifyCss(readFileSync(join(PUBLIC, 'style.css'), 'utf8')));
    const vendor = await get(port, '/vendor/mermaid.min.js');
    assert.ok(vendor.body.equals(readFileSync(join(PUBLIC, 'vendor/mermaid.min.js'))), 'vendored code is already minified and never touched');
    const again = await get(port, '/app.js', { 'If-None-Match': plain.headers.etag });
    assert.equal(again.status, 304);
  } finally { server.close(); }
});
