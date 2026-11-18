import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, readPageData, VIEWS } from '../tools/ui-catalog/build.mjs';
import { FUNCTIONS, functionsOf } from '../tools/ui-catalog/functions.mjs';
import { catalogRoutes, seedCatalogWorkspace } from '../tools/ui-catalog/run.mjs';
import { tempDir } from './lib/temp.mjs';
import { catalogNames, harvestedRoutes, harvestedTriggers, stateRoutes, surfaceGaps } from './lib/ui-surfaces.mjs';

const PAGE = fileURLToPath(new URL('../docs/ui-catalog/index.html', import.meta.url));
const BUDGET = 8 * 1024 * 1024;

const LOOK = 'rgb(0, 0, 0)|rgb(1, 1, 1)|rgb(2, 2, 2)|1px|4px|28|14px|500|8px|none';
const PHONE_LOOK = 'rgb(0, 0, 0)|rgb(1, 1, 1)|rgb(2, 2, 2)|1px|4px|44|16px|500|12px|none';
const chainOf = (...classes) => [{ t: 'html', a: {} }, { t: 'body', a: {} }, ...classes.map((c) => ({ t: 'div', a: { class: c } }))];
function spec(o) {
  const cat = o.cat ?? 'button';
  const sig = o.sig ?? 'button.btn';
  return {
    id: 'x', cat, sig, html: o.html ?? `<${sig.split('.')[0]} class="${sig.split('.').slice(1).join(' ')}">${o.text ?? 'Go'}</${sig.split('.')[0]}>`,
    chain: o.chain ?? chainOf('view-header'), bg: 'rgb(255, 255, 255)', w: o.w ?? 60, h: o.h ?? 28, pos: 'static',
    text: o.text ?? 'Go', rows: o.rows ?? [], count: 1, routes: o.routes ?? ['Home'], texts: [o.text ?? 'Go'], shot: o.shot ?? null,
    ...(o.overlay ? { overlay: true } : {}), ...(o.trigger ? { trigger: o.trigger } : {}),
    key: o.key ?? `${cat}::${sig}::${o.look ?? LOOK}`,
  };
}
function lane(theme, width, specs) {
  const vw = width === 'phone' ? 390 : 1440;
  return {
    meta: { lane: { theme, width, vw, vh: width === 'phone' ? 844 : 900 }, blocked: 0, routes: [], themeFlips: 0 },
    specs: specs.map((s) => ({ ...s, chain: s.chain.map((c) => (c.t === 'html' ? { ...c, a: { ...c.a, 'data-bs-theme': theme } } : c)) })),
  };
}
const MATCH_ALL = [{ id: 'everything', title: 'Everything', blurb: '', match: [{}] }];
const build = (lanes, functions = MATCH_ALL) => buildCatalog(lanes, { functions, meta: { version: 'test', sha: 'test', at: '2026-10-10' } });
const controlsNamed = (data, name) => data.controls.filter((c) => c.name === name);

test('text inputs collapse to five components, keyed on component and never on the class signature', () => {
  const inputs = [
    ['input.inline-edit', 'Inline cell edit'], ['input.date-text.inline-edit', 'Inline cell edit'], ['input.inline-edit.range-text', 'Inline cell edit'],
    ['input.date-text-wide.inline-edit', 'Inline cell edit'], ['input.field-desc.form-control', 'Form field'], ['textarea.bug-note.form-control', 'Form field'],
    ['input.form-control.term-plural', 'Form field'], ['input.form-control.full', 'Form field'], ['input.picker-search', 'Bare search'],
    ['input.table-search-input', 'Bare search'], ['input.view-title', 'Title edit'], ['input.name-edit', 'Title edit'], ['input.new-row-name', 'New row name'],
  ].map(([sig, comp], i) => [spec({ cat: 'input', sig, text: `v${i}`, look: `${LOOK}|${i}` }), comp]);
  inputs.push([spec({ cat: 'input', sig: 'input.', html: '<input id="cmdk-input">', look: `${LOOK}|cmdk` }), 'Bare search']);
  const data = build([lane('light', 'desktop', inputs.map(([s]) => s))]);
  const names = [...new Set(data.controls.filter((c) => c.cat === 'input').map((c) => c.name))].sort();
  assert.deepEqual(names, ['Bare search', 'Form field', 'Inline cell edit', 'New row name', 'Title edit']);
  assert.equal(controlsNamed(data, 'Inline cell edit').length, 1, 'four inline-edit signatures are one control');
  assert.equal(controlsNamed(data, 'Inline cell edit')[0].looks.length, 4, 'each signature stays a look of that control');
});

