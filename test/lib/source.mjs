/* Readers for the suites that assert against source text.

   A source-regex test pins what the code says rather than what it does; the
   suite has a few hundred of them, and they earn their keep only while the
   readers underneath agree. Four files each carried their own rulesFor(), three
   their own fnBody(), and five their own "app.js still parses" smoke test.
   They live here now, once. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (file) => readFileSync(join(ROOT, file), 'utf8');

export const APP = read('public/app.js');
export const HTML = read('public/index.html');
/* Comments are stripped so a `/* … *\/` above a rule is not read as part of
   its selector list. */
export const CSS = read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

/* Minimal CSS reader: every declaration block whose selector list contains
   `selector` as a whole comma-separated part, merged in source order. */
export function rulesFor(selector, css = CSS) {
  const out = {};
  for (const [, sels, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').map((s) => s.trim()).includes(selector)) continue;
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

export const px = (v) => Number.parseFloat(String(v));

/* A top-level `function name(` declaration in app.js, to its closing brace at
   column 0. */
export function fnBody(name, src = APP) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name}() must exist in app.js`);
  const rest = src.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}

/* The same declaration, but to the next top-level function: the region also
   carries the constants and comments that sit between the two. */
export function fnBodyOf(name, src = APP) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > -1, `app.js has no ${name}()`);
  const next = src.indexOf('\nfunction ', at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

/* Lift one top-level function out of app.js and return it as a live value,
   with `deps` bound as free variables (the helpers it calls at runtime). */
export function liftFunction(name, deps = {}, src = APP) {
  const body = fnBody(name, src);
  return new Function(...Object.keys(deps), `${body}; return ${name};`)(...Object.values(deps));
}
