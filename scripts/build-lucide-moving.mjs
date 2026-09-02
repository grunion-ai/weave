#!/usr/bin/env node
/* Builds the vendored icon set (Feature: moving icons, 2026-09-02).
   Two upstream checkouts in, three files out:
     public/vendor/lucide-moving.js   root.LUCIDE_MOVING = { name: '<svg…>' }
     public/vendor/lucide-moving.css  the hover motion, one scoped block per icon
     public/icon-registry.js          names, categories, motion, legacy aliases, mark twins
   Usage:
     node scripts/build-lucide-moving.mjs --moving <jis3r/icons checkout> --lucide <lucide-icons/lucide checkout>
   movingicons.dev (github.com/jis3r/icons, MIT) ships Svelte 5 components: a
   Lucide SVG whose parts gain classes while `animate` is true, plus scoped CSS
   keyframes. Weave is vanilla, so each component is lifted here: the SVG keeps
   its classes as `data-mi`, the CSS is scoped under `.mi-<name>` with renamed
   keyframes, and the browser toggles the classes once per trigger. A component
   whose motion is driven by script (17 of 555, e.g. eye, bot) draws still.
   Motion never loops: `infinite` becomes a single run (Kyle, 2026-09-02). */
import fs from 'node:fs';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const MI = args.moving && path.join(args.moving, 'src/lib/icons');
const LU = args.lucide && path.join(args.lucide, 'icons');
if (!MI || !LU || !fs.existsSync(MI) || !fs.existsSync(LU)) {
  console.error('usage: node scripts/build-lucide-moving.mjs --moving <jis3r/icons checkout> --lucide <lucide-icons/lucide checkout>');
  process.exit(2);
}
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

/* ---------- legacy: every Iconly name weave ever stored, and the eight it drew ---------- */
const ALIAS = {
  '2user': ['users'], '3user': ['users-round', 'users'], activity: ['activity'], adduser: ['user-plus'],
  'arrow-down': ['arrow-down'], 'arrow-down2': ['chevron-down'], 'arrow-down3': ['arrow-down'], 'arrow-downcircle': ['circle-arrow-down'], 'arrow-downsquare': ['square-arrow-down'],
  'arrow-left': ['arrow-left'], 'arrow-left2': ['chevron-left'], 'arrow-left3': ['arrow-left'], 'arrow-leftcircle': ['circle-arrow-left'], 'arrow-leftsquare': ['square-arrow-left'],
  'arrow-right': ['arrow-right'], 'arrow-right2': ['chevron-right'], 'arrow-right3': ['arrow-right'], 'arrow-rightcircle': ['circle-arrow-right'], 'arrow-rightsquare': ['square-arrow-right'],
  'arrow-up': ['arrow-up'], 'arrow-up2': ['chevron-up'], 'arrow-up3': ['arrow-up'], 'arrow-upcircle': ['circle-arrow-up'], 'arrow-upsquare': ['square-arrow-up'],
  bag: ['shopping-bag'], bag2: ['shopping-bag'], bookmark: ['bookmark'], bug: ['bug'], buy: ['shopping-cart'], calendar: ['calendar'],
  call: ['phone'], calling: ['phone-call', 'phone-outgoing'], callmissed: ['phone-missed'], callsilent: ['phone-off'], camera: ['camera'],
  category: ['layout-grid', 'grid-2x2'], chart: ['chart-bar', 'chart-column', 'chart-no-axes-column'], chat: ['message-circle'], closesquare: ['square-x'],
  danger: ['triangle-alert'], delete: ['trash-2'], discount: ['badge-percent', 'percent'], discovery: ['compass'], document: ['file-text'],
  download: ['download'], edit: ['pencil', 'pen'], editsquare: ['square-pen'], filter: ['funnel', 'filter'], filter2: ['list-filter', 'funnel'],
  folder: ['folder'], game: ['gamepad-2'], graph: ['chart-pie'], heart: ['heart'], hide: ['eye-off'], home: ['house'], image: ['image'], image2: ['image'],
  infocircle: ['info'], infosquare: ['info'], location: ['map-pin'], lock: ['lock'], login: ['log-in'], logout: ['log-out'], message: ['mail'],
  morecircle: ['ellipsis'], moresquare: ['ellipsis'], notification: ['bell'], paper: ['file'], paperdownload: ['file-down'], paperfail: ['file-x'],
  papernegative: ['file-minus'], paperplus: ['file-plus'], paperupload: ['file-up'], password: ['key-round', 'key'], play: ['play'], plus: ['plus'],
  profile: ['user'], scan: ['scan'], search: ['search'], send: ['send'], setting: ['settings'], shielddone: ['shield-check'], shieldfail: ['shield-x'],
  show: ['eye'], star: ['star'], swap: ['arrow-left-right'], ticket: ['ticket'], ticketstar: ['ticket-check', 'ticket'], ticksquare: ['square-check'],
  timecircle: ['clock'], timesquare: ['clock'], unlock: ['lock-open'], upload: ['upload'], video: ['video'], voice: ['mic'], voice2: ['mic'],
  volumedown: ['volume-1'], volumeoff: ['volume-x'], volumeup: ['volume-2'], wallet: ['wallet'], work: ['briefcase'],
  dollar: ['dollar-sign'], euro: ['euro'], card: ['credit-card'], coins: ['coins'], invoice: ['receipt'], bank: ['landmark'], trend: ['trending-up'], percent: ['percent'],
};
/* A mark that Lucide also draws takes the Lucide shape; the six progress rings
   have no twin and stay hand-drawn in public/mark-icons.js. */
