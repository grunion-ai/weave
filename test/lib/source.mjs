import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (file) => readFileSync(join(ROOT, file), 'utf8');

export const APP = read('public/app.js');
export const HTML = read('public/index.html');
export const CSS = read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

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

const STEP = Object.fromEntries([...CSS.matchAll(/--fs-([a-z0-9]+):\s*([\d.]+px)/g)].map((m) => [m[1], m[2]]));
export const px = (v) => Number.parseFloat(String(v).trim().replace(/^var\(--fs-([a-z0-9]+)\)/, (m, k) => STEP[k] ?? m));

export function fnBody(name, src = APP) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name}() must exist in app.js`);
  const rest = src.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}

export function fnBodyOf(name, src = APP) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > -1, `app.js has no ${name}()`);
  const next = src.indexOf('\nfunction ', at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

export function liftFunction(name, deps = {}, src = APP) {
  const body = fnBody(name, src);
  return new Function(...Object.keys(deps), `${body}; return ${name};`)(...Object.values(deps));
}
