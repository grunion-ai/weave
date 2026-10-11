import { WeaveError } from './store.js';
import { renderBugReport, SYMPTOM_FIELD, MAX_EVENTS, BUG_CATEGORIES } from './bugreport.js';

export const DOCS_WORKSPACE = 'weave';
export const BUG_FORM_NAME = 'Report a bug';
export const FORM_FLOORS = ['Observer', 'Anonymous'];
export const FORM_KINDS = ['Row', 'Bug report'];
export const FORMS_DESCRIPTION = 'Every form in this workspace, as a row: the table it files into, the fields it shows in order with their labels and defaults, the fields the server fills, whether it is on, and who may submit. Submitting a form creates exactly one row in its table, written by the submitter, who needs no write access to that table.';

const COLUMNS = [
  ['Fields', 'text'],
  ['Hidden', 'text'],
  ['Enabled', 'checkbox'],
  ['Floor', 'select', { options: FORM_FLOORS }],
  ['Kind', 'select', { options: FORM_KINDS }],
];

const ROLE_NAMES = { admin: 'architect', writer: 'editor', reader: 'observer' };
const roleOf = (role) => ROLE_NAMES[role] ?? role;
const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const isDocsWorkspace = (w) => w?.state?.meta?.name === DOCS_WORKSPACE;

export function refuseOnDocs(w, verb) {
  if (isDocsWorkspace(w)) throw new WeaveError(`The weave docs workspace is built in: it cannot be ${verb}`, 'forbidden');
}

export function leaveWorkspace(w, accountRef) {
  refuseOnDocs(w, 'left');
  const accounts = w.listAccounts();
  const me = accounts.find((a) => a.id === accountRef) ?? accounts.find((a) => a.name === accountRef);
  if (!me) throw new WeaveError(`Account '${accountRef}' not found`, 'not-found');
  const architects = accounts.filter((a) => roleOf(a.role) === 'architect');
  if (roleOf(me.role) === 'architect' && architects.length === 1) {
    throw new WeaveError(`${me.name} is the last architect of ${w.state.meta.name}: make someone else an architect before leaving`, 'invalid');
  }
  w.deleteAccount(me.id);
  return { id: me.id, left: true, workspace: w.state.meta.name };
}

export function ensureFormColumns(w, formsT, tablesT) {
  const has = (name) => Object.values(formsT.fields).some((f) => f.name === name);
  if (!has('Table')) {
    const { field, inverse } = w.addRelation(formsT.id, { name: 'Table', targetDb: tablesT.id, cardinality: 'many-to-one', inverseName: 'Forms' });
    field.system = true;
    inverse.system = true;
  }
  for (const [name, type, config] of COLUMNS) {
    if (!has(name)) w.addField(formsT.id, { name, type, ...(config ? { config } : {}) }).system = true;
  }
}

export function adoptForms(member, root) {
  const local = Object.values(member.state.tables).find((t) => t.system === 'forms');
  const target = sysTable(root, 'forms');
  const rootTables = sysTable(root, 'tables');
  if (!local || !target || !rootTables || local === target) return 0;
  const col = (n) => Object.values(local.fields).find((f) => f.name === n);
  const optionName = (n, v) => (col(n)?.config?.options ?? []).find((o) => o.id === v || o.name === v)?.name ?? null;
  let moved = 0;
  for (const row of Object.values(member.state.entities)) {
    if (row.dbId !== local.id || row.deletedAt) continue;
    const raw = (n) => row.values[col(n)?.id];
    const sysId = member.state.entities[[].concat(raw('Table') ?? [])[0]]?.sysId;
    const tablesRow = sysId && root.listEntities(rootTables.id).find((e) => e.sysId === sysId);
    if (!tablesRow) continue;
    root.createEntity(target.id, {
      name: member.entityName(row),
      values: { Description: raw('Description') ?? '', Table: tablesRow.id, Fields: raw('Fields') ?? '[]', Hidden: raw('Hidden') ?? '{}', Enabled: raw('Enabled') === true, Floor: optionName('Floor', raw('Floor')), Kind: optionName('Kind', raw('Kind')) },
    });
    member.deleteEntity(row.id, { hard: true });
    moved += 1;
  }
  return moved;
}

const registryOf = (w) => w.registryHost ?? w;
const sysTable = (reg, kind) => Object.values(reg.state.tables).find((t) => t.system === kind && !t.deletedAt) ?? null;

function formsTable(w) {
  const t = sysTable(registryOf(w), 'forms');
  if (!t) throw new WeaveError('This workspace has no Workspace/Forms registry here: forms live at the hub root', 'not-found');
  return t;
}

function parseJson(text, fallback, what, form) {
  if (text == null || String(text).trim() === '') return fallback;
  try { return JSON.parse(text); } catch {
    throw new WeaveError(`The form '${form}' has unreadable ${what}: it must be JSON`, 'invalid');
  }
}

