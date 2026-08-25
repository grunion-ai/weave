#!/usr/bin/env node
// decklet create — headless: model.json (+ style.json) → one self-contained deck.html
// usage: node bin/create.mjs --model model.json [--style style.json] --out deck.html
//          [--format slides|carousel|carousel-4x5|document-letter|document-a4] [--space 960x540|1600x900] [--title "…"] [--force]
// library: import {create, FORMAT} from './create.mjs'
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {validate, mergeStyle} from './validate.mjs';

// page-size presets of ONE model space: canvas size + print page (named sizes only — Safari ignores px @page sizes)
export const FORMAT = {
  'slides':          {w: 960,  h: 540,  page: 'letter'},   // 16:9 — or 1600×900 via --space
  'carousel':        {w: 1080, h: 1080, page: 'letter'},   // 1:1   (experimental — see README)
  'carousel-4x5':    {w: 1080, h: 1350, page: 'letter'},   // 4:5   (experimental)
  'document-letter': {w: 816,  h: 1056, page: 'letter'},   // 8.5×11in at 96dpi — print zoom is exactly 1 (experimental)
  'document-a4':     {w: 794,  h: 1123, page: 'a4'},       // 210×297mm at 96dpi — print zoom is exactly 1 (experimental)
};
const here = path.dirname(fileURLToPath(import.meta.url));
const esc = s => s.replace(/<\/script/gi, '<\\/script');
const put = (html, mark, to) => {
  const re = new RegExp(`/\\*${mark}\\*/[\\s\\S]*?/\\*/${mark}\\*/`);
  if (!re.test(html)) throw new Error(`template marker ${mark} missing`);
  return html.replace(re, () => `/*${mark}*/${to}/*/${mark}*/`);
};

export function create(model, {style = null, format, space, title, template} = {}) {
  const deck = structuredClone(model);
  const fmt = format || deck.format || 'slides';
  if (!FORMAT[fmt]) throw new Error(`unknown format ${fmt}`);
  deck.format = fmt; deck.page = FORMAT[fmt].page;
  if (space) { const [w, h] = space.split('x').map(Number); deck.w = w; deck.h = h; }
  if (deck.w == null || deck.h == null) { deck.w = FORMAT[fmt].w; deck.h = FORMAT[fmt].h; }
  // style.json: {tokens:{bg,fg,muted,accent,card,line,sel,box}, roles:{…}, pad:{…}} — shared with validate --style so the two never drift
  mergeStyle(deck, style);
  // the deck NAMES itself: --title wins, else the model's own title, else "decklet". It is model data, never markup —
  // the runtime titles the document from it, so the tab, the ⤓ PDF filename and the ⌘S copy filename are one string.
  deck.title = title || deck.title || 'decklet';
  let html = template || fs.readFileSync(path.join(here, 'template.html'), 'utf8');
  if (!deck.styles || !deck.styles.roles || !Object.keys(deck.styles.roles).length) { // no roles anywhere → inherit the template's neutral scale
    const tpl = JSON.parse(html.match(/\/\*DECK\*\/([\s\S]*?)\/\*\/DECK\*\//)[1]);
    deck.styles = {...tpl.styles, ...(deck.styles || {}), roles: tpl.styles.roles};
  }
  const tokens = {...(style && style.tokens || {})};
  if (Object.keys(tokens).length) html = put(html, 'TOKENS', Object.entries(tokens).map(([k, v]) => `--${k.replace(/^--/, '')}:${v}`).join(';'));
  const hash = createHash('sha256').update(JSON.stringify(deck)).digest('hex').slice(0, 10);
  html = put(html, 'DECK', esc(JSON.stringify(deck)));
  html = put(html, 'KEY', `'decklet:${hash}'`);
  return {html, deck, hash};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2), o = {};
  for (let k = 0; k < a.length; k++) if (a[k].startsWith('--')) o[a[k].slice(2)] = a[k + 1] && !a[k + 1].startsWith('--') ? a[++k] : true;
  if (!o.model || !o.out) { console.error('usage: node bin/create.mjs --model model.json [--style style.json] --out deck.html [--format …] [--space WxH] [--title …] [--force]'); process.exit(2); }
  const model = JSON.parse(fs.readFileSync(o.model, 'utf8'));
  const style = o.style ? JSON.parse(fs.readFileSync(o.style, 'utf8')) : null;
  const {html, deck, hash} = create(model, {style, format: o.format, space: o.space, title: o.title});
  const v = validate(deck);
  for (const m of v.errors) console.error('ERROR   ' + m);
  for (const m of v.warnings) console.error('warning ' + m);
  if (!v.ok && !o.force) { console.error('model invalid — fix the errors or pass --force'); process.exit(1); }
  fs.writeFileSync(o.out, html);
  console.log(`wrote ${o.out} · ${(html.length / 1024).toFixed(0)}KB · ${deck.format} ${deck.w}×${deck.h} · ${deck.slides.length} slides · master ${(deck.master || []).length} · layouts ${Object.keys(deck.layouts || {}).join(',') || '—'} · ns ${hash}`);
}