const MARK_TWINS = {
  '✓': ['check'], '✕': ['x'], '★': ['star'], '!': ['circle-alert'], '?': ['circle-question-mark', 'circle-help'],
  '▶': ['play'], '⏸': ['pause'], '⊘': ['ban', 'circle-slash'], '⚑': ['flag'], '◎': ['target'], '⛓': ['link'], '⌁': ['zap'],
  '→': ['arrow-right'], '+': ['plus'],
};

/* ---------- porting one component ---------- */
const kfSafe = (s) => s.replace(/[^\w-]/g, '-');
function scopeCss(css, root) {
  css = css.replace(/:global\(([^)]*)\)/g, '$1');
  const kfs = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const ren = new Map(kfs.map((k) => [k, `${root}-${kfSafe(k)}`]));
  css = css.replace(/@keyframes\s+([\w-]+)/g, (_, k) => `@keyframes ${ren.get(k)}`);
  css = css.replace(/(animation(?:-name)?\s*:\s*)([^;}]+)/g, (_, p, v) =>
    p + v.split(',').map((seg) => seg.split(/(\s+)/).map((tok) => ren.has(tok) ? ren.get(tok) : tok === 'infinite' ? '1' : tok).join('')).join(','));
  css = css.replace(/animation-iteration-count\s*:\s*infinite/g, 'animation-iteration-count: 1');
  let out = '', i = 0, depth = 0, inKf = false, kfDepth = 0;
  const n = css.length;
  while (i < n) {
    const j = css.indexOf('{', i);
    if (j < 0) { out += css.slice(i); break; }
    const head = css.slice(i, j), trimmed = head.trim();
    let skip = false;
    if (trimmed.startsWith('@keyframes')) { inKf = true; kfDepth = depth; out += head + '{'; }
    else if (trimmed.startsWith('@') || inKf) out += head + '{';
    else {
      const sels = trimmed.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => s !== 'div' && !s.startsWith('div.') && !s.startsWith('div:'));
      if (!sels.length) skip = true;
      else out += head.match(/^\s*/)[0] + sels.map((s) => `.${root} ${s}`).join(', ') + ' {';
    }
    depth++; i = j + 1;
    while (i < n) {
      const nb = css.indexOf('{', i), ne = css.indexOf('}', i);
      if (ne >= 0 && (nb < 0 || ne < nb)) { if (!skip) out += css.slice(i, ne + 1); i = ne + 1; depth--; if (inKf && depth === kfDepth) inKf = false; skip = false; continue; }
      if (nb < 0) { out += css.slice(i); i = n; }
      break;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}
