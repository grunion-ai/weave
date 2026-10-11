import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FUNCTIONS, functionsOf } from './functions.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const VIEWS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];

export const CATS = [
  ['button', 'B', 'Button'],
  ['menu', 'M', 'Menu'],
  ['colmenu', 'H', 'Column header menu'],
  ['popover', 'P', 'Popover'],
  ['picker', 'K', 'Picker'],
  ['dialog', 'D', 'Dialog or sheet'],
  ['toast', 'T', 'Toast'],
  ['chip', 'C', 'Chip'],
  ['input', 'I', 'Text input'],
  ['toggle', 'G', 'Toggle'],
  ['tabs', 'S', 'Tabs'],
  ['nav', 'N', 'Navigation'],
  ['bar', 'R', 'Bar'],
  ['card', 'A', 'Card'],
  ['cell', 'L', 'Cell or field row'],
  ['empty', 'E', 'Empty state'],
];
const CONTAINER = new Set(['menu', 'colmenu', 'popover', 'picker', 'dialog', 'card', 'bar', 'nav', 'cell', 'tabs', 'empty', 'toast']);
const STEP = new Set(['popover', 'picker', 'dialog', 'bar']);
const GENERIC = new Set(['btn', 'btn-sm', 'btn-icon', 'tiny', 'k', 'btn-ghost-secondary', 'open', 'active']);
const STATE = /^(open|active|checked|selected|err|info|ok|warn|success|automation|sel|current|on|computed|folded|closed|pressed|is-[a-z-]+)$/;

export const recat = (s) => {
  const sig = s.sig;
  if (/^(button|a)\./.test(sig) && !s.overlay && ['menu', 'picker', 'popover', 'dialog'].includes(s.cat)) return 'button';
  if (['dialog', 'popover', 'picker', 'menu'].includes(s.cat)) {
    if (/picker-pop|date-pop|cell-pop|value-pop/.test(sig)) return 'picker';
    if (/popover/.test(sig)) return 'popover';
    if (/dl-menu|nav-menu|field-menu|wv-menu|dropdown-menu|crumb-fold|account-menu/.test(sig)) return 'menu';
    if (/chip-pop/.test(sig) && /table-field|wv-toggle|switch/.test(s.html)) return 'popover';
    if (/chip-pop/.test(sig)) return 'colmenu';
    if (/modal|sheet|cmdk|bug|tray|role="dialog"|role="alertdialog"/.test(sig + s.html.slice(0, 400))) return 'dialog';
    if (/sel-puck|glass/.test(sig)) return 'bar';
    if (s.cat === 'popover' && /^div\.$/.test(sig) && s.rows.some((r) => /^(Cancel|Done|Close|Create)/.test(r))) return 'dialog';
  }
  return s.cat;
};

const normSig0 = (sig) => sig.split('.').filter((c) => !/^hue-|^(open|active|checked|selected|cat-done|err|info|ok|warn|success|automation|sel|current|on|computed|folded|closed|pressed|is-[a-z-]+|has-[a-z-]+)$/.test(c)).join('.');
export const normSig = (sig, s) => {
  const n = normSig0(sig);
  if (!s || !/^[a-z]+\.$/.test(n)) return n;
  const id = (s.html.match(/^<[a-z]+[^>]*\sid="([^"]+)"/) || [])[1];
  if (id) return n.slice(0, -1) + '#' + id;
  const parent = s.chain.at(-1)?.a.class?.split(' ')[0];
  return parent ? parent + ' > ' + n.slice(0, -1) : n;
};
const noHue = (sig) => sig.split('.').filter((c) => !/^hue-/.test(c)).join('.');
export const stateOf = (s) => [...new Set([
  ...s.sig.split('.').filter((c) => STATE.test(c)),
  ...(/aria-pressed="true"/.test(s.html.slice(0, 300)) ? ['pressed'] : []),
  ...(/^<button[^>]*\sdisabled/.test(s.html) ? ['disabled'] : []),
])].join(' · ');

