import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST = import.meta.dirname;
const LOOP = /for \(const (\w+) of (?:\[\s*(['"])(?:light|dark)\2\s*,\s*(['"])(?:light|dark)\3\s*\]|THEMES|themesOn\([^)]*\))\)\s*/g;
const PAINT = new RegExp([
  String.raw`\b\w*[Cc]olou?rs?\b`, String.raw`\bbackground\w*`, String.raw`\bcontrast\w*`, String.raw`\binkOn\b`, String.raw`\blum(?:in\w*)?\b`,
  String.raw`\b(?:toHave)?[Ss]creenshot\w*`, String.raw`\bdecodePng\b`, String.raw`\bpng\b`, String.raw`\bpixels?\b`, String.raw`\brecordFrames\b`, String.raw`\bdiffRatio\b`,
  String.raw`\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(`, String.raw`#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b`,
  String.raw`(?<![.\w])(?:fill|stroke)\b`, String.raw`\b(?!borderBoxSize\b)\w*[Bb]order\w*`, String.raw`\b\w*[Ss]hadow\w*`, String.raw`\boutline\w*`,
  String.raw`\btblr-`, String.raw`\bpalette\b`, String.raw`\bhues?\b`, String.raw`\bhuePaint\b`, String.raw`\bpaint(?:Of|Misses|Probe)\b`, String.raw`\bPAINT_PROBE\b`,
  String.raw`\bopacity\b`, String.raw`\bgradient\w*`, String.raw`(?<![.\w])filter\b`, String.raw`\.filter\b(?!\s*\()`, String.raw`\bmix-blend\w*`,
  String.raw`\bmermaid\b`, String.raw`\bcanvas\b`, String.raw`\bnatural(?:Width|Height)\b`, String.raw`\b(?:getImageData|drawImage|toDataURL)\b`, String.raw`\bmask\w*`,
  String.raw`\bprefers-color-scheme\b`, String.raw`\bmatchMedia\b`, String.raw`::(?:before|after)\b`, String.raw`\bloader-mark\b`, String.raw`\bmark-(?:light|dark)\b`,
].join('|'));

function scan(src, from, stop) {
  const stack = [];
  let regexOk = true;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      regexOk = false;
    } else if (c === '`') {
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '`') break;
        else if (src[i] === '$' && src[i + 1] === '{') {
          const end = scan(src, i + 1, 'close');
          if (end < 0) return -1;
          i = end;
        }
      }
      regexOk = false;
    } else if (c === '/' && regexOk) {
      let inClass = false;
      for (i++; i < src.length && (src[i] !== '/' || inClass); i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
      }
      regexOk = false;
    } else if (c === '(' || c === '[' || c === '{') {
      stack.push(c);
      regexOk = true;
    } else if (c === ')' || c === ']' || c === '}') {
      stack.pop();
      regexOk = false;
      if (stack.length === 0 && stop === 'close') return i;
    } else if (stop === 'statement' && stack.length === 0 && (c === ';' || c === '\n')) {
      if (c === ';') return i;
      const rest = src.slice(i).match(/^\s*(\S)/);
      if (rest && !'.?:)]}'.includes(rest[1]) && !/[,(=+\-*&|?:]\s*$/.test(src.slice(from, i))) return i;
    } else if (/\s/.test(c)) {
      continue;
    } else {
      regexOk = /[=(,:;!&|?{}+\-*%<>~^]/.test(c);
      if (/[\w$]/.test(c)) {
        const word = src.slice(i).match(/^[\w$]+/)[0];
        regexOk = ['return', 'typeof', 'case', 'of', 'in', 'yield', 'await', 'void', 'delete', 'new'].includes(word);
        i += word.length - 1;
      }
    }
  }
  return -1;
}

export function closeOf(src, open) {
  return scan(src, open, 'close');
}

function statementEnd(src, start) {
  if (src[start] === '{') return closeOf(src, start);
  const loop = src.slice(start).match(/^for\s*\(/);
  if (loop) {
    const head = closeOf(src, start + loop[0].length - 1);
    const next = src.slice(head + 1).match(/^\s*/)[0].length + head + 1;
    return statementEnd(src, next);
  }
  return scan(src, start, 'statement');
}

function definitions(src) {
  const out = new Map();
  const DEF = /(?:\bfunction\s*\*?\s*([\w$]+)\s*\(|\b(?:const|let|var)\s+([\w$]+)\s*=(?=\s*(?:async\s*)?(?:function\b|\([^()]*(?:\([^()]*\)[^()]*)*\)\s*=>|[\w$]+\s*=>)))/g;
  for (const m of src.matchAll(DEF)) {
    const name = m[1] || m[2];
    const after = m.index + m[0].length;
    const brace = m[1] ? src.indexOf('{', closeOf(src, after - 1)) : -1;
    const start = m[1] ? brace : after + src.slice(after).match(/^\s*/)[0].length;
    const end = statementEnd(src, start);
    if (end > start) out.set(name, (out.get(name) ?? '') + src.slice(start, end + 1));
  }
  return out;
}

export function readsPaint(text, defs, seen = new Set()) {
  if (PAINT.test(text)) return true;
  for (const name of new Set(text.match(/(?<![.\w$])[A-Za-z_$][\w$]*/g))) {
    if (seen.has(name) || !defs.has(name)) continue;
    seen.add(name);
    if (readsPaint(defs.get(name), defs, seen)) return true;
  }
  return false;
}

const TEST_CALL = /(?<![.\w$])test(?:\.skip|\.only|\.todo)?\(/g;

export function themeCases(src) {
  const defs = definitions(src);
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const inTest = [...src.matchAll(TEST_CALL)].map((t) => [t.index, closeOf(src, t.index + t[0].length - 1)]);
  return [...src.matchAll(LOOP)].flatMap((m) => {
    const start = m.index + m[0].length;
    const end = statementEnd(src, start);
    const strip = (s) => s.replace(new RegExp(String.raw`\b${m[1]}\b`, 'g'), '');
    const body = src.slice(start, end + 1);
    const tests = [...body.matchAll(TEST_CALL)].map((t) => {
      const open = start + t.index + t[0].length - 1;
      const close = closeOf(src, open);
      const name = src.slice(open + 1).match(/^\s*(['"`])((?:\\.|(?!\1).)*)\1/s)?.[2] ?? '';
      return { line: lineOf(open), name, text: src.slice(open, close + 1) };
    });
    if (!tests.length && !inTest.some(([a, b]) => a < m.index && m.index < b)) return [];
    const cases = tests.length ? tests : [{ line: lineOf(m.index), name: '', text: body }];
    return cases.map((c) => ({ loop: lineOf(m.index), variable: m[1], line: c.line, name: c.name, paint: readsPaint(strip(c.text), defs) }));
  });
}

export function themeBlindLoops(src) {
  return themeCases(src).filter((c) => !c.paint).map((c) => c.line);
}

test('the guard tells a theme-blind loop from one that reads paint (Issue #667)', () => {
  const blind = "for (const theme of ['light', 'dark']) {\n  test(`${theme}: rows fit`, async () => { assert.equal(box.width, 44); });\n}\n";
  const painted = "for (const theme of ['light', 'dark']) {\n  test(`${theme}: chip`, async () => { await styleOf(chip, 'color', want[theme]); });\n}\n";
  assert.deepEqual(themeBlindLoops(blind), [2]);
  assert.deepEqual(themeBlindLoops(painted), []);
  assert.deepEqual(themeBlindLoops("test('x', () => {\n  for (const scheme of ['light', 'dark']) {\n    const s = '}';\n    assert.ok(s);\n  }\n});\nconst color = 1;\n"), [2], 'a brace inside a string never ends the body early');
  assert.deepEqual(themeBlindLoops("for (const n of ['light', 'dark']) rows[n] = make(n);\n"), [], 'a seed loop outside any case runs no case');
});

test('the guard reads paint as whole words, never inside a longer name (Issue #667)', () => {
  const blind = (body) => themeBlindLoops(`for (const theme of ['light', 'dark']) {\n  test(\`\${theme}: case\`, async () => { ${body} });\n}\n`).length === 1;
  for (const body of ['await dialogOf(page);', 'const s = await inlineStyle(n);', 'assert.ok(await row.isVisible());', 'rows.filter((r) => r.on);', 'await page.locator("#title").fill("x");', 'const page = await browser.newPage({ colorScheme: theme });', 'await logout(page);', "await page.waitForSelector('#ws-new svg');", 'sizes.push(e.borderBoxSize[0]);']) {
    assert.ok(blind(body), `${body} reads no paint`);
  }
  for (const body of ["getComputedStyle(n).backgroundColor;", "await styleOf(n, 'borderTopColor', want);", 'await page.screenshot();', "n.getAttribute('fill');", "getComputedStyle(n).boxShadow;", "assert.equal(c, 'rgb(1, 2, 3)');", "getComputedStyle(n).filter;", "getComputedStyle(n, '::before').content;", "rect(document.querySelector('.loader-mark'));"]) {
    assert.ok(!blind(body), `${body} reads paint`);
  }
});

test('the guard judges each case inside a loop on its own and follows the helpers it calls (Issue #667)', () => {
  const src = [
    "const ink = (page) => page.evaluate(() => getComputedStyle(document.body).color);",
    "const count = (page) => page.locator('tr').count();",
    "for (const theme of ['light', 'dark']) {",
    "  test(`${theme}: paints`, async () => { assert.ok(await ink(page)); });",
    "  test(`${theme}: counts`, async () => { assert.equal(await count(page), 3); });",
    "}",
    "for (const colorScheme of ['light', 'dark']) test(`one line (${colorScheme})`, async () => { assert.equal(await count(page), 3); });",
    "for (const theme of THEMES) {",
    "  test(`${theme}: counts again`, async () => { assert.equal(await count(page), 3); });",
    "}",
    "for (const theme of themesOn(engine)) {",
    "  test(`${theme}: and again`, async () => { assert.equal(await count(page), 3); });",
    "}",
  ].join('\n');
  assert.deepEqual(themeBlindLoops(src), [5, 7, 9, 12]);
});

test('no browser case runs in both themes over a body that reads no colour, contrast or screenshot (Issue #667)', () => {
  const found = readdirSync(TEST).filter((f) => f.endsWith('-browser.test.mjs'))
    .flatMap((f) => themeBlindLoops(readFileSync(join(TEST, f), 'utf8')).map((line) => `test/${f}:${line}`));
  assert.deepEqual(found, [], 'a theme cannot change a geometry, a count, a class or a text value: run it in one theme (DEVELOPMENT.md "Theme loops")');
});
