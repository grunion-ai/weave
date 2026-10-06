import { FIELD_TYPE_VOCABULARY } from './vocabulary.js';

const NUMBER_PATHS = {
  format: { when: '"currency" for money, "percent" for a 0..1 share, "compact" for 1.2M', opens: { currency: ['currency', 'accounting'], '*': ['decimals', 'separator'] } },
  unit: { when: 'a word after the figure: "days"' },
  display: { when: '"bar", "ring" or "heat" graphic', opens: { '*': ['scale', 'color'] } },
};
const DATE_PATHS = {
  grain: { when: 'parts stored, a list: ["year","month"] for a month', opens: { '*': ['format'] } },
  time: { when: 'true adds a time of day', opens: { '*': ['clock', 'zone'] } },
};
export const FIELD_PATHS = {
  number: NUMBER_PATHS,
  formula: { ...NUMBER_PATHS, display: { when: '"bar", "ring" or "heat" graphic; "sparkline" for a list', opens: { sparkline: ['style', 'color'], '*': ['scale', 'color'] } } },
  date: DATE_PATHS,
  daterange: { ...DATE_PATHS, time: { when: 'true adds a time of day', opens: { '*': ['clock', 'zone', 'elapsed'] } } },
  rating: { max: { when: 'icons, 1-100 (default 5)' }, icon: { when: 'lucide:<name> (default star)' }, color: { when: '"ink", "icon" or "accent"' } },
  toggle: { on: { when: 'label when true (default On)' }, off: { when: 'label when false (default Off)' } },
  select: { options: { when: '[{name, hue, icon}], a hue only where it means something' } },
  multiselect: { options: { when: '[{name, hue, icon}], a hue only where it means something' } },
  workflow: { states: { when: '[{name, category, default, icon}]' } },
};
const WHEN = {
  currency: 'ISO code: "USD"',
  accounting: 'true puts negatives in parentheses',
  decimals: 'places shown',
  separator: 'true groups thousands',
  scale: '"column" (default) or the number that is 100%',
  color: '"ink", "icon" or "accent"',
  style: '"line", "column" or "winloss"',
  format: 'iso, us, eu, long, short, month, quarter, ordinal or relative',
  clock: '"24h" or "12h"',
  zone: '"floating" (default), "fixed" (with zoneName) or "instant"',
  elapsed: 'true shows the span',
};

const unset = (v) => v == null || v === '' || v === 'number' || v === 'text' || v === false;

export function nextFor(type, config = {}) {
  const tree = FIELD_PATHS[type];
  if (!tree) return [];
  const out = [];
  for (const [key, node] of Object.entries(tree)) {
    const v = config[key];
    if (unset(v)) { out.push(`${key}: ${node.when}`); continue; }
    const opened = [...(node.opens?.[v] ?? []), ...(node.opens?.['*'] ?? [])];
    for (const child of new Set(opened)) if (unset(config[child])) out.push(`${child}: ${WHEN[child]}`);
  }
  return out;
}

const singular = (s) => String(s ?? '').trim().toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MONEY = /\b(amount|price|cost|balance|total|budget|spend|spent|income|expense|salary|fee|revenue|payment|paid|owed)\b/i;
const FIGURE = /\b(count|qty|quantity|hours|minutes|days|percent|rate)\b/i;
const STATUS = /\b(status|state|stage|priority|phase)\b/i;
const EVERY = ['width', 'description', 'default'];

export function fieldHints(field, { sent = {}, tables = [] } = {}) {
  const { type, name, config = {} } = field;
  const hints = [];
  const takes = new Set([...(FIELD_TYPE_VOCABULARY.find((v) => v.type === type)?.config ?? []), ...EVERY]);
  const dropped = Object.keys(sent ?? {}).filter((k) => !(k in config) && !takes.has(k));
  if (dropped.length) hints.push(`Ignored ${dropped.join(', ')}: ${type} takes ${[...takes].join(', ')}.`);
  if (type === 'text') {
    const table = tables.find((t) => singular(t) === singular(name));
    if (table) hints.push(`'${name}' names the ${table} table, so it is a relation: weave_update_field {type:"relation", config:{targetDb:"${table}"}} links each value to the ${table} row of that name.`);
    else if (MONEY.test(name) || FIGURE.test(name)) hints.push(`'${name}' holds figures: weave_update_field {type:"number"${MONEY.test(name) ? ', config:{format:"currency", currency:"USD"}' : ''}} so it sums and aligns.`);
  }
  if (type === 'number' && MONEY.test(name) && config.format !== 'currency') {
    hints.push(`'${name}' is money? format:"currency", currency:"USD".`);
  }
  const options = type === 'select' || type === 'multiselect' ? config.options ?? [] : [];
  if (options.length > 1 && options.every((o) => !o.hue || o.hue === 'slate')) {
    hints.push('All options slate: give a hue where it means something (green income, red overdue).');
  }
  const marks = type === 'workflow' ? config.states ?? [] : STATUS.test(name) ? options : [];
  if (marks.length && marks.every((o) => !o.icon)) {
    hints.push(`Give each ${type === 'workflow' ? 'state' : 'option'} an icon: "lucide:<name>".`);
  }
  return hints;
}

export function containerHints(kind, made, { workspace = '' } = {}) {
  const hints = [];
  if (workspace && slug(made.name) === slug(workspace)) {
    hints.push(`'${made.name}' repeats the workspace name: name the workspace for the domain (personal-finance) and make the request a space in it.`);
  }
  if (!made.icon) hints.push('No icon: icon:"lucide:<name>".');
  return hints;
}

export function guided(weave, kind, result, sent = {}) {
  const add = ({ next = [], hints = [] }) => ({ ...result, ...(next.length ? { next } : {}), ...(hints.length ? { hints } : {}) });
  if (kind === 'field') return add({ next: nextFor(result.type, result.config), hints: fieldHints(result, { sent, tables: weave.userTables().map((t) => t.name) }) });
  return add({ hints: containerHints(kind, result, { workspace: weave.getWorkspace().name }) });
}