test('date-picker inputs file with the date picker and the editor clipboard textarea is left out', () => {
  const data = build([lane('light', 'desktop', [
    spec({ cat: 'input', sig: 'input.date-smart', chain: chainOf('date-pop') }),
    spec({ cat: 'input', sig: 'input.date-time', chain: chainOf('date-pop'), look: `${LOOK}|t` }),
    spec({ cat: 'input', sig: 'textarea', chain: chainOf('vditor', 'vditor-copy'), look: `${LOOK}|c` }),
  ])]);
  assert.deepEqual(data.controls.map((c) => [c.cat, c.name]), [['picker', 'Date picker fields']]);
  assert.equal(data.controls[0].looks.length, 2);
});

test('chips key on component: tone, context and state are looks of one chip', () => {
  const data = build([lane('light', 'desktop', [
    spec({ cat: 'chip', sig: 'span.chip-trigger.hue-red.k-select', text: 'High', look: `${LOOK}|a` }),
    spec({ cat: 'chip', sig: 'span.hue-blue.k-select.picker-chip', text: 'Low', look: `${LOOK}|b` }),
    spec({ cat: 'chip', sig: 'span.cat-done.k-state', text: 'Done', look: `${LOOK}|c` }),
    spec({ cat: 'chip', sig: 'span.cat-in-progress.chip-trigger.k-state', text: 'Doing', look: `${LOOK}|d` }),
    spec({ cat: 'chip', sig: 'span.k-multi.picker-chip', text: 'Slow', look: `${LOOK}|e` }),
    spec({ cat: 'chip', sig: 'span.chip-trigger.ms-box', text: 'Edit selections', look: `${LOOK}|f` }),
    spec({ cat: 'chip', sig: 'span.cat-done.filter-chip', text: 'Fixed', look: `${LOOK}|g` }),
  ])]);
  const chips = data.controls.filter((c) => c.cat === 'chip');
  assert.deepEqual(chips.map((c) => c.name).sort(), ['Filter chip', 'Multi-select chip', 'Select chip', 'State chip']);
  assert.equal(chips.find((c) => c.name === 'Select chip').looks.length, 2, 'a cell chip and a picker chip are two looks of the select chip');
  assert.equal(chips.find((c) => c.name === 'State chip').looks.length, 2);
  assert.equal(chips.find((c) => c.name === 'Multi-select chip').looks.length, 2, 'the multi-select box files with the multi-select chip');
  assert.deepEqual(chips.find((c) => c.name === 'State chip').looks.map((l) => l.state).sort(), ['cat-done', 'cat-in-progress · chip-trigger']);
});

test('state classes merge into one control with labelled looks', () => {
  const data = build([lane('light', 'desktop', [
    spec({ sig: 'button.btn.table-view-btn' }),
    spec({ sig: 'button.active.btn.table-view-btn' }),
    spec({ sig: 'button.btn.on.table-view-btn', html: '<button class="btn table-view-btn on" aria-pressed="true">Go</button>' }),
  ])]);
  assert.equal(data.controls.length, 1, 'active and on are states of one button, not three buttons');
  assert.deepEqual(data.controls[0].looks.map((l) => l.state).sort(), ['', 'active', 'on · pressed']);
});

