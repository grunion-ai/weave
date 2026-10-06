import { isDeepStrictEqual } from 'node:util';

const COMPUTED = new Set(['lookup', 'rollup', 'formula']);
const SAMPLE_DATE = '2026-10-05';
const DOC_TEXT = 'Written by the template exercise.';

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const show = (v) => (v === undefined ? 'nothing' : JSON.stringify(v));
const ids = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => (x && typeof x === 'object' ? x.id : x));

export function sampleValue(field, name) {
  switch (field.type) {
    case 'text': return field.role === 'name' ? name : `${field.name} sample`;
    case 'url': return 'https://example.com/template-exercise';
    case 'email': return 'template-exercise@example.com';
    case 'number':
      if (field.format === 'percent') return 0.25;
      if (field.format === 'currency') return 1234.5;
      return 42;
    case 'rating': return Math.min(3, field.max ?? 5);
    case 'date': return SAMPLE_DATE;
    case 'daterange': return { start: '2026-10-01', end: SAMPLE_DATE };
    case 'checkbox':
    case 'toggle': return true;
    case 'select': return field.options?.length ? field.options[Math.min(1, field.options.length - 1)] : undefined;
    case 'multiselect': return field.options?.length ? field.options.slice(0, 2) : undefined;
    case 'workflow': {
      const states = field.states ?? [];
      return (states.find((s) => !s.default) ?? states[0])?.name;
    }
    case 'document': return DOC_TEXT;
    default: return undefined;
  }
}

function dateAt(field, iso) {
  const grain = field.grain ?? [];
  if (grain.includes('hour') || grain.includes('minute')) return null;
  if (grain.length && !grain.includes('day')) return iso.slice(0, grain.includes('month') ? 7 : 4);
  return iso;
}

function readBack(field, want, row) {
  const raw = row.raw?.[field.name];
  switch (field.type) {
    case 'select':
    case 'workflow':
    case 'multiselect':
      return [row.fields?.[field.name], want];
    case 'date': {
      const cut = dateAt(field, want);
      return cut == null ? [String(raw ?? '').slice(0, 10), want] : [raw, cut];
    }
    case 'daterange': return [raw && { start: raw.start, end: raw.end }, want];
    case 'document': return [row.docs?.[field.name] ?? raw, want];
    default: return [raw, want];
  }
}

export function sampleRow(table, name) {
  const values = {};
  const written = [];
  const skipped = [];
  for (const f of table.fields ?? []) {
    if (f.type === 'relation' || f.type === 'view' || COMPUTED.has(f.type)) continue;
    const v = sampleValue(f, name);
    if (v === undefined) { skipped.push({ field: f.name, type: f.type }); continue; }
    values[f.name] = v;
    written.push(f);
  }
  return { values, written, skipped };
}

function expectComputed(field, rel, farValue) {
  if (field.type === 'lookup') return { want: rel.many ? [farValue] : farValue };
  if (field.type !== 'rollup') return null;
  switch (field.aggregate) {
    case 'count': return { want: 1 };
    case 'filled': return { want: isEmpty(farValue) ? 0 : 1 };
    case 'empty': return { want: isEmpty(farValue) ? 1 : 0 };
    case 'distinct': return { want: isEmpty(farValue) ? 0 : 1 };
    case 'sum': case 'avg': case 'min': case 'max': case 'median':
      return { want: farValue };
    default: return null;
  }
}