const ROOT_ATTRS = 'width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
function portMoving(name) {
  const src = fs.readFileSync(`${MI}/${name}.svelte`, 'utf8');
  const script = (src.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [, ''])[1];
  const ms = Number((script.match(/\},\s*(\d+)\s*\)/) || [, 0])[1]) || 0;
  const hold = /onmouseleave/.test(src);
  const lookup = (id) => (script.match(new RegExp('(?:const|let)\\s+' + id + '\\s*=\\s*(?:\\$state\\()?[\'"`]([^\'"`]*)[\'"`]')) || [])[1];
  // Svelte formats a closing tag as `</svg\n>` when attributes wrap.
  let svg = (src.match(/<svg[\s\S]*?<\/svg\s*>/) || [''])[0].replace(/<\/svg\s*>$/, '</svg>');
  svg = svg.replace(/<(\w+)([^>]*?)(\/?)>/g, (m, tag, attrs, sc) => {
    const classes = [];
    attrs = attrs.replace(/\s+class:([\w-]+)(?:=\{[^}]*\})?/g, (_, c) => { classes.push(c); return ''; });
    attrs = attrs.replace(/\s+(width|height)=\{size\}/g, '').replace(/\s+xmlns="[^"]*"/, '')
      .replace(/stroke=\{color\}/, 'stroke="currentColor"').replace(/stroke-width=\{strokeWidth\}/, 'stroke-width="2"')
      .replace(/=\{(-?\d+(?:\.\d+)?)\}/g, '="$1"').replace(/fill=\{color\}/g, 'fill="currentColor"')
      .replace(/\{([A-Za-z_]\w*)\}/g, (m0, id) => { const c = lookup(id); return c != null ? c : m0; })
      .replace(/\s+/g, ' ').trimEnd();
    if (tag === 'svg') attrs = ' ' + ROOT_ATTRS + attrs.replace(/ (width|height|viewBox|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)="[^"]*"/g, '');
    if (classes.length) attrs += ` data-mi="${classes.join(' ')}"`;
    return `<${tag}${attrs}${sc}>`;
  }).replace(/\s*\n\s*/g, ' ').replace(/>\s+</g, '><');
  if (!svg.startsWith('<svg') || /\{[^}]*\}/.test(svg)) return null; // script-driven or unusual markup: no CSS port
  const style = (src.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1];
  const css = scopeCss(style, `mi-${name}`);
  return { svg, css, ms: ms || (hold ? 900 : 1000) };
}
function portStatic(name) {
  const raw = fs.readFileSync(`${LU}/${name}.svg`, 'utf8');
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, ' ').trim();
  return { svg: `<svg ${ROOT_ATTRS}>${inner}</svg>`, css: '', ms: 0 };
}
const hasMoving = (n) => fs.existsSync(`${MI}/${n}.svelte`);
const hasStatic = (n) => fs.existsSync(`${LU}/${n}.svg`);
const category = (n) => { try { return JSON.parse(fs.readFileSync(`${LU}/${n}.json`, 'utf8')).categories?.[0] || 'other'; } catch { return 'other'; } };

/* ---------- the set ---------- */
const SVG = {}, MOTION = {}, CATEGORY = {}, still = [];
const add = (name) => {
  if (SVG[name]) return true;
  const p = (hasMoving(name) && portMoving(name)) || (hasStatic(name) && portStatic(name));
  if (!p) return false;
  if (hasMoving(name) && !p.ms) still.push(name);
  SVG[name] = p.svg; MOTION[name] = p.ms; CATEGORY[name] = category(name);
  if (p.css) CSS.push(p.css);
  return true;
};
const CSS = [];
for (const f of fs.readdirSync(MI)) if (f.endsWith('.svelte')) add(f.replace(/\.svelte$/, ''));
const resolve = (cands, what) => {
  const hit = cands.find((c) => hasMoving(c)) ?? cands.find((c) => hasStatic(c));
  if (!hit || !add(hit)) throw new Error(`${what}: none of ${cands.join(', ')} exists upstream`);
  return hit;
};
const ALIASES = Object.fromEntries(Object.entries(ALIAS).map(([k, c]) => [k, resolve(c, `alias ${k}`)]));
const TWINS = Object.fromEntries(Object.entries(MARK_TWINS).map(([k, c]) => [k, resolve(c, `mark ${k}`)]));
const NAMES = Object.keys(SVG).sort();

