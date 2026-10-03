/* What a schema write tells the agent that made it (Issues #578, #579, #581,
   #582). A stock agent with no weave skills read none of the Handbook: it
   stored an account as text, an amount with no currency, eight grey options,
   and named the workspace after the task. The 2026-10-02 disclosure eval
   found the fixes that reach a model which never asks are the ones pushed on
   the reply to the write it just made, so add-field, update-field,
   create-table and create-space answer with two lists:

   - next[]: the settings the field's type takes that are still unset, one
     line each with when to use it, and the settings the choices already made
     opened (a currency format opens the code and accounting; a display opens
     the scale and the colour). Never the whole tree: one layer at a time.
   - hints[]: a likely modelling slip in the write, one sentence each with
     its fix: a text column named like a table, a money-named number with no
     currency, options all slate, status options with no icons, a key the
     type does not take, a space named after its workspace.

   Hints never block a write and never change what is stored. Pure: the
   caller passes the field and what it knows about the workspace. */
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
/* The first layer of each type, and the keys a choice opens. Each key's
   line is in WHEN. test/field-hints.test.mjs holds every key to the type's
   config list in src/vocabulary.js, so the tree cannot offer a key the
   engine drops. */
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

/* The settings still open on a field of this type, as one line each. */
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
// Keys every field takes beside its type's own list, as weave_build counts them.
const EVERY = ['width', 'description', 'default'];

/* sent: the config the caller wrote, to name the keys the type dropped.
   tables: names of the workspace's own tables, to catch a text column that
   names one. */
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

/* A space or a table, as it was just made. */
export function containerHints(kind, made, { workspace = '' } = {}) {
  const hints = [];
  if (workspace && slug(made.name) === slug(workspace)) {
    hints.push(`'${made.name}' repeats the workspace name: name the workspace for the domain (personal-finance) and make the request a space in it.`);
  }
  if (!made.icon) hints.push('No icon: icon:"lucide:<name>".');
  return hints;
}

/* The reply a door sends (MCP, REST, CLI): the result plus whichever lists
   are not empty. kind is field, table or space; sent is the config the
   caller wrote. */
export function guided(weave, kind, result, sent = {}) {
  const add = ({ next = [], hints = [] }) => ({ ...result, ...(next.length ? { next } : {}), ...(hints.length ? { hints } : {}) });
  if (kind === 'field') return add({ next: nextFor(result.type, result.config), hints: fieldHints(result, { sent, tables: weave.userTables().map((t) => t.name) }) });
  return add({ hints: containerHints(kind, result, { workspace: weave.getWorkspace().name }) });
}
