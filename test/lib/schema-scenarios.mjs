import { Weave } from '../../src/engine.js';

export function everyTypeWorkspace() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const company = w.createTable({ space: 'Ops', name: 'Company' });
  w.addField(company.id, { name: 'Size', type: 'number', config: { display: 'bar', scale: 50, color: 'accent' } });
  w.addField(company.id, { name: 'Score', type: 'rating', config: { max: 10, icon: 'lucide:heart', color: 'accent' } });
  const deal = w.createTable({ space: 'Ops', name: 'Deal' });
  const add = (name, type, config = {}) => w.addField(deal.id, { name, type, config });
  add('Note', 'text', { literal: true, width: 220, description: 'Free text' });
  add('Amount', 'number', { format: 'currency', currency: 'EUR', decimals: 2, accounting: true, display: 'ring', scale: 1000 });
  add('Plain', 'number', { default: 3 });
  add('Stars', 'rating', {});
  add('Hearts', 'rating', { max: 7, icon: 'lucide:heart', color: 'icon', default: 2 });
  add('Due', 'date', { time: true, clock: '24h', zone: 'fixed', zoneName: 'Europe/Berlin', format: 'iso', pad: true });
  add('Month', 'date', { grain: ['year', 'month'] });
  add('Window', 'daterange', { time: true, elapsed: true });
  add('Done', 'checkbox', { default: true });
  add('Live', 'toggle', { on: 'Live', off: 'Draft', default: false });
  add('Plain toggle', 'toggle', {});
  add('Site', 'url', {});
  add('Mail', 'email', {});
  add('Stage', 'select', { options: ['Lead', { name: 'Won', hue: 'green', icon: 'lucide:star' }, { name: 'Lost', color: '#e5484d' }], default: 'lead' });
  add('Tags', 'multiselect', { options: ['A', { name: 'B', hue: 'blue' }], default: ['a'] });
  add('Flow', 'workflow', { states: [{ name: 'Open', category: 'not-started', default: true, icon: 'lucide:circle-arrow-up' }, { name: 'Shut', category: 'done', hue: 'green' }] });
  w.addRelation(deal.id, { name: 'Company', targetDb: company.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  add('Shape', 'field', { depth: 2 });
  add('Token', 'key', { kind: 'pair', keystore: '1password', parts: ['user', { name: 'pass', secret: true }] });
  add('Plain key', 'key', {});
  add('Files', 'attachments', { multiple: false, preview: 'cover', size: 'large', fit: 'fill' });
  add('Face', 'avatar', { shape: 'square' });
  add('Body', 'document', { kind: 'code' });
  add('Sizes', 'lookup', { relationField: 'Company', targetField: 'Size' });
  add('Score seen', 'lookup', { relationField: 'Company', targetField: 'Score' });
  add('Size sum', 'rollup', { relationField: 'Company', targetField: 'Size', aggregate: 'sum', format: 'percent', decimals: 1 });
  add('Score avg', 'rollup', { relationField: 'Company', targetField: 'Score', aggregate: 'avg' });
  add('Size bar', 'rollup', { relationField: 'Company', targetField: 'Size', aggregate: 'max' });
  add('Count', 'rollup', { relationField: 'Company', aggregate: 'count', separator: ' / ' });
  add('Double', 'formula', { expression: 'Plain * 2', format: 'currency', currency: 'USD', display: 'bar', color: 'accent' });
  add('Trend', 'formula', { expression: 'Sizes', display: 'sparkline', style: 'column' });
  add('When', 'formula', { expression: 'today()', grain: ['year', 'month', 'day'], format: 'long' });
  w.updateField(deal.id, w.viewField(deal, 'chip').id, { config: { fields: ['Stage', 'Amount'], link: false } });
  w.updateField(deal.id, w.viewField(deal, 'card').id, { name: 'Summary', config: { description: 'small', state: false } });
  w.updateField(deal.id, deal.descriptionFieldId, { name: 'About', config: { kind: 'html', width: 300 } });
  const label = w.createTable({ space: 'Ops', name: 'Label' });
  w.addField(label.id, { name: 'Code', type: 'text' });
  w.updateField(label.id, label.nameFieldId, { type: 'formula', config: { expression: 'concat(Code, "!")' } });
  w.updateField(label.id, label.nameFieldId, { name: 'Title' });
  return w;
}

function scrubber(w) {
  const names = new Map();
  for (const sp of Object.values(w.state.spaces)) names.set(sp.id, `<space ${sp.name}>`);
  for (const t of Object.values(w.state.tables)) {
    names.set(t.id, `<table ${t.name}>`);
    for (const f of Object.values(t.fields)) names.set(f.id, `<field ${t.name}.${f.name}>`);
    for (const v of t.tableViews ?? []) names.set(v.id, `<view ${t.name}.${v.name}>`);
  }
  const ids = [...names.keys()].sort((a, b) => b.length - a.length);
  const walk = (v) => {
    if (typeof v === 'string') {
      if (names.has(v)) return names.get(v);
      let out = v;
      for (const id of ids) if (out.includes(id)) out = out.split(id).join(names.get(id));
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk;
}

export const ops = (w) => scrubber(w)(w.describeSchema().find((sp) => sp.space === 'Ops'));

const outcome = (fn) => {
  try { return { ok: fn() }; } catch (err) { return { error: `${err.code ?? 'error'}: ${err.message}` }; }
};

export function roundTrip() {
  const w = everyTypeWorkspace();
  const fresh = new Weave();
  const plan = fresh.applySchema(w.describeSchema());
  return { plan: plan.map((p) => `${p.action} ${p.subject}`), described: ops(w), applied: ops(fresh), again: fresh.applySchema(fresh.describeSchema()), self: w.applySchema(w.describeSchema()) };
}

const deal = (doc) => doc.find((sp) => sp.space === 'Ops').tables.find((t) => t.name === 'Deal');
const fieldOf = (doc, name) => deal(doc).fields.find((f) => f.name === name);

export const EDITS = [
  ['Note', { literal: false }], ['Note', { width: 260, description: 'Other' }],
  ['Amount', { decimals: 0, currency: 'GBP' }], ['Amount', { display: 'text' }], ['Amount', { color: 'ink' }],
  ['Stars', { max: 3 }], ['Stars', { color: 'accent', icon: 'lucide:star' }], ['Hearts', { color: 'ink' }],
  ['Due', { clock: '12h' }], ['Due', { format: 'us' }], ['Month', { grain: ['year'] }], ['Window', { pad: true }],
  ['Live', { on: 'Up', off: 'Down' }], ['Plain toggle', { on: 'On' }],
  ['Stage', { options: ['Lead', 'Won', 'Lost', 'New'] }], ['Stage', { optionsFull: [{ name: 'Lead', color: '#2ea043' }] }],
  ['Stage', { optionsFull: [{ name: 'Won', icon: 'lucide:heart' }] }], ['Stage', { options: ['Won'], optionsFull: [{ name: 'Won', color: 'nope' }] }],
  ['Tags', { options: ['B'] }],
  ['Flow', { states: [{ name: 'Open', category: 'in-progress' }, { name: 'Shut', category: 'done', default: true }] }],
  ['Shape', { depth: 3 }], ['Token', { kind: 'token' }],
  ['Files', { multiple: true, preview: 'link' }], ['Files', { size: 'small' }],
  ['Face', { shape: 'round' }], ['Body', { kind: 'markdown' }],
  ['Size sum', { aggregate: 'avg' }], ['Size sum', { format: 'currency', currency: 'EUR' }], ['Count', { separator: ', ' }],
  ['Double', { expression: 'Plain * 3' }], ['Double', { display: 'text' }], ['When', { format: 'iso' }],
  ['Chip', { fields: ['Stage'], link: true }], ['Summary', { description: 'large' }], ['Summary', { role: 'chip' }],
  ['About', { kind: 'markdown' }], ['Plain', { default: 9 }], ['Done', { default: false }],
];

export function edits() {
  return EDITS.map(([name, change]) => {
    const w = everyTypeWorkspace();
    const doc = w.describeSchema();
    const was = structuredClone(fieldOf(doc, name));
    Object.assign(fieldOf(doc, name), structuredClone(change));
    const r = outcome(() => w.applySchema(doc).map((p) => `${p.action} ${p.subject}`));
    const now = fieldOf(w.describeSchema(), name);
    const scrub = scrubber(w);
    return { name, change, ...(r.error ? { error: r.error } : { plan: r.ok }), before: scrub(was), after: scrub(now) };
  });
}

export function schemaScenarios() {
  return { roundTrip: roundTrip(), edits: edits() };
}