function ownerOfTable(reg, tableId) {
  return [reg, ...(reg.members ?? [])].find((e) => hasOwn(e.state.tables, tableId)) ?? null;
}

function optionNames(field) {
  if (field.type === 'workflow') return (field.config?.states ?? []).map((s) => s.name);
  return (field.config?.options ?? []).map((o) => (isMap(o) ? o.name : o));
}

function toForm(reg, row) {
  const read = reg.readEntity(row.id);
  const f = read.fields;
  const name = read.name;
  const kind = FORM_KINDS.includes(f.Kind) ? f.Kind : 'Row';
  const rel = [].concat(f.Table ?? [])[0];
  const tablesRow = rel ? reg.state.entities[rel.id ?? rel] : null;
  const tableId = tablesRow && !tablesRow.deletedAt ? tablesRow.sysId : null;
  const owner = tableId ? ownerOfTable(reg, tableId) : null;
  const table = owner?.state.tables[tableId];
  if (!table || table.deletedAt) throw new WeaveError(`The form '${name}' files into a table that is gone`, 'not-found');
  const shown = parseJson(f.Fields, [], 'Fields', name);
  const hiddenMap = parseJson(f.Hidden, {}, 'Hidden', name);
  if (!Array.isArray(shown) || !isMap(hiddenMap)) throw new WeaveError(`The form '${name}' needs Fields as a JSON list and Hidden as a JSON object`, 'invalid');
  const fields = shown.map((entry) => {
    const ref = typeof entry === 'string' ? entry : entry?.field;
    const field = ref == null ? null : owner.findField(table, String(ref));
    if (!field && kind === 'Row') throw new WeaveError(`The form '${name}' shows '${ref}', which ${owner.qualifiedName(table)} does not have`, 'invalid');
    const out = { field: field?.name ?? String(ref), label: String(entry?.label ?? field?.name ?? ref), type: field?.type ?? 'text' };
    if (entry?.input) out.input = String(entry.input);
    if (entry?.default !== undefined) out.default = entry.default;
    if (field && ['select', 'multiselect', 'workflow'].includes(field.type)) out.options = optionNames(field);
    return out;
  });
  const form = {
    id: row.id,
    publicId: row.publicId,
    name,
    description: String(f.Description ?? ''),
    kind,
    floor: FORM_FLOORS.includes(f.Floor) ? f.Floor : 'Observer',
    enabled: f.Enabled === true,
    workspace: owner.state.meta.name,
    table: owner.qualifiedName(table),
    fields,
    hidden: Object.keys(hiddenMap),
  };
  Object.defineProperty(form, 'owner', { value: owner, enumerable: false });
  Object.defineProperty(form, 'tableId', { value: table.id, enumerable: false });
  Object.defineProperty(form, 'hiddenMap', { value: hiddenMap, enumerable: false });
  return form;
}

function formRow(w, ref) {
  const reg = registryOf(w);
  const t = formsTable(w);
  const direct = hasOwn(reg.state.entities, ref) ? reg.state.entities[ref] : null;
  const row = direct?.dbId === t.id ? direct : (direct ? null : reg.findEntity(t.id, ref));
  if (!row || row.deletedAt) throw new WeaveError(`Form '${ref}' not found`, 'not-found');
  return row;
}

export function getForm(w, ref) {
  return toForm(registryOf(w), formRow(w, ref));
}

export function listForms(w) {
  const reg = registryOf(w);
  const t = sysTable(reg, 'forms');
  if (!t) return [];
  const out = [];
  for (const row of reg.listEntities(t.id)) {
    try {
      const form = toForm(reg, row);
      if (form.owner === w) out.push(form);
    } catch {}
  }
  return out;
}

export function createForm(w, { name, description = '', table, fields = [], hidden = {}, enabled = true, floor = 'Observer', kind = 'Row' } = {}) {
  if (!name) throw new WeaveError('A form needs a name', 'invalid');
  const reg = registryOf(w);
  const formsT = formsTable(w);
  const db = w.getTable(table);
  const tablesT = sysTable(reg, 'tables');
  const tablesRow = tablesT && reg.listEntities(tablesT.id).find((e) => e.sysId === db.id);
  if (!tablesRow) throw new WeaveError(`${w.qualifiedName(db)} has no Workspace/Tables row to point a form at`, 'not-found');
  const row = reg.createEntity(formsT.id, {
    name,
    values: { Description: description, Table: tablesRow.id, Fields: JSON.stringify(fields), Hidden: JSON.stringify(hidden), Enabled: !!enabled, Floor: floor, Kind: kind },
  });
  return getForm(w, row.id);
}