export async function exerciseTable(api, table, { label = 'template', tag = 'exercise', schema = null } = {}) {
  const spaces = schema ?? await api.schema();
  const tables = spaces.flatMap((sp) => sp.tables ?? []);
  const tableOf = (q) => tables.find((t) => t.qualified === q || t.id === q) ?? null;
  const refOf = (t) => t.id ?? t.qualified;
  const report = { template: label, table: table.name, fields: 0, relations: 0, computed: 0, ok: false, failures: [], skipped: [], notes: [] };
  const fail = (field, what) => report.failures.push(`${label} › ${table.name}${field ? ` › ${field}` : ''}: ${what}`);
  const made = [];
  const relations = (table.fields ?? []).filter((f) => f.type === 'relation');
  const computed = (table.fields ?? []).filter((f) => COMPUTED.has(f.type));
  const step = async (field, what, fn) => {
    try { return (await fn()) ?? true; } catch (err) { fail(field, `${what} threw: ${err.message}`); return undefined; }
  };

  try {
    const name = `Template exercise ${table.name} ${tag}`;
    const { values, written, skipped } = sampleRow(table, name);
    report.skipped.push(...skipped);
    const row = await step(null, 'adding a row', () => api.createRow(refOf(table), values));
    if (!row?.id) { if (row) fail(null, 'adding a row answered no id'); return report; }
    made.push(row.id);
    const back = await step(null, 'reading the new row', () => api.getRow(row.id));
    if (back) {
      for (const f of written) {
        const [got, want] = readBack(f, values[f.name], back);
        if (!isDeepStrictEqual(got, want)) fail(f.name, `${f.type} wrote ${show(values[f.name])}, read back ${show(got)} (expected ${show(want)})`);
      }
    }
    report.fields = written.length;
    const nameField = written.find((f) => f.role === 'name' && f.type === 'text');
    if (nameField) {
      values[nameField.name] = `${name} edited`;
      const edited = await step(nameField.name, 'editing the row', () => api.updateRow(row.id, { [nameField.name]: values[nameField.name] }));
      if (edited !== undefined) {
        const again = await step(nameField.name, 'reading the edited row', () => api.getRow(row.id));
        if (again && again.raw?.[nameField.name] !== values[nameField.name]) fail(nameField.name, `edit read back ${show(again.raw?.[nameField.name])}`);
      }
    }

    const linked = new Map();
    for (const rel of relations) {
      const far = tableOf(Array.isArray(rel.targetDbs) ? rel.targetDbs[0] : rel.targetDb);
      if (!far) { fail(rel.name, `its target ${show(rel.targetDbs ?? rel.targetDb)} is not in the schema`); continue; }
      const farSample = sampleRow(far, `Template exercise ${far.name} for ${table.name}.${rel.name} ${tag}`);
      const farRow = await step(rel.name, `adding a ${far.name} row to link`, () => api.createRow(refOf(far), farSample.values));
      if (!farRow?.id) continue;
      made.push(farRow.id);
      for (const lk of computed.filter((c) => c.type === 'lookup' && c.via === rel.name)) {
        const hop = (far.fields ?? []).find((x) => x.name === lk.targetField);
        if (hop?.type !== 'relation') continue;
        const next = tableOf(Array.isArray(hop.targetDbs) ? hop.targetDbs[0] : hop.targetDb);
        if (!next) continue;
        const end = await step(lk.name, `adding a ${next.name} row for the lookup`, () => api.createRow(refOf(next), sampleRow(next, `Template exercise ${next.name} for ${table.name}.${lk.name} ${tag}`).values));
        if (!end?.id) continue;
        made.push(end.id);
        await step(lk.name, `linking ${far.name}.${hop.name}`, () => api.link(farRow.id, hop.name, [end.id]));
      }
      if (await step(rel.name, 'link', () => api.link(row.id, rel.name, [farRow.id])) === undefined) continue;
      report.relations++;
      linked.set(rel.name, farRow.id);
      const mine = await step(rel.name, 'reading the row after link', () => api.getRow(row.id));
      if (mine && !ids(mine.raw?.[rel.name]).includes(farRow.id)) fail(rel.name, `link did not hold on this row: ${show(mine.raw?.[rel.name])}`);
      if (rel.inverseField) {
        const theirs = await step(rel.name, 'reading the far row after link', () => api.getRow(farRow.id));
        if (theirs && !ids(theirs.raw?.[rel.inverseField]).includes(row.id)) {
          fail(rel.name, `link is missing from the far end ${far.name}.${rel.inverseField}: ${show(theirs.raw?.[rel.inverseField])}`);
        }
      } else {
        report.notes.push(`${rel.name}: no inverse field, link read from this end only`);
      }
    }

    if (computed.length) {
      const now = await step(null, 'reading the row with every relation linked', () => api.getRow(row.id));
      for (const f of now ? computed : []) {
        const got = now.raw?.[f.name];
        if (f.type === 'formula') {
          report.computed++;
          if (got == null || got === '' || (typeof got === 'object' && !Array.isArray(got) && (got.error || got.cycle))) {
            fail(f.name, `formula ${show(f.expression)} answered ${show(got)}`);
          }
          continue;
        }
        const rel = relations.find((r) => r.name === f.via);
        if (!rel) { report.notes.push(`${f.name}: reads through '${f.via}', not a relation of this table`); continue; }
        if (!linked.has(rel.name)) { fail(f.name, `not checked: its relation ${rel.name} never linked`); continue; }
        report.computed++;
        const farNow = await step(f.name, 'reading the far row', () => api.getRow(linked.get(rel.name)));
        if (!farNow) continue;
        const farValue = f.targetField == null ? null : farNow.raw?.[f.targetField];
        const expected = expectComputed(f, rel, farValue);
        if (f.targetField != null && isEmpty(farValue) && f.aggregate !== 'count') {
          report.notes.push(`${f.name}: the far ${f.targetField} is empty, so this checks an empty answer`);
        }
        if (expected) {
          if (!isDeepStrictEqual(got, expected.want)) fail(f.name, `${f.type}${f.aggregate ? ` ${f.aggregate}` : ''} of ${f.via}.${f.targetField ?? 'rows'} answered ${show(got)}, expected ${show(expected.want)}`);
        } else if (isEmpty(got)) {
          fail(f.name, `${f.type} ${f.aggregate ?? ''} of ${f.via}.${f.targetField} answered nothing while linked`);
        }
      }
    }

    for (const rel of relations) {
      const farId = linked.get(rel.name);
      if (!farId) continue;
      if (await step(rel.name, 'unlink', () => api.unlink(row.id, rel.name, [farId])) === undefined) continue;
      const mine = await step(rel.name, 'reading the row after unlink', () => api.getRow(row.id));
      if (mine && !isEmpty(mine.raw?.[rel.name])) fail(rel.name, `unlink left ${show(mine.raw?.[rel.name])} on this row`);
      if (rel.inverseField) {
        const theirs = await step(rel.name, 'reading the far row after unlink', () => api.getRow(farId));
        if (theirs && !isEmpty(theirs.raw?.[rel.inverseField])) fail(rel.name, `unlink left ${show(theirs.raw?.[rel.inverseField])} on the far end ${rel.inverseField}`);
      }
    }

    const t = refOf(table);
    if (await step(null, 'soft delete', () => api.deleteRow(row.id)) !== undefined) {
      const live = await step(null, 'listing rows after delete', () => api.listRows(t));
      if (live?.includes(row.id)) fail(null, 'a deleted row is still listed');
      const trash = await step(null, 'listing the trash', () => api.listTrash(t));
      if (trash && !trash.includes(row.id)) fail(null, 'a deleted row is not in the trash');
      if (await step(null, 'restore', () => api.restoreRow(row.id)) !== undefined) {
        const again = await step(null, 'listing rows after restore', () => api.listRows(t));
        if (again && !again.includes(row.id)) fail(null, 'a restored row is not listed');
        const trashAfter = await step(null, 'listing the trash after restore', () => api.listTrash(t));
        if (trashAfter?.includes(row.id)) fail(null, 'a restored row is still in the trash');
        const restored = await step(null, 'reading the restored row', () => api.getRow(row.id));
        for (const f of restored ? written : []) {
          const [got, want] = readBack(f, values[f.name], restored);
          if (!isDeepStrictEqual(got, want)) fail(f.name, `restore brought back ${show(got)}, expected ${show(want)}`);
        }
      }
    }
  } finally {
    for (const id of made.reverse()) {
      try { await api.deleteRow(id, { hard: true }); } catch (err) {
        if (!/not found|404/i.test(err.message)) fail(null, `cleanup of ${id} threw: ${err.message}`);
      }
    }
    report.ok = report.failures.length === 0;
  }
  return report;
}