const LAND = [['#tray', 'Field editor tray'], ['#modal', 'Dialog'], ['#cmdk', 'Command palette'], ['#bug-panel', 'Bug report panel'], ['sel-puck', 'Selection bar'], ['new-row-sheet', 'New row sheet (phone)'], ['phone-bar', 'Phone bottom bar'], ['doc-rail', 'Document outline rail'], ['vditor', 'Document editor'], ['doc-body', 'Document body'], ['wv-activity', 'Activity panel'], ['chip-pop', 'Popover'], ['dl-menu', 'Menu'], ['crumb-row', 'Breadcrumb bar'], ['table-tools', 'Table toolbar'], ['view-header', 'Page header'], ['fieldrow', 'Record field row'], ['entity-fields', 'Record fields'], ['table-wrap', 'Table'], ['#ws-rail', 'Workspace rail'], ['#sidebar', 'Sidebar'], ['wv-members', 'Members box'], ['wv-toasts', 'Toast stack'], ['#main', 'Main page']];
export const landOf = (chain) => {
  for (let i = chain.length - 1; i >= 0; i--) {
    const a = chain[i].a, cls = ' ' + (a.class || '') + ' ';
    for (const [k, label] of LAND) if (k[0] === '#' ? a.id === k.slice(1) : cls.includes(' ' + k + ' ') || cls.includes(' ' + k + '-wrap ')) return label;
  }
  return '';
};
const struct = (html) => [...new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c && !/^hue-|^mi-|^is-|^has-|selected|active|checked/.test(c)))].sort().join(' ');
export const inChain = (s, cls) => s.chain.some((c) => (' ' + (c.a.class || '') + ' ').includes(' ' + cls + ' '));

const CHIPS = [
  ['k-state', 'State chip'], ['filter-chip', 'Filter chip'], ['k-multi', 'Multi-select chip'], ['ms-box', 'Multi-select chip'],
  ['k-select', 'Select chip'], ['k-doc', 'Document chip'], ['doc-chip', 'Document chip'], ['wv-tag', 'Field kind tag'], ['term-tag', 'Term tag'],
  ['wv-chip-id', 'ID chip'], ['auto-pill', 'Automation pill'], ['share-chip', 'Share chip'], ['fx-chip', 'Formula chip'], ['list-chip', 'List chip'],
  ['list-group-chip', 'List group chip'], ['opt-dot', 'Option dot'], ['wv-card-state', 'Card state'], ['nav-account-chip', 'Account chip'], ['badge', 'Badge'],
];
export const COMPONENT = (s) => {
  if (s.cat === 'chip') {
    const cls = s.sig.split('.').slice(1);
    for (const [c, name] of CHIPS) if (cls.includes(c)) return name;
    return null;
  }
  if (s.cat !== 'input') return null;
  const c = s.sig + ' ' + (s.html.match(/^<[a-z]+[^>]*/) || [''])[0];
  if (/\binline-edit\b/.test(c)) return 'Inline cell edit';
  if (/picker-search|id="cmdk-input"|table-search-input|search-bare/.test(c)) return 'Bare search';
  if (/view-title|name-edit/.test(c)) return 'Title edit';
  if (/new-row-name/.test(c)) return 'New row name';
  return 'Form field';
};
const compClass = (comp) => CHIPS.filter(([, n]) => n === comp).map(([c]) => c);
const chipState = (s, comp) => s.sig.split('.').slice(1).filter((c) => !/^hue-/.test(c) && !compClass(comp).includes(c) && !GENERIC.has(c)).sort().join(' · ');

const family = (g) => {
  if (g.cat !== 'button') return '';
  const c = g.sig.split('.').slice(1);
  if (c.includes('btn-primary')) return 'Primary';
  if (c.some((x) => /dots-btn|btn-icon|icon-btn|nav-caret|mention-caret|ws-icon|tiny|fab/.test(x)) || ([...g.texts][0] || '').length <= 2) return 'Icon and compact';
  if (c.some((x) => /^table-|eye-btn|share-btn|crumb/.test(x))) return 'Toolbar';
  if (c.includes('btn')) return 'Standard';
  return 'Custom';
};
const FAMORDER = ['Primary', 'Standard', 'Toolbar', 'Icon and compact', 'Custom', ''];
const EMPTY = /icon-ghost|class="[^"]*\bis-empty\b/;
const rowsKey = (rows) => (rows || []).join('/').replace(/\(.*?\)/g, '').replace(/\d+/g, '#');
const themeOf = (s) => s.chain.find((c) => c.t === 'html')?.a['data-bs-theme'] || 'light';
const whereOf = (route) => route.replace(/^Entity: .*/, 'Record page').replace(/^Table: .*/, 'Table view').replace(/^Space: .*/, 'Space page');