test('one control gathers desktop and phone captures in light and dark into four views of each look', () => {
  const s = spec({ sig: 'button.btn.dots-btn', shot: 'data:image/webp;base64,AAAA' });
  const phone = spec({ sig: 'button.btn.dots-btn', look: PHONE_LOOK, h: 44, shot: 'data:image/webp;base64,BBBB' });
  const data = build([lane('light', 'desktop', [s]), lane('dark', 'desktop', [{ ...s, shot: 'data:image/webp;base64,CCCC' }]), lane('light', 'phone', [phone])]);
  assert.equal(data.controls.length, 1);
  const [look] = data.controls[0].looks;
  assert.deepEqual(Object.keys(look.views).sort(), [...VIEWS].sort(), 'every look that renders at both widths shows all four views');
  assert.equal(look.views['phone-dark'].derived, true, 'a view no lane captured renders live from its sibling under the real dark theme');
  assert.equal(look.views['phone-dark'].shot, null, 'a derived view claims no screenshot');
  assert.equal(look.views['desktop-dark'].derived, undefined);
  assert.equal(data.shots[look.views['desktop-dark'].shot], 'data:image/webp;base64,CCCC');
  assert.equal(look.views['phone-light'].h, 44, 'the phone view keeps the phone capture');
});

test('a look seen at one width shows two views and says where it was not seen', () => {
  const data = build([lane('light', 'desktop', [spec({})]), lane('dark', 'desktop', [spec({})])]);
  assert.deepEqual(Object.keys(data.controls[0].looks[0].views).sort(), ['desktop-dark', 'desktop-light']);
});

test('screenshots are stored once however many views share them', () => {
  const shot = 'data:image/webp;base64,SAME';
  const data = build([lane('light', 'desktop', [spec({ shot }), spec({ sig: 'button.btn.other', shot, look: `${LOOK}|2` })])]);
  assert.deepEqual(data.shots, [shot]);
});

test('a full-screen dialog is marked so the page draws its panel, at either width', () => {
  const dlg = (w, h) => spec({ cat: 'dialog', sig: 'div.', html: '<div id="modal-back"><div id="modal">x</div></div>', overlay: true, w, h, rows: ['Cancel'] });
  const data = build([lane('light', 'desktop', [dlg(1440, 900)]), lane('light', 'phone', [dlg(390, 844)])]);
  const views = data.controls[0].looks[0].views;
  assert.equal(views['desktop-light'].full, true);
  assert.equal(views['phone-light'].full, true);
});

test('toasts come only from toast() kinds, never from whatever the crawl triggered', () => {
  const data = build([lane('light', 'desktop', [
    spec({ cat: 'toast', sig: 'div.wv-toast', key: 'toast::div.wv-toast::x', text: 'Saved' }),
    spec({ cat: 'toast', sig: 'div.wv-toast', key: 'toast::Info', text: 'Link copied', trigger: { text: 'Info', html: '' } }),
    spec({ cat: 'toast', sig: 'div.err.wv-toast', key: 'toast::Error', text: 'Could not save', trigger: { text: 'Error', html: '' } }),
  ])]);
  assert.deepEqual(data.controls.flatMap((c) => c.looks.map((l) => l.label)).sort(), ['Error', 'Info']);
});

test('a control no function claims is reported, never filed under an Unsorted bucket', () => {
  const data = build([lane('light', 'desktop', [spec({ sig: 'button.mystery-btn' })])], [{ id: 'search', title: 'Search', blurb: '', match: [{ sig: /search/ }] }]);
  assert.deepEqual(data.unmapped, [data.controls[0].code]);
  assert.ok(!data.functions.some((f) => /unsorted/i.test(f.title)));
});

test('the functions map names each job once and every rule can match', () => {
  const ids = FUNCTIONS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'function ids are unique');
  for (const f of FUNCTIONS) {
    assert.ok(f.title && !/unsorted|other|misc/i.test(f.title), `${f.id} names a job`);
    assert.ok(f.match.length, `${f.id} has rules`);
  }
});

const page = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : '';
const data = page ? readPageData(page) : null;

test('the generated catalog is committed and fits the 8 MB budget', () => {
  assert.ok(page, 'docs/ui-catalog/index.html exists: run npm run ui-catalog');
  const size = statSync(PAGE).size;
  assert.ok(size < BUDGET, `docs/ui-catalog/index.html is ${size} bytes, over the ${BUDGET} byte budget`);
  assert.deepEqual(data.shots.filter((s) => !s.startsWith('data:image/webp;base64,')).map((s) => s.slice(0, 30)), [], 'screenshots are WebP');
  assert.equal(new Set(data.shots).size, data.shots.length, 'each screenshot is stored once');
});