export async function exerciseSpace(api, spaceName, options = {}) {
  const schema = await api.schema();
  const space = schema.find((s) => s.space === spaceName);
  if (!space) throw new Error(`no space named '${spaceName}'`);
  const reports = [];
  for (const table of space.tables ?? []) {
    if (table.system) continue;
    reports.push(await exerciseTable(api, table, { label: spaceName, ...options, schema }));
  }
  return reports;
}

export function engineApi(w) {
  return {
    schema: async () => w.describeSchema(),
    createRow: async (t, values) => w.readEntity(w.createEntity(t, { values }).id),
    updateRow: async (id, values) => { w.updateEntity(id, values); return w.readEntity(id); },
    getRow: async (id) => w.readEntity(id),
    link: async (id, field, targets) => w.link(id, field, targets),
    unlink: async (id, field, targets) => w.unlink(id, field, targets),
    deleteRow: async (id, { hard = false } = {}) => w.deleteEntity(id, { hard }),
    restoreRow: async (id) => w.restoreEntity(id),
    listRows: async (t) => w.listEntities(w.getTable(t).id).map((e) => e.id),
    listTrash: async (t) => w.listTrash(t).map((e) => e.id),
  };
}

export function httpApi(base, { headers = {} } = {}) {
  const root = base.replace(/\/+$/, '');
  const call = async (method, path, body) => {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${data?.error ?? text}`);
    return data;
  };
  const enc = encodeURIComponent;
  return {
    call,
    schema: () => call('GET', '/api/schema'),
    createRow: (t, values) => call('POST', `/api/tables/${enc(t)}/entities`, { values }),
    updateRow: (id, values) => call('PATCH', `/api/entities/${enc(id)}`, { values }),
    getRow: (id) => call('GET', `/api/entities/${enc(id)}`),
    link: (id, field, targets) => call('POST', `/api/entities/${enc(id)}/link`, { field, targets }),
    unlink: (id, field, targets) => call('POST', `/api/entities/${enc(id)}/unlink`, { field, targets }),
    deleteRow: (id, { hard = false } = {}) => call('DELETE', `/api/entities/${enc(id)}${hard ? '?hard=1' : ''}`),
    restoreRow: (id) => call('POST', `/api/entities/${enc(id)}/restore`),
    listRows: async (t) => (await call('GET', `/api/tables/${enc(t)}/entities`)).items.map((e) => e.id),
    listTrash: async (t) => (await call('GET', `/api/tables/${enc(t)}/trash`)).items.map((e) => e.id),
  };
}
