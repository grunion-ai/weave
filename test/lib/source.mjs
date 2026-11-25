import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (file) => readFileSync(join(ROOT, file), 'utf8');

export const LAZY = ['public/field-dialog.js', 'public/activity-log.js', 'public/command-palette.js', 'public/date-picker.js', 'public/activity-panel.js', 'public/forms-dialog.js', 'public/automation-map.js'];
export const ROUTED = ['public/relation-map.js', 'public/doc-editor.js'];
export const APP = ['public/app.js', ...LAZY, ...ROUTED].map(read).join('\n');
export const HTML = read('public/index.html');
export const CHIP_CSS = read('public/chip.css');
export const STYLE = read('public/style.css');
export const CSS = [CHIP_CSS, STYLE].join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

export function cssRules(css = STYLE) {
  const out = [];
  const media = [];
  const tok = /([^{}]+)\{|\}/g;
  let m;
  let line = 1;
  let at = 0;
  while ((m = tok.exec(css))) {
    if (m[0] === '}') { media.pop(); continue; }
    const head = m[1].trim();
    if (head.startsWith('@')) { media.push(head); continue; }
    for (; at < m.index; at++) if (css[at] === '\n') line++;
    const end = css.indexOf('}', tok.lastIndex);
    out.push({ selector: head, body: css.slice(tok.lastIndex, end), media: media.join(' '), line });
    tok.lastIndex = end + 1;
  }
  return out;
}

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
export const zOf = (v) => {
  const layer = String(v ?? '').trim().match(/^var\((--wv-z-[a-z-]+)\)$/)?.[1];
  return Number(layer ? rulesFor(':root')[layer] : v);
};
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