test('every harvested control maps to at least one function under the current map', () => {
  assert.deepEqual(data.unmapped, [], 'the build found no unmapped control');
  const lost = data.controls.filter((c) => !functionsOf(c).length).map((c) => `${c.code} ${c.name} (${c.sig})`);
  assert.deepEqual(lost, [], `controls no function claims:\n${lost.join('\n')}`);
  for (const f of data.functions) assert.ok(f.controls.length, `${f.title} lists at least one control`);
  assert.ok(!data.functions.some((f) => /unsorted/i.test(f.title)));
});

test('every look that renders at both widths shows desktop and phone in light and dark', () => {
  const missing = [];
  for (const c of data.controls) for (const l of c.looks) {
    const has = Object.keys(l.views);
    const both = has.some((v) => v.startsWith('desktop')) && has.some((v) => v.startsWith('phone'));
    if (both && VIEWS.some((v) => !l.views[v])) missing.push(`${c.code} ${l.label}`);
  }
  assert.deepEqual(missing, []);
  assert.ok(data.controls.some((c) => c.looks.some((l) => VIEWS.every((v) => l.views[v] && !l.views[v].derived))), 'at least one look was captured in all four lanes');
});

test('dark captures come from weave\'s own dark theme and no lane flipped the theme', () => {
  assert.deepEqual(data.meta.lanes.map((l) => `${l.width}-${l.theme}`).sort(), [...VIEWS].sort());
  for (const l of data.meta.lanes) {
    assert.equal(l.themeFlips, 0, `${l.width}-${l.theme} lane clicked the theme toggle`);
    assert.equal(l.themeMismatch, 0, `${l.width}-${l.theme} lane captured specimens in the other theme`);
  }
});

test('the catalog shows each toast kind, an empty and a set icon, and table cells inside their table', () => {
  const toast = data.controls.filter((c) => c.cat === 'toast').flatMap((c) => c.looks.map((l) => l.label));
  for (const kind of ['Info', 'Success with Undo', 'Error', 'Automation', 'Repeated (×3)', 'Long message']) assert.ok(toast.includes(kind), `toast kind ${kind}`);
  const icon = data.functions.find((f) => f.id === 'set-icon');
  const looks = data.controls.filter((c) => icon.controls.includes(c.code) && c.cat === 'button').flatMap((c) => c.looks.map((l) => l.views['desktop-light']?.html ?? ''));
  assert.ok(looks.some((h) => h.includes('◌')), 'Set an icon shows the empty default');
  assert.ok(looks.some((h) => !h.includes('◌')), 'Set an icon shows a set icon');
  const cells = data.controls.filter((c) => c.cat === 'cell' && /^(td|th)\b/.test(c.sig));
  assert.ok(cells.length, 'table cells were harvested');
  for (const c of cells) for (const l of c.looks) for (const v of Object.values(l.views)) {
    assert.match(v.html, /^<table[\s>]/, `${c.code} renders inside a table`);
    assert.match(v.html, /<thead/, `${c.code} carries its header row`);
  }
});

const BASELINE = fileURLToPath(new URL('./ui-surface-baseline.json', import.meta.url));
const allowed = JSON.parse(readFileSync(BASELINE, 'utf8'));
const STATES_SRC = readFileSync(fileURLToPath(new URL('./lib/states.mjs', import.meta.url)), 'utf8');
const named = (entries) => entries.map((e) => `- ${e}`).join('\n');

