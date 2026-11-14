import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fnBody } from '../lib/source.mjs';

const PUBLIC = new URL('../../public/', import.meta.url);
const scripts = readdirSync(PUBLIC).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(new URL(f, PUBLIC), 'utf8')]);
const source = Object.fromEntries(scripts);
const lineOf = (src, at) => src.slice(0, at).split('\n').length;

const skipQuoted = (src, at) => {
  for (let i = at + 1; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === src[at]) return i;
  }
  return src.length;
};
function blockAt(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  for (let i = open, depth = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') i = skipQuoted(src, i);
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}
const sitesOf = (pattern) => scripts.flatMap(([file, src]) => [...src.matchAll(pattern)].map((m) => ({ file, line: lineOf(src, m.index), body: blockAt(src, m.index) })));

test('the app builds Vditor in exactly the places this gate reads (Issue #1598)', () => {
  const builds = sitesOf(/new Vditor\(\s*\w+\s*,\s*\{/g);
  assert.deepEqual(builds.map((b) => b.file), ['doc-editor.js'], 'a new Vditor build site joins this gate');
  assert.equal(scripts.flatMap(([, src]) => [...src.matchAll(/new Vditor\(/g)]).length, builds.length, 'every build passes an options literal the gate can read');
});

test('every Vditor build pins preview.markdown to { sanitize: true }, so the editor never rests on the library default (Issue #1598)', () => {
  for (const { file, line, body } of sitesOf(/new Vditor\(\s*\w+\s*,\s*\{/g)) {
    assert.ok(body, `${file}:${line}: the options literal is readable`);
    assert.equal(body.match(/\bpreview\s*:/g)?.length, 1, `${file}:${line}: the options carry one preview block`);
    const preview = blockAt(body, body.search(/\bpreview\s*:/));
    assert.match(preview ?? '', /\bmarkdown\s*:\s*\{/, `${file}:${line}: preview names a markdown block`);
    const markdown = blockAt(preview, preview.search(/\bmarkdown\s*:/));
    assert.match(markdown, /^\{\s*sanitize\s*:\s*true\s*,?\s*\}$/, `${file}:${line}: preview.markdown is ${markdown}`);
  }
});

test('no app script switches the editor sanitizer off (Issue #1598)', () => {
  for (const [file, src] of scripts) {
    assert.doesNotMatch(src, /\bsanitize\s*:\s*(?:false|!1|0|null|undefined)\b/, `${file} turns sanitize off`);
    assert.doesNotMatch(src, /SetSanitize\s*\(\s*(?:false|!1|0)\s*\)/, `${file} calls SetSanitize(false)`);
  }
});

test('every iframe the app mounts sets the sandbox attribute (Issue #1598)', () => {
  const sites = sitesOf(/\bel\(\s*'iframe'\s*,\s*\{/g);
  assert.ok(sites.length >= 7, `the gate reads every iframe mount site: ${sites.length}`);
  for (const { file, line, body } of sites) assert.match(body, /\bsandbox\s*:/, `${file}:${line} mounts an iframe with no sandbox: ${body}`);
  for (const [file, src] of scripts) {
    assert.doesNotMatch(src, /createElement\(\s*['"`]iframe['"`]\s*\)/i, `${file} builds an iframe outside el(), where this gate cannot read it`);
  }
});

test('the expanded deck frame carries the HTML frame sandbox like the inline deck frame, instead of trusting the response header alone (Issue #1598)', () => {
  const frame = fnBody('expandDocument', source['app.js']).match(/el\('iframe', \{[^}]*\}/)?.[0] ?? '';
  assert.match(frame, /sandbox: HTML_FRAME_SANDBOX/, frame);
  const sandbox = source['app.js'].match(/const HTML_FRAME_SANDBOX = '([^']*)'/)?.[1] ?? '';
  assert.match(sandbox, /\ballow-scripts\b/);
  assert.doesNotMatch(sandbox, /allow-same-origin/, 'an HTML frame never shares the workspace origin');
});

test('a PDF is the one file frame left without the sandbox attribute, since Chromium refuses to render a PDF in any sandboxed frame (Issue #1598)', () => {
  const literal = source['app.js'].match(/const FILE_FRAME_SANDBOX = (\{[^}]*\});/)?.[1];
  assert.ok(literal, 'app.js names the sandbox of each file frame kind in FILE_FRAME_SANDBOX');
  assert.deepEqual(new Function('HTML_FRAME_SANDBOX', `return ${literal}`)('html-frame'), { html: 'html-frame', pdf: null, text: '', image: '' });
  assert.match(fnBody('fileBodyEl', source['app.js']), /sandbox: FILE_FRAME_SANDBOX\[kind\]/);
  assert.match(fnBody('fileLightbox', source['app.js']), /sandbox: FILE_FRAME_SANDBOX\[kind\]/);
  assert.match(fnBody('fullscreenViewer', source['app.js']), /\{ url = null, mount = null, sandbox = '',/, 'a viewer frame is fully sandboxed unless its caller names a sandbox');
});

test('the editor sandboxes the frames a document holds from before Vditor first renders it (Issue #1598)', () => {
  const body = fnBody('mountDocEditor', source['doc-editor.js']);
  const hold = body.indexOf('holdDocFrames(host);');
  assert.ok(hold > -1 && hold < body.indexOf('new Vditor('), 'holdDocFrames(host) runs before new Vditor(host, ...)');
  assert.match(source['doc-editor.js'], /<iframe class="wv-file" src="\$\{url\}" title="\$\{escapeHtmlText\(f\.name\)\}"><\/iframe>/, 'the PDF frame an upload writes escapes the file name');
});