export function ensureBugForm(docs) {
  const have = listForms(docs).find((f) => f.kind === 'Bug report');
  if (have) return have;
  return createForm(docs, {
    name: BUG_FORM_NAME,
    description: 'Say what went wrong. The report files into Development/Issue with the server\'s own version stamp.',
    table: 'Development/Issue',
    kind: 'Bug report',
    fields: [
      { field: SYMPTOM_FIELD, label: 'What went wrong', input: 'categories' },
      { field: 'Description', label: 'What happened', input: 'note' },
    ],
    hidden: { Name: '$title', Severity: '$severity' },
  });
}

export function formAdmits(form, { role = null, anonymous = false } = {}) {
  if (!form.owner.state.meta.requireAuth) return true;
  if (role != null) return true;
  return form.floor === 'Anonymous' && !!anonymous;
}

function pickValues(form, given) {
  const hidden = new Map(form.hidden.map((n) => [n.toLowerCase(), n]));
  const shown = new Map();
  for (const f of form.fields) {
    shown.set(f.field.toLowerCase(), f);
    shown.set(f.label.toLowerCase(), f);
  }
  const picked = {};
  for (const [key, value] of Object.entries(given)) {
    const k = String(key).trim().toLowerCase();
    if (hidden.has(k)) throw new WeaveError(`'${hidden.get(k)}' is filled by the server; the form '${form.name}' cannot set it`, 'forbidden');
    const f = form.kind === 'Row' ? shown.get(k) : null;
    if (!f) throw new WeaveError(`'${key}' is not on the form '${form.name}' (it shows ${form.fields.map((x) => x.label).join(', ') || 'nothing'})`, 'invalid');
    picked[f.field] = value;
  }
  return picked;
}

function bugRow(form, input, server) {
  const events = input.events ?? [];
  if (!Array.isArray(events) || events.length > MAX_EVENTS) throw new WeaveError(`events must be an array of at most ${MAX_EVENTS} entries`, 'invalid');
  let report;
  try {
    report = renderBugReport({
      categories: input.categories ?? [],
      note: input.note,
      events,
      client: isMap(input.client) ? input.client : {},
      server: { version: server.version ?? 'unknown', startedAt: server.startedAt ?? null, uptime: server.uptime ?? 0, workspace: server.workspace ?? form.workspace },
    });
  } catch (err) {
    throw new WeaveError(err.message, 'invalid');
  }
  const owner = form.owner;
  const table = owner.state.tables[form.tableId];
  const values = { Severity: report.severity };
  const field = owner.findField(table, SYMPTOM_FIELD);
  const declared = new Set((field?.config?.options ?? []).map((o) => o?.name ?? o));
  const symptoms = report.symptoms.filter((s) => declared.has(s));
  if (symptoms.length) values[SYMPTOM_FIELD] = symptoms;
  const described = owner.descriptionField(table);
  return {
    input: { name: report.title, values, ...(described ? { docs: { [described.name]: report.markdown } } : {}) },
    extra: { severity: report.severity, symptoms },
  };
}

function plainRow(form, picked, actor, server) {
  const owner = form.owner;
  const table = owner.state.tables[form.tableId];
  const now = new Date().toISOString();
  const tokens = { $actor: actor, $now: now, $version: server.version ?? null, $workspace: server.workspace ?? form.workspace, $form: form.name };
  const wanted = {};
  for (const f of form.fields) {
    if (hasOwn(picked, f.field)) wanted[f.field] = picked[f.field];
    else if (f.default !== undefined) wanted[f.field] = f.default;
  }
  for (const [n, token] of Object.entries(form.hiddenMap)) {
    wanted[n] = typeof token === 'string' && token.startsWith('$') ? (tokens[token] ?? null) : token;
  }
  let name;
  const values = {};
  const docs = {};
  for (const [n, v] of Object.entries(wanted)) {
    if (v == null || v === '') continue;
    const field = owner.findField(table, n);
    if (!field) continue;
    if (field.id === table.nameFieldId) name = String(v);
    else if (field.type === 'document') docs[field.name] = String(v);
    else values[field.name] = v;
  }
  return { input: { ...(name != null ? { name } : {}), values, ...(Object.keys(docs).length ? { docs } : {}) }, extra: {} };
}

export function submitForm(w, ref, input = {}, { actor = null, server = {} } = {}) {
  const form = getForm(w, ref);
  if (!form.enabled) throw new WeaveError(`The form '${form.name}' is turned off`, 'forbidden');
  const body = isMap(input) ? input : {};
  const picked = pickValues(form, isMap(body.values) ? body.values : {});
  const owner = form.owner;
  const who = actor ?? owner.actor;
  const { input: row, extra } = form.kind === 'Bug report' ? bugRow(form, body, server) : plainRow(form, picked, who, server);
  const was = owner.actor;
  owner.actor = who;
  let e;
  try { e = owner.createEntity(form.tableId, row); } finally { owner.actor = was; }
  const ws = owner.state.meta.name;
  return { id: e.id, publicId: e.publicId, form: form.id, workspace: ws, table: form.table, ...extra, url: `/w/${ws}/#/entity/${e.id}` };
}