/* ---------- write ---------- */
const header = (what) => `/* ${what} — GENERATED by scripts/build-lucide-moving.mjs, do not edit.
   Shapes: Lucide (ISC, lucide.dev). Motion: movingicons.dev (MIT, github.com/jis3r/icons). */\n`;
fs.writeFileSync(path.join(OUT, 'public/vendor/lucide-moving.js'),
  header('The vendored icon set: one inline SVG per name') + `(function (root) {\n  root.LUCIDE_MOVING = ${JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, SVG[n]])))};\n})(globalThis);\n`);
fs.writeFileSync(path.join(OUT, 'public/vendor/lucide-moving.css'),
  header('Hover motion, scoped per icon under .mi-<name>; nothing loops') + CSS.join('\n') + '\n');
const registry = `/* The icon registry — GENERATED by scripts/build-lucide-moving.mjs, do not edit.
   Everything an agent or the picker needs to reason about icons without the
   SVGs: the offered names, each one's Lucide category and motion length (0 =
   still), the legacy Iconly names and the marks that now draw as Lucide.
   Classic script + ESM in one file (the mark-icons.js pattern): the browser
   reads the global, node imports the same source. */
(function (root) {
  const NAMES = ${JSON.stringify(NAMES)};
  const CATEGORY = ${JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, CATEGORY[n]])))};
  const MOTION = ${JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, MOTION[n]])))};
  /* iconly:<name> — the set weave shipped 2026-08-22 to 2026-09-02, plus the
     eight money icons it drew. A stored value keeps resolving; nothing migrates. */
  const ALIASES = ${JSON.stringify(ALIASES)};
  /* A state mark whose character now draws as a Lucide shape. */
  const MARK_TWINS = ${JSON.stringify(TWINS)};
  const SET = new Set(NAMES);
  /* The Lucide name behind a stored value, or null when the value is not an
     icon reference (a bare string paints itself). A reference that resolves to
     nothing returns '' — the caller draws a ghost, never the prefix. */
  const resolve = (value) => {
    const m = /^(lucide|iconly):(.+)$/.exec(String(value ?? ''));
    if (!m) return null;
    const name = m[1] === 'iconly' ? ALIASES[m[2]] : m[2];
    return name && SET.has(name) ? name : '';
  };
  const canonical = (value) => { const n = resolve(value); return n ? \`lucide:\${n}\` : value; };
  root.weaveIconRegistry = { NAMES, CATEGORY, MOTION, ALIASES, MARK_TWINS, resolve, canonical };
})(globalThis);
`;
fs.writeFileSync(path.join(OUT, 'public/icon-registry.js'), registry);
const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
console.log(`names ${NAMES.length} (moving ${NAMES.filter((n) => MOTION[n]).length}, still ${NAMES.length - NAMES.filter((n) => MOTION[n]).length}; script-driven upstream, drawn still: ${still.join(' ')})`);
console.log(`aliases ${Object.keys(ALIASES).length}, twins ${Object.keys(TWINS).length}; static aliases: ${Object.entries(ALIASES).filter(([, v]) => !MOTION[v]).map(([k, v]) => `${k}→${v}`).join(' ')}`);
console.log(`wrote public/vendor/lucide-moving.js ${kb('public/vendor/lucide-moving.js')}K, lucide-moving.css ${kb('public/vendor/lucide-moving.css')}K, icon-registry.js ${kb('public/icon-registry.js')}K`);