test('a surface the state catalogue does not list is named, and one it opens is not (Issue #1466)', () => {
  const states = new Map([['#/table/:id', 'open-table']]);
  const names = catalogNames("tap(page, '#main .table-share-btn', cell); menu(page, cell, '.dots-btn', 'Forms…');");
  const triggers = [
    { sig: 'btn.table-share-btn', classes: ['btn', 'table-share-btn'], labels: ['Share'] },
    { sig: 'dots-btn', classes: ['dots-btn'], labels: ['Forms…'] },
    { sig: 'wv-start-new', classes: ['wv-start-new'], labels: ['+ New table'] },
  ];
  const gaps = surfaceGaps({ routes: ['#/table/:id', '#/map'], triggers, states, names, allowed: {} });
  assert.deepEqual(gaps.missing.routes, ['#/map'], 'a crawled route with no state is named');
  assert.deepEqual(gaps.missing.triggers, ['wv-start-new'], 'a trigger no state names is named, by its class signature');
  assert.deepEqual(gaps.stale, { routes: [], triggers: [] });
  const recorded = { routes: { '#/map': { issue: 1, why: 'no map state' } }, triggers: { 'wv-start-new': { issue: 1, why: 'no new-table state' }, 'dots-btn': { issue: 1, why: 'covered' } } };
  const held = surfaceGaps({ routes: ['#/table/:id', '#/map'], triggers, states, names, allowed: recorded });
  assert.deepEqual(held.missing, { routes: [], triggers: [] }, 'a recorded gap holds the gate');
  assert.deepEqual(held.stale.triggers, ['dots-btn'], 'a recorded entry the catalogue now opens is stale, so the ledger only shrinks');
});

test('test/ui-surface-baseline.json records each gap with the Issue that tracks it (Issue #1466)', () => {
  assert.match(allowed._, /only shrinks/, 'the ledger says it only shrinks');
  for (const section of ['routes', 'triggers']) {
    assert.ok(allowed[section], `the ledger has a ${section} section`);
    for (const [key, entry] of Object.entries(allowed[section])) {
      assert.ok(Number.isInteger(entry.issue), `${section} ${key} names the Issue that tracks it`);
      assert.ok(entry.why?.length > 10, `${section} ${key} says what the surface opens`);
    }
  }
});

test('every route the UI catalog crawls has a state in test/lib/states.mjs (Issue #1466)', () => {
  const weave = seedCatalogWorkspace(join(tempDir('weave-ui-surface-'), 'weave.db'));
  const routes = harvestedRoutes(catalogRoutes(weave).routes);
  assert.ok(routes.length > 4, 'the crawl lists its routes');
  const gaps = surfaceGaps({ routes, triggers: [], states: stateRoutes(), names: catalogNames(STATES_SRC), allowed });
  assert.deepEqual(gaps.missing.routes, [], `routes the UI catalog crawls that no state walks:\n${named(gaps.missing.routes)}`);
  assert.deepEqual(gaps.stale.routes, [], `test/ui-surface-baseline.json routes that are no longer gaps; drop them:\n${named(gaps.stale.routes)}`);
});

test('every overlay trigger the UI catalog harvested has a state that opens it (Issue #1466)', () => {
  const triggers = harvestedTriggers(data);
  assert.ok(triggers.length > 20, 'the catalog page carries its overlay triggers');
  const gaps = surfaceGaps({ routes: [], triggers, states: stateRoutes(), names: catalogNames(STATES_SRC), allowed });
  assert.deepEqual(gaps.missing.triggers, [], `overlay triggers no state in test/lib/states.mjs names, so no probe opens them; add a state or record the gap in test/ui-surface-baseline.json:\n${named(gaps.missing.triggers)}`);
  assert.deepEqual(gaps.stale.triggers, [], `test/ui-surface-baseline.json triggers a state now names; drop them:\n${named(gaps.stale.triggers)}`);
});

test('one trigger planted beside the harvested ones fails the gate by name (Issue #1466)', () => {
  const planted = { sig: 'wv-fresh-surface-btn', classes: ['btn', 'wv-fresh-surface-btn'], labels: ['Open the new thing'] };
  const gaps = surfaceGaps({ routes: [], triggers: [...harvestedTriggers(data), planted], states: stateRoutes(), names: catalogNames(STATES_SRC), allowed });
  assert.deepEqual(gaps.missing.triggers, [planted.sig], 'a surface added to the app enters the state catalogue or fails CI with its name');
});