function control(f) {
  const id = `f-${esc(f.field).replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const data = `data-field="${esc(f.field)}" data-type="${esc(f.type)}"`;
  const label = `<label class="form-label" for="${id}">${esc(f.label)}</label>`;
  const dflt = f.default;
  if (f.type === 'select' || f.type === 'workflow') {
    const opts = ['<option value=""></option>', ...(f.options ?? []).map((o) => `<option${o === dflt ? ' selected' : ''}>${esc(o)}</option>`)].join('');
    return `${label}<select class="form-select" id="${id}" ${data}>${opts}</select>`;
  }
  if (f.type === 'multiselect') {
    const picked = new Set([].concat(dflt ?? []));
    const items = (f.options ?? []).map((o) => `<label class="form-selectgroup-item"><input type="checkbox" class="form-selectgroup-input" value="${esc(o)}"${picked.has(o) ? ' checked' : ''}><span class="form-selectgroup-label">${esc(o)}</span></label>`).join('');
    return `<div class="form-label" id="${id}">${esc(f.label)}</div><div class="form-selectgroup" role="group" aria-labelledby="${id}" ${data}>${items}</div>`;
  }
  if (f.type === 'checkbox' || f.type === 'toggle') {
    return `<label class="form-check"><input class="form-check-input" type="checkbox" id="${id}" ${data}${dflt === true ? ' checked' : ''}><span class="form-check-label">${esc(f.label)}</span></label>`;
  }
  if (f.type === 'document') return `${label}<textarea class="form-control" rows="5" id="${id}" ${data}>${esc(dflt ?? '')}</textarea>`;
  const type = { number: 'number', rating: 'number', date: 'date', email: 'email', url: 'url' }[f.type] ?? 'text';
  return `${label}<input class="form-control" type="${type}" id="${id}" ${data} value="${esc(dflt ?? '')}">`;
}

function bugControls(form) {
  const label = (input, fallback) => form.fields.find((f) => f.input === input)?.label ?? fallback;
  const symptoms = BUG_CATEGORIES.map((c) => `<label class="form-selectgroup-item" title="${esc(c.hint)}"><input type="checkbox" name="categories" class="form-selectgroup-input" value="${esc(c.id)}"><span class="form-selectgroup-label">${esc(c.label)}</span></label>`).join('');
  return [
    `<div class="mb-3"><label class="form-label" for="f-note">${esc(label('note', 'What happened'))}</label><textarea class="form-control" rows="5" id="f-note" name="note" autofocus></textarea></div>`,
    `<div class="mb-3"><div class="form-label" id="f-symptoms">${esc(label('categories', 'What went wrong'))}</div><div class="form-selectgroup" role="group" aria-labelledby="f-symptoms">${symptoms}</div></div>`,
  ].join('');
}

export function renderFormPage(form, { mount = '' } = {}) {
  const bug = form.kind === 'Bug report';
  const body = bug ? bugControls(form) : form.fields.map((f) => `<div class="mb-3">${control(f)}</div>`).join('');
  return `<!doctype html>
<html lang="en" data-bs-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(form.name)} · weave</title>
<link rel="stylesheet" href="/vendor/tabler.min.css">
<link rel="icon" type="image/svg+xml" href="/brand/weave-favicon.svg">
${bug ? '<script src="/bug-core.js"></script>\n' : ''}<script src="/form.js"></script>
</head>
<body class="d-flex flex-column">
<main class="page page-center">
<div class="container container-tight py-4">
<form class="card card-md" id="wv-form" data-submit="${esc(`${mount}/api/forms/${form.id}/submit`)}" data-kind="${bug ? 'bug' : 'row'}" novalidate>
<div class="card-body">
<h1 class="card-title h2 mb-2">${esc(form.name)}</h1>
${form.description ? `<p class="text-secondary mb-4">${esc(form.description)}</p>` : ''}${form.enabled ? '' : '<div class="alert alert-warning" role="alert">This form is turned off.</div>'}
${body}
<div class="alert alert-danger d-none" role="alert" id="wv-form-error"></div>
<div class="form-footer"><button class="btn btn-primary w-100" type="submit"${form.enabled ? '' : ' disabled'}>Send</button></div>
<p class="text-secondary small mt-3 mb-0" role="status" aria-live="polite" id="wv-form-receipt">Files one row into ${esc(form.table)}.</p>
</div>
</form>
</div>
</main>
</body>
</html>`;
}
