import { Weave, TYPE_MIGRATIONS } from '../../src/engine.js';

function base() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const company = w.createTable({ space: 'Ops', name: 'Company' });
  w.addField(company.id, { name: 'Size', type: 'number' });
  const deal = w.createTable({ space: 'Ops', name: 'Deal' });
  w.addRelation(deal.id, { name: 'Company', targetDb: company.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  return { w, deal, company };
}

function scrubber(w) {
  const names = new Map();
  for (const t of Object.values(w.state.tables)) {
    names.set(t.id, `<table ${t.name}>`);
    for (const f of Object.values(t.fields)) names.set(f.id, `<field ${t.name}.${f.name}>`);
  }
  for (const e of Object.values(w.state.entities)) names.set(e.id, `<record ${e.publicId}>`);
  const walk = (v) => {
    if (typeof v === 'string') return names.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk;
}

const outcome = (fn) => {
  try { return { ok: fn() }; } catch (err) { return { error: `${err.code ?? 'error'}: ${err.message}` }; }
};

export const ADD_CASES = [
  ['text', {}], ['text', { literal: true }], ['text', { default: 'hi', width: 200, description: 'A note' }], ['text', { width: 10 }],
  ['number', {}], ['number', { format: 'number' }], ['number', { format: 'currency', unit: 'eur' }],
  ['number', { format: 'currency', currency: 'usd', decimals: 2, separator: true, accounting: true }],
  ['number', { format: 'compact', separator: true }], ['number', { display: 'bar', scale: 10, color: 'accent' }],
  ['number', { display: 'ring', scale: 'column' }], ['number', { display: 'text', scale: 4 }],
  ['number', { display: 'sparkline' }], ['number', { format: 'bogus' }], ['number', { decimals: 7 }],
  ['number', { accounting: true }], ['number', { currency: 'zzz1' }], ['number', { color: 'pink' }], ['number', { default: 3 }],
  ['rating', {}], ['rating', { max: 10, icon: 'lucide:heart', color: 'accent' }], ['rating', { max: 0 }], ['rating', { default: 7 }],
  ['date', {}], ['date', { grain: ['year', 'month'] }], ['date', { time: true, clock: '24h', zone: 'fixed', zoneName: 'Europe/Berlin' }],
  ['date', { format: 'iso', pad: true }], ['date', { format: 'long' }], ['date', { zone: 'instant' }], ['date', { elapsed: true }],
  ['date', { grain: [], time: true }], ['date', { grain: [] }], ['date', { default: 'today()' }], ['date', { format: 'nope' }],
  ['daterange', {}], ['daterange', { time: true, elapsed: true }], ['daterange', { elapsed: true }],
  ['checkbox', {}], ['checkbox', { default: true }], ['url', {}], ['email', {}], ['email', { default: 'a@b.co' }],
  ['toggle', {}], ['toggle', { on: 'Yes', off: 'No' }], ['toggle', { on: 'a', off: 'A' }], ['toggle', { on: ' ' }],
  ['select', { options: ['A', { name: 'B', hue: 'green', icon: 'lucide:star' }] }], ['select', { options: [{ name: 'C', color: 'nope' }] }],
  ['select', { options: ['A'], default: 'a' }], ['select', {}],
  ['multiselect', { options: ['A', 'B'], default: ['a', 'b'] }],
  ['workflow', {}], ['workflow', { states: ['Open', { name: 'Done', category: 'done', default: true }] }], ['workflow', { states: [] }],
  ['workflow', { states: [{ name: 'X', category: 'bad' }] }], ['workflow', { states: [{ name: 'A', category: 'other', default: true }, { name: 'B', default: true, hue: 'red' }] }],
  ['relation', {}], ['view', {}],
  ['field', {}], ['field', { depth: 2 }], ['field', { depth: 9 }],
  ['key', {}], ['key', { kind: 'pair' }], ['key', { kind: 'pair', parts: ['a', { name: 'b', secret: true }] }], ['key', { kind: 'pair', parts: ['a'] }],
  ['key', { kind: 'token', parts: ['x'] }], ['key', { kind: 'nope' }], ['key', { keystore: '1password' }], ['key', { keystore: 'vault' }],
  ['attachments', {}], ['attachments', { multiple: false, preview: 'cover', size: 'large', fit: 'fill' }], ['attachments', { preview: 'cover' }],
  ['attachments', { size: 'medium', fit: 'trim', preview: 'inline' }], ['attachments', { size: 'huge' }],
  ['avatar', {}], ['avatar', { shape: 'square' }], ['avatar', { shape: 'oval' }],
  ['document', {}], ['document', { kind: 'code' }], ['document', { kind: 'markdown' }], ['document', { kind: 'pdf' }],
  ['lookup', { relationField: 'Company', targetField: 'Size' }], ['lookup', {}],
  ['rollup', { relationField: 'Company', targetField: 'Size', aggregate: 'sum', format: 'percent', separator: ', ' }],
  ['rollup', { relationField: 'Company', aggregate: 'count' }], ['rollup', { relationField: 'Company', aggregate: 'nope' }],
  ['rollup', { relationField: 'Company', targetField: 'Size', aggregate: 'avg', display: 'bar', decimals: 1 }],
  ['formula', {}], ['formula', { expression: '1 + 1' }], ['formula', { expression: 'Size + ', format: 'percent' }],
  ['formula', { expression: '1 + 1', format: 'currency', currency: 'EUR', display: 'sparkline', style: 'column' }],
  ['formula', { expression: 'today()', grain: ['year', 'month'], format: 'iso' }], ['formula', { expression: 'today()', grain: null, time: true }],
  ['formula', { expression: '1 + 1', default: 2 }],
];

export function addScenarios() {
  return ADD_CASES.map(([type, config]) => {
    const { w, deal } = base();
    const r = outcome(() => w.addField(deal.id, { name: 'F', type, config: structuredClone(config) }).config);
    return { type, sent: config, ...(r.error ? r : { config: scrubber(w)(r.ok) }) };
  });
}

export const UPDATE_CASES = [
  ['text', {}, [{ literal: true }, { literal: false }, { width: 180 }, { width: null }, { width: 'wide' }, { description: 'Hi' }, { description: '' }, { default: 'x' }, { default: null }]],
  ['number', { format: 'currency', currency: 'USD' }, [{ decimals: 2 }, { decimals: null }, { display: 'bar', scale: 5 }, { display: null }, { format: 'compact', separator: true }, { color: 'accent' }, { accounting: true }, { format: 'percent' }, { unit: 'kg' }, { default: 4 }]],
  ['rating', {}, [{ max: 10 }, { icon: 'lucide:heart' }, { color: 'accent' }, { color: null }, { default: 4 }, { max: 3 }, { max: 0 }]],
  ['date', {}, [{ time: true }, { clock: '24h' }, { zone: 'fixed', zoneName: 'Europe/Berlin' }, { time: false }, { grain: ['year', 'month'] }, { format: 'iso' }, { grain: null }, { format: null }]],
  ['daterange', {}, [{ time: true }, { elapsed: true }, { pad: true }, { time: false }]],
  ['toggle', {}, [{ on: 'Yes' }, { off: 'yes' }, { off: 'No' }, { default: true }]],
  ['attachments', {}, [{ multiple: false }, { preview: 'cover' }, { size: 'large' }, { fit: 'fill' }, { multiple: true }, { preview: null }, { size: 'medium' }]],
  ['avatar', {}, [{ shape: 'square' }, { shape: '' }, { shape: 'oval' }]],
  ['document', {}, [{ kind: 'code' }, { kind: 'markdown' }, { kind: 'pdf' }]],
  ['select', { options: ['A', 'B'], default: 'a' }, [{ options: ['A', 'C'] }, { options: [{ id: 'c', name: 'C', hue: 'green' }] }, { options: [{ name: 'Z', hue: 'bogus' }] }, { default: 'c' }]],
  ['multiselect', { options: ['A', 'B'], default: ['a', 'b'] }, [{ options: ['B'] }, { options: [] }]],
  ['workflow', {}, [{ states: ['X', 'Y'] }, { states: [] }, { states: [{ name: 'Q', category: 'done', hue: 'red' }] }]],
  ['formula', { expression: '1 + 1' }, [{ expression: '2 * 3' }, { format: 'percent' }, { grain: ['year'] }, { format: 'iso' }, { grain: null }, { expression: 'Nope +' }, { decimals: 1 }]],
  ['rollup', { relationField: 'Company', targetField: 'Size', aggregate: 'sum' }, [{ format: 'currency', currency: 'EUR' }, { decimals: 1 }, { format: null }, { aggregate: 'avg' }, { display: 'ring' }]],
  ['lookup', { relationField: 'Company', targetField: 'Size' }, [{ width: 150 }, { targetField: 'Name' }]],
  ['key', {}, [{ kind: 'token' }, { keystore: '1password' }, { kind: 'pair' }, { parts: ['client', { name: 'secret', secret: true }] }, { kind: 'token' }, { kind: 'nope' }]],
  ['field', {}, [{ depth: 3 }]],
  ['checkbox', {}, [{ default: true }, { default: null }]],
  ['url', {}, [{ default: 'https://a.b' }]],
  ['email', {}, [{ default: 'nope' }]],
];

export function updateScenarios() {
  return UPDATE_CASES.map(([type, start, patches]) => {
    const { w, deal } = base();
    const f = w.addField(deal.id, { name: 'F', type, config: structuredClone(start) });
    const steps = patches.map((config) => {
      const r = outcome(() => w.updateField(deal.id, f.id, { config: structuredClone(config) }));
      return { patch: config, ...(r.error ? { error: r.error } : {}), config: scrubber(w)(structuredClone(w.getField(deal.id, f.id).config)) };
    });
    return { type, start, steps };
  });
}

export const EXTRA_UPDATES = [
  ['relation', [{ subtable: { fields: ['Size'], sort: [{ field: 'Size', dir: 'desc' }] } }, { subtable: null }, { width: 140 }]],
  ['chip', [{ fields: ['Company'] }, { description: 'Short form' }]],
];

export function extraUpdateScenarios() {
  return EXTRA_UPDATES.map(([which, patches]) => {
    const { w, deal } = base();
    const f = which === 'relation' ? w.getField(deal.id, 'Company') : w.viewField(deal, 'chip');
    const steps = patches.map((config) => {
      const r = outcome(() => w.updateField(deal.id, f.id, { config: structuredClone(config) }));
      return { patch: config, ...(r.error ? { error: r.error } : {}), config: scrubber(w)(structuredClone(w.getField(deal.id, f.id).config)) };
    });
    return { which, steps };
  });
}

const SOURCE = {
  text: [{}, ['12', 'Red', 'red, Blue', '', 'a@b.co', '2026-01-02', 'https://x.co', null]],
  formula: [{ expression: 'concat(Name, "!")' }, [null, null]],
  number: [{}, [3.6, 0, null, -2]],
  rating: [{ max: 5 }, [4, 1, null]],
  url: [{}, ['https://x.co', null]],
  email: [{}, ['a@b.co', null]],
  key: [{}, ['MY_KEY', null]],
  date: [{}, ['2026-01-02', null]],
  checkbox: [{}, [true, false, null]],
  toggle: [{ on: 'Yes', off: 'No' }, [true, false, null]],
  select: [{ options: ['A', 'B'], default: 'b' }, ['a', 'b', null]],
  multiselect: [{ options: ['A', 'B'] }, [['a', 'b'], ['b'], []]],
  workflow: [{ states: ['Open', { name: 'Done', category: 'done', default: true }] }, ['open', 'done', null]],
};

const TARGET_CONFIG = {
  formula: { expression: 'concat(Name, "?")', width: 160 },
  rating: { max: 3 },
  select: {},
  multiselect: {},
  workflow: {},
};

export function migrationScenarios() {
  const pairs = [];
  for (const [from, tos] of Object.entries(TYPE_MIGRATIONS)) {
    for (const to of tos) pairs.push([from, to, TARGET_CONFIG[to] ?? {}]);
    pairs.push([from, 'avatar', {}]);
  }
  pairs.push(['text', 'select', { options: [{ name: 'Red', hue: 'red' }, 'Green'] }]);
  pairs.push(['text', 'multiselect', { options: ['Blue'] }]);
  pairs.push(['select', 'workflow', { states: ['Only'] }]);
  pairs.push(['checkbox', 'toggle', { on: 'On it', off: 'Off it' }]);
  pairs.push(['text', 'date', { grain: ['year', 'month'] }]);
  pairs.push(['text', 'formula', {}]);
  pairs.push(['number', 'rating', { max: 200 }]);
  return pairs.map(([from, to, config]) => {
    const { w, deal } = base();
    const [start, values] = SOURCE[from];
    const f = w.addField(deal.id, { name: 'F', type: from, config: structuredClone(start) });
    w.updateField(deal.id, f.id, { config: { width: 220, description: 'Kept' } });
    const rows = values.map((v, i) => w.createEntity(deal.id, { name: `r${i}`, values: v == null ? {} : { F: v } }));
    const r = outcome(() => w.updateField(deal.id, f.id, { type: to, config: structuredClone(config) }));
    const scrub = scrubber(w);
    const now = w.getField(deal.id, f.id);
    return {
      from, to, sent: config,
      ...(r.error ? { error: r.error } : {}),
      type: now.type,
      config: scrub(structuredClone(now.config)),
      values: rows.map((e) => scrub(structuredClone(w.getEntity(e.id).values[f.id] ?? null))),
    };
  });
}

export function nameFieldScenarios() {
  return ['number', 'formula', 'date'].map((to) => {
    const { w, deal } = base();
    const r = outcome(() => w.updateField(deal.id, deal.nameFieldId, { type: to, config: to === 'formula' ? { expression: '"x"' } : {} }));
    return { to, ...(r.error ? { error: r.error } : { type: w.getField(deal.id, deal.nameFieldId).type }) };
  });
}

export function fieldTypeScenarios() {
  return {
    add: addScenarios(),
    update: updateScenarios(),
    extraUpdate: extraUpdateScenarios(),
    migrate: migrationScenarios(),
    nameField: nameFieldScenarios(),
  };
}