function keys(s) {
  const L = s.key.split('::').pop().split('|');
  const shape = [L[3], L[4], L[6], L[7], L[8], L[9]].join('|');
  const empty = EMPTY.test(s.html) ? '::empty' : '';
  if (s.cat === 'toast') return { exact: s.key, loose: s.key };
  if (s.comp) return { exact: s.sig + '::' + shape + empty, loose: noHue(s.sig) + empty };
  if (CONTAINER.has(s.cat)) {
    const rk = rowsKey(s.rows);
    return { exact: s.sig + '::' + (['menu', 'colmenu'].includes(s.cat) ? '' : struct(s.html)) + rk, loose: normSig(s.sig, s) + '::' + (rk || struct(s.html)) };
  }
  return { exact: s.sig + '::' + shape + empty, loose: noHue(s.sig) + '::' + stateOf(s) + empty };
}

export function mergeLanes(lanes) {
  const byView = new Map();
  for (const l of lanes) {
    const k = `${l.meta.lane.width}-${l.meta.lane.theme}`;
    const o = byView.get(k);
    if (!o) { byView.set(k, { meta: { ...l.meta, routes: [...(l.meta.routes || [])] }, specs: [...l.specs] }); continue; }
    o.meta.blocked = (o.meta.blocked || 0) + (l.meta.blocked || 0);
    o.meta.themeFlips = (o.meta.themeFlips || 0) + (l.meta.themeFlips || 0);
    o.meta.routes.push(...(l.meta.routes || []));
    o.specs.push(...l.specs);
  }
  return [...byView.values()];
}

export function prepare(lanes) {
  const out = [];
  const laneMeta = [];
  for (const l of mergeLanes(lanes)) {
    const { theme, width, vw, vh } = l.meta.lane;
    let mismatch = 0;
    const seen = new Set();
    for (const raw of l.specs) {
      if (seen.has(raw.key)) continue;
      seen.add(raw.key);
      if (themeOf(raw) !== theme) { mismatch++; continue; }
      const s = { ...raw, cat: recat(raw), theme, width, vw, vh };
      if (inChain(s, 'vditor-copy')) continue;
      if (s.cat === 'input' && inChain(s, 'date-pop')) Object.assign(s, { cat: 'picker', comp: 'Date picker fields' });
      else s.comp = COMPONENT(s);
      if (!CATS.some((c) => c[0] === s.cat)) continue;
      if (s.cat === 'toast' && !/^toast::[A-Z]/.test(s.key)) continue;
      out.push(s);
    }
    laneMeta.push({ theme, width, vw, vh, blocked: l.meta.blocked || 0, routes: l.meta.routes || [], themeFlips: l.meta.themeFlips || 0, themeMismatch: mismatch });
  }
  const order = (s) => VIEWS.indexOf(`${s.width}-${s.theme}`);
  return { specs: out.sort((a, b) => order(a) - order(b)), lanes: laneMeta };
}

export function group(specs) {
  const groups = new Map();
  for (const s of specs) {
    const view = `${s.width}-${s.theme}`;
    const gk = s.cat + '::' + (s.comp || normSig(s.sig, s)) + (!s.comp && CONTAINER.has(s.cat) && !['menu', 'colmenu', 'toast', 'bar', 'nav'].includes(s.cat) ? '::' + struct(s.html) : '');
    const k = keys(s);
    let g = groups.get(gk);
    const same = g?.looks.find((l) => l.exact === k.exact);
    let look = same || g?.looks.find((l) => l.loose === k.loose && !l.views[view]);
    if (!look && !g && view !== VIEWS[0]) {
      for (const o of groups.values()) {
        if (o.cat !== s.cat || (o.comp || null) !== (s.comp || null)) continue;
        look = o.looks.find((l) => l.loose === k.loose && !l.views[view]);
        if (look) { g = o; break; }
      }
    }
    if (!g) groups.set(gk, g = { gk, cat: s.cat, sig: s.comp || normSig(s.sig, s), comp: s.comp || null, count: 0, routes: new Set(), texts: new Set(), looks: [] });
    g.count += s.count;
    s.routes.forEach((r) => g.routes.add(r));
    s.texts.forEach((t) => g.texts.size < 12 && t && g.texts.add(t));
    const v = { html: s.html, chain: s.chain, w: s.w, h: s.h, bg: s.theme === 'light' ? s.bg : null, shot: s.shot || null, full: !!s.overlay && s.w >= 0.8 * s.vw && s.h >= 0.7 * s.vh };
    if (look) {
      look.count += s.count;
      if (!look.views[view]) look.views[view] = v;
      continue;
    }
    g.looks.push({
      exact: k.exact, loose: k.loose, count: s.count, sig: s.sig,
      state: s.comp && s.cat === 'chip' ? chipState(s, s.comp) : stateOf(s),
      land: landOf(s.chain), where: whereOf(s.routes[0] || ''),
      label: s.trigger?.text || s.texts[0] || '', overlay: !!s.overlay,
      trig: s.trigger ? { text: s.trigger.text, html: s.trigger.html } : null, rows: s.rows || [],
      views: { [view]: v },
    });
  }
  return [...groups.values()];
}

export function fillViews(looks) {
  for (const l of looks) for (const width of ['desktop', 'phone']) {
    const light = l.views[`${width}-light`], dark = l.views[`${width}-dark`];
    if (light && !dark) l.views[`${width}-dark`] = { ...light, bg: null, shot: null, derived: true };
    if (dark && !light) l.views[`${width}-light`] = { ...dark, shot: null, derived: true };
  }
  return looks;
}

const EMPTY_ICON = '<button class="icon-btn" type="button" title="Set icon"><span class="wv-icon icon-ghost">◌</span></button>';
function ensureEmptyIcon(controls) {
  for (const g of controls) if (g.cat === 'button' && g.sig === 'button.icon-btn' && !g.looks.some((l) => Object.values(l.views).some((v) => v.html.includes('◌')))) {
    const v0 = Object.values(g.looks[0].views)[0];
    g.looks.unshift({ ...g.looks[0], exact: 'default', loose: 'default', count: 0, label: 'Set icon', where: 'No icon set (default)', views: { 'desktop-light': { ...v0, html: EMPTY_ICON, shot: null, derived: true } } });
  }
}

const mode = (a) => { const c = {}; let best = ''; for (const x of a) { c[x] = (c[x] || 0) + 1; if (!best || c[x] > c[best]) best = x; } return best; };
const nameOf = (g) => {
  if (g.comp) return g.comp;
  if (/#| > /.test(g.sig)) return g.sig;
  const c = g.sig.split('.').slice(1).filter((x) => x && !GENERIC.has(x));
  return c.length ? c.join(' · ') : g.sig.split('.')[0];
};

export function buildCatalog(lanes, { functions = FUNCTIONS, meta = {} } = {}) {
  const { specs, lanes: laneMeta } = prepare(lanes);
  const gs = group(specs);
  ensureEmptyIcon(gs);
  for (const g of gs) {
    g.looks.sort((a, b) => (b.exact === 'default') - (a.exact === 'default') || b.count - a.count);
    g.looks = fillViews(g.looks.slice(0, STEP.has(g.cat) ? 30 : 24));
    g.fam = family(g);
  }
  const ordered = [];
  for (const [cat, letter] of CATS) {
    const list = gs.filter((g) => g.cat === cat).sort((a, b) => FAMORDER.indexOf(a.fam) - FAMORDER.indexOf(b.fam) || b.count - a.count);
    list.forEach((g, i) => { g.code = letter + '-' + String(i + 1).padStart(2, '0'); });
    ordered.push(...list);
  }
  const byHtml = new Map();
  for (const g of ordered) for (const l of g.looks) for (const v of Object.values(l.views)) if (!byHtml.has(v.html)) byHtml.set(v.html, g);
  for (const g of ordered) for (const l of g.looks) if (l.trig?.html) {
    const t = byHtml.get(l.trig.html);
    if (t && t !== g) { l.trig.code = t.code; (t.opens ||= new Set()).add(g.code); }
  }
  const shots = [];
  const shotIndex = new Map();
  const controls = ordered.map((g) => {
    const c = {
      code: g.code, cat: g.cat, fam: g.fam, name: nameOf(g), sig: g.sig, comp: g.comp, count: g.count,
      land: mode(g.looks.map((l) => l.land).filter(Boolean)), routes: [...g.routes], texts: [...g.texts],
      opens: [...(g.opens || [])], step: STEP.has(g.cat),
      looks: g.looks.map(({ exact, loose, ...l }) => ({
        ...l,
        views: Object.fromEntries(VIEWS.filter((v) => l.views[v]).map((v) => {
          const view = { ...l.views[v] };
          if (view.shot) {
            if (!shotIndex.has(view.shot)) { shotIndex.set(view.shot, shots.length); shots.push(view.shot); }
            view.shot = shotIndex.get(view.shot);
          }
          return [v, view];
        })),
      })),
    };
    c.functions = functionsOf(c, functions);
    return c;
  });
  const fns = functions.map((f) => ({ id: f.id, title: f.title, blurb: f.blurb, controls: controls.filter((c) => c.functions.includes(f.id)).map((c) => c.code) })).filter((f) => f.controls.length);
  const looks = controls.reduce((n, c) => n + c.looks.length, 0);
  return {
    meta: { routes: [...new Set(laneMeta.flatMap((l) => l.routes.map((r) => r.replace(/: triggers .*$/, '').replace(/^Phone · /, ''))))], ...meta, lanes: laneMeta, controls: controls.length, looks, functions: fns.length, blocked: laneMeta.reduce((n, l) => n + l.blocked, 0) },
    cats: CATS.map(([id, letter, title]) => ({ id, letter, title })),
    functions: fns, controls, shots,
    unmapped: controls.filter((c) => !c.functions.length).map((c) => c.code),
  };
}

export const rewriteCss = (css) => css
  .replace(/@media\s*\(max-width:\s*\d+px\)\s*,\s*\(pointer:\s*coarse\)/g, '@container wvphone (min-width: 0px)')
  .replace(/@media\s*\(max-width:\s*(\d+)px\)/g, '@container wvphone (max-width: $1px)')
  .replace(/@media\s*\((?:hover:\s*none|pointer:\s*coarse)\)/g, '@container wvphone (min-width: 0px)')
  .replace(/:root/g, ':host')
  .replace(/(^|[\s,>+~(}])html(?=[\s,.:#[>{+~)])/g, '$1.sh-html')
  .replace(/(^|[\s,>+~(}])body(?=[\s,.:#[>{+~)])/g, '$1.sh-body');

export const CSS_FILES = ['vendor/tabler.min.css', 'vendor/vditor/dist/index.css', 'chip.css', 'style.css', 'vendor/lucide-moving.css'];
export const weaveCss = (pub = join(ROOT, 'public')) => CSS_FILES.map((f) => rewriteCss(readFileSync(join(pub, f), 'utf8'))).join('\n');

const safe = (x) => JSON.stringify(x).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
const eachView = (data, fn) => { for (const c of data.controls) for (const l of c.looks) for (const v of Object.values(l.views)) fn(v); };
export function pack(data) {
  const out = structuredClone(data);
  const pool = [];
  const at = new Map();
  const ref = (s) => { if (!at.has(s)) { at.set(s, pool.length); pool.push(s); } return at.get(s); };
  eachView(out, (v) => { v.html = ref(v.html); v.chain = ref(JSON.stringify(v.chain)); });
  out.pool = pool;
  return out;
}
export function unpack(data) {
  if (!data.pool) return data;
  eachView(data, (v) => {
    if (typeof v.html === 'number') v.html = data.pool[v.html];
    if (typeof v.chain === 'number') v.chain = JSON.parse(data.pool[v.chain]);
  });
  delete data.pool;
  return data;
}
export function renderPage(data, css, tpl = readFileSync(new URL('./page.html', import.meta.url), 'utf8')) {
  return tpl.replace('__WEAVE_CSS__', () => css.replace(/<\//g, '<\\/')).replace('__DATA__', () => safe(pack(data)));
}
export function readPageData(html) {
  const m = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('the page carries no data block');
  return unpack(JSON.parse(m[1]));
}

export function writeCatalog(lanes, { out = join(ROOT, 'docs', 'ui-catalog', 'index.html'), meta = {} } = {}) {
  const data = buildCatalog(lanes, { meta });
  if (data.unmapped.length) {
    const list = data.controls.filter((c) => data.unmapped.includes(c.code)).map((c) => `  ${c.code} ${c.name} (${c.sig}) ${c.texts.slice(0, 3).join(' / ')}`);
    throw new Error(`${data.unmapped.length} control(s) map to no function; add a rule to tools/ui-catalog/functions.mjs:\n${list.join('\n')}`);
  }
  const html = renderPage(data, weaveCss());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return { data, bytes: Buffer.byteLength(html), out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = process.argv.slice(2).filter((f) => existsSync(f));
  const lanes = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  let sha = process.env.SHA;
  try { sha ||= execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%h'], { encoding: 'utf8' }).trim(); } catch {}
  const { data, bytes, out } = writeCatalog(lanes, { meta: { version: pkg.version, sha: sha || 'unknown', at: new Date().toISOString().slice(0, 10) } });
  console.log(`${out}: ${bytes} bytes, ${data.functions.length} functions, ${data.controls.length} controls, ${data.meta.looks} looks, ${data.shots.length} screenshots`);
}
