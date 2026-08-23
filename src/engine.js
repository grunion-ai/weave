import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { uuid, slug } from './ids.js';
import { Store, WeaveError } from './store.js';
import { evaluate } from './formula.js';

// Minimal CSV parser handling quoted cells and embedded newlines.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text ?? '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

const VALUE_TYPES = ['text', 'number', 'date', 'daterange', 'checkbox', 'url', 'email', 'select', 'multiselect', 'workflow', 'relation', 'field', 'key', 'attachments'];
const COMPUTED_TYPES = ['lookup', 'rollup', 'formula'];
/* Types whose definition can name the value a new row starts with. Workflow is
   absent on purpose: its default is one of its states, which is where it has
   always lived. */
const DEFAULTABLE_TYPES = ['text', 'number', 'date', 'daterange', 'checkbox', 'url', 'email', 'select', 'multiselect'];
export const FIELD_TYPES = [...VALUE_TYPES, ...COMPUTED_TYPES, 'document'];
/* What a document edit actually did, in the terms a reader of the feed needs:
   where it landed, how much text came and went, and the first line that
   differs. Trimming the common head and tail is the shape of a single edit —
   which is what an autosave almost always is — and degrades honestly to "the
   whole document changed" when the edit was not local. */
function docChange(field, before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head
    && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return {
    field,
    length: after.length,
    prevLength: before.length,
    delta: after.length - before.length,
    line: head + 1,
    linesAdded: b.length - head - tail,
    linesRemoved: a.length - head - tail,
    preview: (b[head] ?? a[head] ?? '').trim().slice(0, 120),
  };
}

const STATE_CATEGORIES = ['not-started', 'in-progress', 'done', 'canceled'];
const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'join'];
const MAX_COMPUTE_DEPTH = 8;

/* The `field` type holds a field DEFINITION as its value — the schema of a
   field one level down the hierarchy. It is what terminates the meta-model's
   recursion: a space-level `Fields` table needs fields to describe fields, and
   the innermost descriptor is this ordinary primitive whose options come from
   the array below, which lives beneath the entity layer. Nothing is circular.

   `relation` and the computed types are NOT definable: their config names
   fields of a specific resolved table, which a down-hierarchy definition does
   not have yet. Refusing them at definition time is deliberate — the
   alternative is a definition that only fails when something tries to
   materialise it. */
export const DEFINABLE_TYPES = [
  'text', 'number', 'date', 'daterange', 'checkbox', 'url', 'email',
  'select', 'multiselect', 'workflow', 'document', 'field', 'key', 'attachments',
];
const MAX_DEFINITION_DEPTH = 4;

/* The single normaliser for every type whose config is self-contained. Used
   by addField AND by `field` value validation, so a definition can never
   describe a field the engine would refuse to create. */
function normalizeSelfContainedConfig(type, config = {}) {
  if (type === 'select' || type === 'multiselect') {
    return {
      options: (config.options ?? []).map((o) => (typeof o === 'string'
        ? { id: slug(o), name: o, color: '' }
        : { id: o.id ?? slug(o.name), name: o.name, color: o.color ?? '' })),
    };
  }
  if (type === 'workflow') {
    const states = (config.states ?? []).map((s) => (typeof s === 'string'
      ? { id: slug(s), name: s, category: 'in-progress', default: false }
      : { id: s.id ?? slug(s.name), name: s.name, category: s.category ?? 'in-progress', default: !!s.default }));
    if (states.length === 0) throw new WeaveError('Workflow field needs at least one state', 'invalid');
    for (const s of states) {
      if (!STATE_CATEGORIES.includes(s.category)) {
        throw new WeaveError(`Invalid state category '${s.category}' (use ${STATE_CATEGORIES.join(', ')})`, 'invalid');
      }
    }
    return { states };
  }
  if (type === 'number') {
    const out = {};
    if (config.format != null) {
      if (!['number', 'currency', 'percent'].includes(config.format)) {
        throw new WeaveError(`Invalid number format '${config.format}' (number, currency, percent)`, 'invalid');
      }
      if (config.format !== 'number') out.format = config.format;
    }
    if (config.unit != null && String(config.unit).trim()) out.unit = String(config.unit).trim();
    if (config.decimals != null) {
      if (!Number.isInteger(config.decimals) || config.decimals < 0 || config.decimals > 6) {
        throw new WeaveError(`Decimals must be 0..6, got '${config.decimals}'`, 'invalid');
      }
      out.decimals = config.decimals;
    }
    if (config.separator != null) out.separator = !!config.separator;
    return out;
  }
  if (type === 'date') {
    const out = {};
    if (config.format != null) {
      if (!['iso', 'us', 'eu', 'long'].includes(config.format)) {
        throw new WeaveError(`Invalid date format '${config.format}' (iso, us, eu, long)`, 'invalid');
      }
      if (config.format !== 'iso') out.format = config.format;
    }
    if (config.time != null) out.time = !!config.time;
    return out;
  }
  if (type === 'field') {
    const depth = config.depth ?? 1;
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEFINITION_DEPTH) {
      throw new WeaveError(`Definition depth must be 1..${MAX_DEFINITION_DEPTH}, got '${depth}'`, 'invalid');
    }
    return { types: [...DEFINABLE_TYPES], depth };
  }
  return {};
}

/* Validate one field definition — the value of a `field`-typed field.
   `depth` is how many further levels this definition is allowed to define;
   at depth 1 it must describe a leaf, so it may not itself be a `field`. */
function normalizeDefinition(raw, depth) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WeaveError('A field definition must be an object of { type, config }', 'invalid');
  }
  const { type } = raw;
  if (!DEFINABLE_TYPES.includes(type)) {
    throw new WeaveError(`'${type}' is not a definable field type (use ${DEFINABLE_TYPES.join(', ')})`, 'invalid');
  }
  if (type === 'field' && depth < 2) {
    throw new WeaveError(
      'A definition at depth 1 must describe a leaf field; raise the field\'s depth to nest one', 'invalid');
  }
  const config = normalizeSelfContainedConfig(type, raw.config ?? {});
  if (type === 'field' && config.depth > depth - 1) {
    throw new WeaveError(
      `A nested definition may declare depth ${depth - 1} at most, got ${config.depth}`, 'invalid');
  }
  return { type, config };
}
// Narrower than this and a column can hold neither a chip nor a resize grip.
const MIN_COLUMN_WIDTH = 60;

// The documented keys of a createEntity input. Everything else in the object
// is treated as a field value, so a flat create behaves like a flat update.
const CREATE_INPUT_KEYS = new Set(['values', 'name', 'doc', 'docs']);

export { WeaveError };

function nowISO() {
  return new Date().toISOString();
}

export class Weave {
  // Entity ids mutated since the last save — the store flushes only these
  // rows. An id missing from state at save time means "delete the row".
  #dirty = new Set();
  #dirtyAll = false;

  // `store` injects an alternate Store implementation (same interface) — the
  // Cloudflare Worker port (Feature #84) passes a Durable Object-backed one.
  constructor({ path = null, actor = 'local', keystorePath = null, store = null } = {}) {
    this.actor = actor;
    this.keystorePath = keystorePath ?? process.env.WEAVE_KEYSTORE ?? join(process.env.HOME ?? '.', '.weave', 'keystore.json');
    this.store = store ?? new Store(path);
    const loaded = this.store.load();
    // A pre-existing file must actually be a workspace — never adopt (and
    // never migrate-write!) arbitrary JSON like a package.json.
    if (loaded && (!loaded.meta || (loaded.tables == null && loaded.databases == null))) {
      throw new WeaveError(`'${path}' is not a Weave workspace file`, 'invalid');
    }
    this.state = loaded ?? {
      version: 2,
      meta: { name: 'Weave Workspace', createdAt: nowISO() },
      spaces: {},
      tables: {},
      entities: {},
      automations: {},
    };
    this.#migrate();
    this.#ensureMetaTables();
  }

  // Upgrade v1 workspaces in place: `databases` state key → `tables`, and the
  // single entity-level `doc` → a Description document field per table.
  #migrate() {
    const s = this.state;
    if (s.databases && !s.tables) {
      s.tables = s.databases;
      delete s.databases;
    }
    s.tables = s.tables ?? {};
    let changed = false;
    for (const db of Object.values(s.tables)) {
      // System registry tables (Feature #12) carry a TEXT Description that
      // syncs with the real space/table description — backfilling a document
      // field here would give them a second, colliding 'Description'.
      if (db.system) continue;
      let docField = Object.values(db.fields).find((f) => f.type === 'document');
      if (!docField) {
        docField = { id: uuid(), name: 'Description', type: 'document', config: {} };
        db.fields[docField.id] = docField;
        db.fieldOrder.push(docField.id);
        changed = true;
      }
    }
    for (const e of Object.values(s.entities ?? {})) {
      if (e.docs) continue;
      e.docs = {};
      if (e.doc) {
        const db = s.tables[e.dbId];
        const docField = Object.values(db.fields).find((f) => f.type === 'document');
        if (docField) e.docs[docField.id] = e.doc;
      }
      delete e.doc;
      changed = true;
    }
    if (s.version !== 2) {
      s.version = 2;
      changed = true;
    }
    if (changed) {
      this.#dirtyAll = true;
      this.save();
    }
  }

  save() {
    this.store.save(this.state, { dirty: this.#dirty, all: this.#dirtyAll });
    this.#dirty.clear();
    this.#dirtyAll = false;
  }

  #mark(entityOrId) {
    this.#dirty.add(typeof entityOrId === 'string' ? entityOrId : entityOrId.id);
  }

  // Re-read state when another process (CLI beside the server, a second
  // server) committed to the same workspace file. Returns true on reload.
  maybeRefresh() {
    if (!this.store.changedExternally?.()) return false;
    const loaded = this.store.reload();
    if (loaded) this.state = loaded;
    return true;
  }

  // ---------------- spaces ----------------

  createSpace({ name, description = '' }) {
    if (!name) throw new WeaveError('Space name is required', 'invalid');
    if (this.findSpace(name)) throw new WeaveError(`Space '${name}' already exists`, 'conflict');
    const space = { id: uuid(), name, description, createdAt: nowISO() };
    this.state.spaces[space.id] = space;
    this.save();
    this.#syncSpaceRow(space);
    if (!space.system) this.#audit('space-created', { name: space.name });
    return space;
  }

  listSpaces() {
    return Object.values(this.state.spaces);
  }

  findSpace(ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    return this.state.spaces[ref] ?? Object.values(this.state.spaces).find((s) => s.name === ref)
      ?? Object.values(this.state.spaces).find((s) => s.name.toLowerCase() === String(ref).toLowerCase());
  }

  getSpace(ref) {
    const s = this.findSpace(ref);
    if (!s) throw new WeaveError(`Space '${ref}' not found`, 'not-found');
    return s;
  }

  updateSpace(ref, patch) {
    const s = this.getSpace(ref);
    this.#audit('space-updated', { name: s.name, patch: Object.keys(patch) });
    if (patch.name != null) s.name = patch.name;
    if (patch.description != null) s.description = patch.description;
    if (patch.icon != null) { if (String(patch.icon).trim()) s.icon = String(patch.icon).trim(); else delete s.icon; }
    this.#syncSpaceRow(s);
    this.save();
    return s;
  }

  deleteSpace(ref) {
    const s = this.getSpace(ref);
    if (s.system) throw new WeaveError(`Space '${s.name}' is part of the system registry`, 'invalid');
    for (const db of this.listTables(s.id)) this.deleteTable(db.id);
    delete this.state.spaces[s.id];
    this.#dropSysRow('spaces', s.id);
    this.#audit('space-deleted', { name: s.name });
    this.save();
  }

  // ---------------- tables ----------------

  createTable({ space, name, description = '', icon = '' }) {
    const sp = this.getSpace(space);
    if (!name) throw new WeaveError('Table name is required', 'invalid');
    const qualified = `${sp.name}/${name}`;
    if (this.findTable(qualified)) throw new WeaveError(`Table '${qualified}' already exists`, 'conflict');
    const nameField = { id: uuid(), name: 'Name', type: 'text', config: {} };
    const docField = { id: uuid(), name: 'Description', type: 'document', config: {} };
    const db = {
      id: uuid(),
      spaceId: sp.id,
      name,
      description,
      icon,
      publicIdCounter: 0,
      nameFieldId: nameField.id,
      fields: { [nameField.id]: nameField, [docField.id]: docField },
      fieldOrder: [nameField.id, docField.id],
      createdAt: nowISO(),
    };
    this.state.tables[db.id] = db;
    this.save();
    this.#syncTableRow(db);
    for (const f of Object.values(db.fields)) this.#syncFieldRow(db, f);
    if (!db.system) this.#audit('table-created', { space: sp.name, name: db.name });
    return db;
  }

  listTables(spaceId = null) {
    const all = Object.values(this.state.tables);
    return spaceId ? all.filter((d) => d.spaceId === spaceId) : all;
  }

  qualifiedName(db) {
    const sp = this.state.spaces[db.spaceId];
    return `${sp ? sp.name : '?'}/${db.name}`;
  }

  findTable(ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    if (this.state.tables[ref]) return this.state.tables[ref];
    const all = Object.values(this.state.tables);
    if (String(ref).includes('/')) {
      const [spName, dbName] = String(ref).split('/');
      return all.find((d) => d.name.toLowerCase() === dbName.toLowerCase()
        && this.state.spaces[d.spaceId]?.name.toLowerCase() === spName.toLowerCase());
    }
    const matches = all.filter((d) => d.name.toLowerCase() === String(ref).toLowerCase());
    if (matches.length > 1) throw new WeaveError(`Table name '${ref}' is ambiguous; qualify as Space/Name`, 'ambiguous');
    return matches[0];
  }

  getTable(ref) {
    const db = this.findTable(ref);
    if (!db) throw new WeaveError(`Table '${ref}' not found`, 'not-found');
    return db;
  }

  updateTable(ref, patch) {
    const db = this.getTable(ref);
    if (patch.name != null) db.name = patch.name;
    if (patch.description != null) db.description = patch.description;
    if (patch.icon != null) db.icon = patch.icon;
    if (patch.noun != null) {
      if (typeof patch.noun !== 'string') throw new WeaveError('A noun is a short string (e.g. "invoice")', 'invalid');
      if (patch.noun.trim()) db.noun = patch.noun.trim(); else delete db.noun;
    }
    if (patch.systemFields != null) {
      const known = ['Created At', 'Modified At', 'Created By', 'Modified By', 'Activity'];
      for (const n of patch.systemFields) {
        if (!known.includes(n)) throw new WeaveError(`'${n}' is not a system field (${known.join(', ')})`, 'invalid');
      }
      db.systemFields = [...patch.systemFields];
    }
    // Column order is fieldOrder — describeSchema() reads it — so a reorder is
    // a schema write. Demand a full permutation: a short list would silently
    // drop columns off the grid, which reads exactly like data loss.
    if (patch.fieldOrder != null) {
      const ids = patch.fieldOrder.map((ref2) => this.getField(db.id, ref2).id);
      const unique = new Set(ids);
      if (unique.size !== ids.length || ids.length !== db.fieldOrder.length) {
        throw new WeaveError('fieldOrder must list every field exactly once', 'invalid');
      }
      db.fieldOrder = ids;
    }
    this.#syncTableRow(db);
    this.save();
    return db;
  }

  deleteTable(ref) {
    const db = this.getTable(ref);
    if (db.system) throw new WeaveError(`Table '${db.name}' is part of the system registry`, 'invalid');
    // Purge, not trash: the table itself is going away, so a soft-deleted row
    // would be left pointing at a table that no longer exists — unrestorable
    // and fatal to any read of the trash. Trashed rows go too.
    for (const e of this.listEntities(db.id, { includeDeleted: true })) {
      this.deleteEntity(e.id, { hard: true });
    }
    // Remove paired relation fields living in other tables.
    for (const field of Object.values(db.fields)) {
      if (field.type === 'relation') {
        const other = this.state.tables[field.config.targetDb];
        if (other && other.id !== db.id) this.#removeFieldRaw(other, field.config.inverseFieldId);
      }
    }
    for (const [id, auto] of Object.entries(this.state.automations)) {
      if (auto.dbId === db.id) delete this.state.automations[id];
    }
    for (const f of Object.values(db.fields)) this.#dropFieldRow(f.id);
    delete this.state.tables[db.id];
    this.#dropSysRow('tables', db.id);
    this.#audit('table-deleted', { name: db.name });
    this.save();
  }

  // ---------------- fields ----------------

  /* The workspace's shape as mermaid source (Feature #51): one generator,
     consumed by the home page and any document that wants the map. User
     structure only — the registry describes itself and would double every
     edge with bookkeeping. */
  relationMapMmd() {
    const lines = ['graph LR'];
    const nid = (db) => 'T' + db.id.replaceAll('-', '').slice(0, 8);
    for (const sp of this.listSpaces()) {
      if (sp.system) continue;
      const tables = this.listTables(sp.id).filter((t) => !t.system);
      if (!tables.length) continue;
      lines.push(`  subgraph ${JSON.stringify(sp.name)}`);
      for (const t of tables) lines.push(`    ${nid(t)}[${JSON.stringify(t.name)}]`);
      lines.push('  end');
    }
    const seen = new Set();
    for (const db of Object.values(this.state.tables)) {
      if (db.system) continue;
      for (const f of Object.values(db.fields)) {
        if (f.type !== 'relation' || seen.has(f.id)) continue;
        seen.add(f.id);
        seen.add(f.config.inverseFieldId);
        const target = this.state.tables[f.config.targetDb];
        if (!target || target.system) continue;
        lines.push(`  ${nid(db)} -- ${JSON.stringify(f.name)} --> ${nid(target)}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  // ---------------- saved views (Feature #17) ----------------
  /* A view is a named list of blocks — each a table plus an optional where —
     stored in workspace meta. Sharing mints a capability token: the /view/
     URL renders that view read-only and nothing else, even when the
     workspace requires auth. Tables are resolved at creation so a broken
     block fails the author, not the reader. */
  createView({ name, blocks = [] } = {}) {
    if (!name) throw new WeaveError('View name is required', 'invalid');
    const views = (this.state.meta.views ??= {});
    const resolved = blocks.map((b) => {
      const db = this.getTable(b.table);
      return { dbId: db.id, where: b.where ?? null, view: b.view ?? 'table' };
    });
    const v = { id: uuid(), name, blocks: resolved, createdAt: nowISO(), createdBy: this.actor };
    views[v.id] = v;
    this.save();
    this.#audit('view-created', { name });
    return v;
  }

  listViews() {
    return Object.values(this.state.meta.views ?? {}).map(({ shareToken, ...pub }) => ({ ...pub, shared: !!shareToken }));
  }

  getView(id) {
    const v = (this.state.meta.views ?? {})[id];
    if (!v) throw new WeaveError(`View '${id}' not found`, 'not-found');
    return v;
  }

  deleteView(id) {
    const v = this.getView(id);
    delete this.state.meta.views[v.id];
    this.save();
    this.#audit('view-deleted', { name: v.name });
    return { id: v.id, deleted: true };
  }

  resolveView(id) {
    const v = this.getView(id);
    return {
      id: v.id,
      name: v.name,
      blocks: v.blocks.map((b) => {
        const db = this.state.tables[b.dbId];
        if (!db) return { table: '(deleted table)', items: [] };
        const { items } = this.query(db.id, { where: b.where ?? undefined });
        return { table: this.qualifiedName(db), view: b.view, items: items.map((e) => this.readEntity(e.id)) };
      }),
    };
  }

  shareView(id) {
    const v = this.getView(id);
    v.shareToken ??= 'wvv_' + randomBytes(18).toString('base64url');
    this.save();
    this.#audit('view-shared', { name: v.name });
    return { url: `/view/${v.shareToken}`, token: v.shareToken };
  }

  unshareView(id) {
    const v = this.getView(id);
    delete v.shareToken;
    this.save();
    this.#audit('view-unshared', { name: v.name });
    return { id: v.id, shared: false };
  }

  viewByShareToken(token) {
    if (!token) return null;
    return Object.values(this.state.meta.views ?? {}).find((v) => v.shareToken === token) ?? null;
  }

  // ---------------- schema as a document (Feature #13) ----------------
  /* describeSchema() is the read half; this is the write half. Hand back an
     edited copy of that JSON and the workspace grows to match. Additive by
     design: creations and config updates apply freely; an omission is a
     deletion and needs allowDestructive; a type change is never applied —
     the document cannot mean that, delete and recreate is the honest
     spelling. Names are identity here, so renames belong to the registry
     rows (#12/#52), not this surface. System spaces/tables are not the
     document's business in either direction. */
  applySchema(doc, { dryRun = false, allowDestructive = false } = {}) {
    if (!Array.isArray(doc)) throw new WeaveError('A schema document is the array describeSchema() returns', 'invalid');
    const plan = [];
    const act = (action, subject, fn) => {
      plan.push({ action, subject });
      if (!dryRun) fn();
    };
    const configFromDescriptor = (f) => {
      const config = {};
      if (f.options) config.options = f.options;
      if (f.states) config.states = f.states;
      if (f.expression) config.expression = f.expression;
      if (f.via) config.relationField = f.via;
      if (f.targetField) config.targetField = f.targetField;
      if (f.aggregate) config.aggregate = f.aggregate;
      if (f.default !== undefined) config.default = f.default;
      if (f.types || f.depth) config.depth = f.depth;
      return config;
    };
    const wanted = doc.filter((sp) => !sp.system);

    for (const spDoc of wanted) {
      let sp = this.findSpace(spDoc.space);
      if (!sp) {
        act('create-space', spDoc.space, () => { sp = this.createSpace({ name: spDoc.space, description: spDoc.description ?? '' }); });
        if (dryRun) continue;
      } else if (spDoc.description != null && spDoc.description !== (sp.description ?? '')) {
        act('update-space', spDoc.space, () => this.updateSpace(sp.id, { description: spDoc.description }));
      }
      for (const tDoc of spDoc.tables ?? []) {
        const qualified = `${spDoc.space}/${tDoc.name}`;
        let db = this.findTable(qualified);
        if (db?.system) continue;
        if (!db) {
          act('create-table', qualified, () => {
            db = this.createTable({ space: spDoc.space, name: tDoc.name, description: tDoc.description ?? '' });
            for (const f of tDoc.fields ?? []) {
              if (['Name', 'Description'].includes(f.name)) continue;
              this.addField(db.id, { name: f.name, type: f.type, config: configFromDescriptor(f) });
            }
          });
          continue;
        }
        if (tDoc.description != null && tDoc.description !== (db.description ?? '')) {
          act('update-table', qualified, () => this.updateTable(db.id, { description: tDoc.description }));
        }
        for (const fDoc of tDoc.fields ?? []) {
          const existing = Object.values(db.fields).find((x) => x.name === fDoc.name);
          if (!existing) {
            if (fDoc.type === 'relation') {
              act('create-relation', `${qualified}.${fDoc.name}`, () => this.addRelation(db.id, {
                name: fDoc.name, targetDb: fDoc.targetDb,
                cardinality: fDoc.many ? 'one-to-many' : 'many-to-one',
                inverseName: fDoc.inverseField ?? undefined,
              }));
            } else {
              act('create-field', `${qualified}.${fDoc.name}`, () => this.addField(db.id, { name: fDoc.name, type: fDoc.type, config: configFromDescriptor(fDoc) }));
            }
            continue;
          }
          if (existing.type !== fDoc.type) {
            throw new WeaveError(`'${qualified}.${fDoc.name}' cannot change type ('${existing.type}' → '${fDoc.type}') — delete the field and create it anew`, 'invalid');
          }
          const nextCfg = configFromDescriptor(fDoc);
          const cfgChanged = (fDoc.options && JSON.stringify(fDoc.options) !== JSON.stringify(existing.config.options?.map((o) => o.name)))
            || (fDoc.states && JSON.stringify(fDoc.states) !== JSON.stringify(existing.config.states?.map((st) => ({ name: st.name, category: st.category, default: !!st.default }))))
            || (fDoc.expression && fDoc.expression !== existing.config.expression);
          if (cfgChanged) {
            act('update-field', `${qualified}.${fDoc.name}`, () => this.updateField(db.id, existing.id, { config: nextCfg }));
          }
        }
        // Omitted fields are deletions.
        for (const existing of Object.values(db.fields)) {
          if (existing.system || existing.id === db.nameFieldId) continue;
          if (existing.type === 'relation' && existing.inverseOf) continue;
          const still = (tDoc.fields ?? []).some((f) => f.name === existing.name);
          if (!still) {
            if (!allowDestructive) throw new WeaveError(`Applying this document would delete '${qualified}.${existing.name}' — a destructive change needs allowDestructive`, 'invalid');
            act('delete-field', `${qualified}.${existing.name}`, () => this.deleteField(db.id, existing.id));
          }
        }
      }
      // Omitted tables are deletions.
      if (sp && !dryRun || sp) {
        for (const db of this.listTables(sp?.id)) {
          if (db.system) continue;
          const still = (spDoc.tables ?? []).some((t) => t.name === db.name);
          if (!still) {
            if (!allowDestructive) throw new WeaveError(`Applying this document would delete table '${spDoc.space}/${db.name}' — a destructive change needs allowDestructive`, 'invalid');
            act('delete-table', `${spDoc.space}/${db.name}`, () => this.deleteTable(db.id));
          }
        }
      }
    }
    // Omitted spaces are deletions.
    for (const sp of this.listSpaces()) {
      if (sp.system) continue;
      const still = wanted.some((d) => d.space === sp.name);
      if (!still) {
        if (!allowDestructive) throw new WeaveError(`Applying this document would delete space '${sp.name}' — a destructive change needs allowDestructive`, 'invalid');
        act('delete-space', sp.name, () => this.deleteSpace(sp.id));
      }
    }
    if (!dryRun && plan.length) this.#audit('schema-applied', { changes: plan.length });
    return plan;
  }

  // ---------------- keystore (Feature #64) ----------------
  /* Secrets never enter workspace data: a key field's value is a NAME, and
     the name resolves here — a chmod-600 file beside no workspace. There is
     deliberately no way to read a secret over HTTP; resolveKey exists for
     the engine's own consumers (automations, integrations). */
  #readKeystore() {
    try { return JSON.parse(readFileSync(this.keystorePath, 'utf8')); } catch { return {}; }
  }

  #writeKeystore(data) {
    mkdirSync(dirname(this.keystorePath), { recursive: true });
    writeFileSync(this.keystorePath, JSON.stringify(data, null, 1), { mode: 0o600 });
  }

  setKey(name, secret) {
    if (!name) throw new WeaveError('Key name is required', 'invalid');
    const data = this.#readKeystore();
    data[name] = String(secret ?? '');
    this.#writeKeystore(data);
    this.#audit('key-set', { name });
    return { name, set: true };
  }

  deleteKey(name) {
    const data = this.#readKeystore();
    if (!(name in data)) throw new WeaveError(`Key '${name}' not found`, 'not-found');
    delete data[name];
    this.#writeKeystore(data);
    this.#audit('key-deleted', { name });
    return { name, deleted: true };
  }

  hasKey(name) {
    return name in this.#readKeystore();
  }

  listKeys() {
    return Object.keys(this.#readKeystore()).sort().map((name) => ({ name, set: true }));
  }

  resolveKey(name) {
    const data = this.#readKeystore();
    if (!(name in data)) throw new WeaveError(`Key '${name}' not found in the keystore`, 'not-found');
    return data[name];
  }

  // ---------------- accounts & audit (Feature #14) ----------------
  /* Accounts are how a hosted instance (#84, v0.5) knows its callers. The
     token is handed out exactly once; only its sha256 lands at rest. Roles:
     admin (everything), writer (entity work, no schema), reader (reads).
     Enforcement lives at the surfaces — the engine keeps the facts. */
  static ROLES = ['admin', 'writer', 'reader'];

  #audit(action, detail = {}) {
    this.store.audit({ at: nowISO(), actor: this.actor, action, detail });
  }

  listAudit(opts) {
    return this.store.listAudit(opts);
  }

  createAccount({ name, role = 'writer' } = {}) {
    if (!name) throw new WeaveError('Account name is required', 'invalid');
    if (!Weave.ROLES.includes(role)) throw new WeaveError(`Invalid role '${role}' (${Weave.ROLES.join(', ')})`, 'invalid');
    const accounts = (this.state.meta.accounts ??= {});
    if (Object.values(accounts).some((a) => a.name === name)) throw new WeaveError(`Account '${name}' already exists`, 'conflict');
    const token = 'wv_' + randomBytes(24).toString('base64url');
    const account = { id: uuid(), name, role, tokenHash: createHash('sha256').update(token).digest('hex'), createdAt: nowISO() };
    accounts[account.id] = account;
    this.save();
    this.#audit('account-created', { name, role });
    const { tokenHash, ...pub } = account;
    return { account: pub, token };
  }

  verifyToken(token) {
    if (!token) return null;
    const h = createHash('sha256').update(String(token)).digest('hex');
    const a = Object.values(this.state.meta.accounts ?? {}).find((x) => x.tokenHash === h);
    if (!a) return null;
    const { tokenHash, ...pub } = a;
    return pub;
  }

  listAccounts() {
    return Object.values(this.state.meta.accounts ?? {}).map(({ tokenHash, ...pub }) => pub);
  }

  deleteAccount(ref) {
    const accounts = this.state.meta.accounts ?? {};
    const a = accounts[ref] ?? Object.values(accounts).find((x) => x.name === ref);
    if (!a) throw new WeaveError(`Account '${ref}' not found`, 'not-found');
    delete accounts[a.id];
    this.save();
    this.#audit('account-deleted', { name: a.name });
    return { id: a.id, deleted: true };
  }

  setRequireAuth(on) {
    this.state.meta.requireAuth = !!on;
    this.save();
    this.#audit(on ? 'auth-required-on' : 'auth-required-off');
    return this.state.meta.requireAuth;
  }

  // ---------------- meta-model (Feature #12) ----------------
  /* The workspace's structure, as rows. A Workspace system space holds
     `Spaces` (rows = the spaces) and `Tables` (rows = the tables, each
     related to its space's row). The rows are REAL entities, so relations,
     automations and custom fields work on structure for free. The engine's
     own verbs keep both directions in step: a structural verb writes its row,
     a row verb on a system table translates into the structural verb —
     #inMetaSync marks which side started it, so the loop terminates. */
  #inMetaSync = false;

  #metaSync(fn) {
    const was = this.#inMetaSync;
    this.#inMetaSync = true;
    try { return fn(); } finally { this.#inMetaSync = was; }
  }

  /* ---------------- undo ----------------
     Every entity mutation verb records an inverse-operation entry before it
     returns; undo() pops entries and replays the inverse. Deliberate limits:
     structural work (spaces, tables, fields, registry rows — everything the
     audit log covers) is not undoable, hard deletes and file deletions are
     gone for real, and undo itself fires no automations — stepping back must
     not cascade forward. */
  #inUndo = false;

  #recordUndo(kind, e, data = {}) {
    if (this.#inMetaSync || this.#inUndo) return;
    const db = this.state.tables[e.dbId];
    if (!db || db.system) return;
    this.store.pushUndo({
      ts: nowISO(),
      actor: this.actor,
      kind,
      entityId: e.id,
      table: this.qualifiedName(db),
      publicId: e.publicId,
      name: String(e.values[db.nameFieldId] ?? ''),
      data,
    });
  }

  // Sparse before-image of exactly the fields a mutation names.
  #undoBefore(e, db, fieldRefs) {
    const before = { values: {}, docs: {} };
    for (const ref of fieldRefs) {
      const f = typeof ref === 'object' ? ref : this.findField(db, ref);
      if (!f || COMPUTED_TYPES.includes(f.type)) continue;
      if (f.type === 'document') before.docs[f.id] = e.docs?.[f.id] ?? '';
      else before.values[f.id] = structuredClone(e.values[f.id] ?? null);
    }
    return before;
  }

  #undoChanged(e, before) {
    for (const [fid, prev] of Object.entries(before.values)) {
      if (JSON.stringify(e.values[fid] ?? null) !== JSON.stringify(prev)) return true;
    }
    for (const [fid, prev] of Object.entries(before.docs)) {
      if ((e.docs?.[fid] ?? '') !== prev) return true;
    }
    return false;
  }

  undo({ steps = 1 } = {}) {
    const undone = [];
    this.#inUndo = true;
    try {
      for (let i = 0; i < steps; i++) {
        const entry = this.store.popUndo();
        if (!entry) break;
        const summary = { kind: entry.kind, entity: `${entry.table}#${entry.publicId}`, name: entry.name, ts: entry.ts };
        const e = this.state.entities[entry.entityId];
        if (!e) { undone.push({ ...summary, skipped: 'entity purged' }); continue; }
        const db = this.state.tables[e.dbId];
        switch (entry.kind) {
          case 'create':
          case 'restore':
            this.deleteEntity(e.id);
            break;
          case 'delete':
            this.restoreEntity(e.id);
            break;
          case 'update': {
            const before = entry.data.before ?? { values: {}, docs: {} };
            const fields = [];
            for (const [fid, prev] of Object.entries(before.values)) {
              const f = db.fields[fid];
              if (!f) continue;
              fields.push(f.name);
              if (f.type === 'relation') {
                const ids = prev == null ? [] : Array.isArray(prev) ? prev : [prev];
                this.#setRelationValue(e, db, f, ids.filter((id) => this.state.entities[id]));
              } else {
                e.values[fid] = structuredClone(prev);
              }
            }
            for (const [fid, text] of Object.entries(before.docs)) {
              if (db.fields[fid]) { fields.push(db.fields[fid].name); e.docs[fid] = text; }
            }
            e.updatedAt = nowISO();
            e.modifiedBy = this.actor;
            this.#logActivity(e, 'undo', { fields });
            this.#mark(e);
            this.save();
            break;
          }
          case 'comment-add':
            e.comments = e.comments.filter((c) => c.id !== entry.data.commentId);
            this.#mark(e);
            this.save();
            break;
          case 'comment-delete':
            e.comments.push(entry.data.comment);
            this.#mark(e);
            this.save();
            break;
          case 'file-attach':
            this.deleteFile(e.id, entry.data.fileId);
            break;
        }
        undone.push(summary);
      }
    } finally {
      this.#inUndo = false;
    }
    return { undone };
  }

  listUndo({ limit = 20 } = {}) {
    return this.store.listUndo({ limit })
      .map(({ data, ...summary }) => ({ ...summary, entity: `${summary.table}#${summary.publicId}` }));
  }

  #sysTable(kind) {
    return Object.values(this.state.tables).find((t) => t.system === kind);
  }

  #sysRow(kind, sysId) {
    const t = this.#sysTable(kind);
    if (!t) return undefined;
    return Object.values(this.state.entities).find((e) => e.dbId === t.id && e.sysId === sysId && !e.deletedAt);
  }

  #sysField(table, name) {
    return Object.values(table.fields).find((f) => f.name === name);
  }

  /* Idempotent bootstrap: runs on every load and import, so a legacy
     workspace grows its registry the first time a new engine opens it. */
  #ensureMetaTables() {
    const s = this.state;
    let ws = Object.values(s.spaces).find((x) => x.system === 'workspace');
    if (!ws) {
      ws = { id: uuid(), name: 'Workspace', description: 'The workspace itself: its spaces and tables, as rows.', system: 'workspace', createdAt: nowISO() };
      s.spaces[ws.id] = ws;
    }
    const mkTable = (name, kind, description) => {
      const nameF = { id: uuid(), name: 'Name', type: 'text', config: {}, system: true };
      const descF = { id: uuid(), name: 'Description', type: 'text', config: {}, system: true };
      const t = {
        id: uuid(), spaceId: ws.id, name, description, icon: '', system: kind,
        publicIdCounter: 0, nameFieldId: nameF.id,
        fields: { [nameF.id]: nameF, [descF.id]: descF },
        fieldOrder: [nameF.id, descF.id], createdAt: nowISO(),
      };
      s.tables[t.id] = t;
      return t;
    };
    const spacesT = this.#sysTable('spaces')
      ?? mkTable('Spaces', 'spaces', 'Every space in this workspace, as a row. Creating a row creates the space; renaming it renames the space; hard-deleting it deletes the space and everything in it.');
    const tablesT = this.#sysTable('tables')
      ?? mkTable('Tables', 'tables', 'Every table in this workspace, as a row related to its space. Creating a row creates the table; renaming it renames the table; hard-deleting it deletes the table and its rows.');
    if (!this.#sysField(tablesT, 'Space')) {
      const { field, inverse } = this.addRelation(tablesT.id, { name: 'Space', targetDb: spacesT.id, cardinality: 'many-to-one', inverseName: 'Tables' });
      field.system = true;
      inverse.system = true;
    }
    const fieldsT = this.#sysTable('fields')
      ?? mkTable('Fields', 'fields', 'Every field of every table, as a row related to its table and carrying its definition. Creating a row creates the column; renaming it renames the column; editing its Definition changes the config; hard-deleting it deletes the column.');
    if (!this.#sysField(fieldsT, 'Table')) {
      const { field, inverse } = this.addRelation(fieldsT.id, { name: 'Table', targetDb: tablesT.id, cardinality: 'many-to-one', inverseName: 'Fields' });
      field.system = true;
      inverse.system = true;
    }
    if (!this.#sysField(fieldsT, 'Type')) this.addField(fieldsT.id, { name: 'Type', type: 'text' }).system = true;
    // Depth 4 (the cap): the registry must describe field-type columns, which
    // are themselves definitions one level down. A depth-4 field column is the
    // one shape the registry cannot hold — #syncFieldRow leaves it empty.
    if (!this.#sysField(fieldsT, 'Definition')) this.addField(fieldsT.id, { name: 'Definition', type: 'field', config: { depth: 4 } }).system = true;
    for (const sp of Object.values(s.spaces)) this.#syncSpaceRow(sp);
    for (const t of Object.values(s.tables)) this.#syncTableRow(t);
    for (const t of Object.values(s.tables)) {
      if (t.system) continue;
      for (const f of Object.values(t.fields)) this.#syncFieldRow(t, f);
    }
  }

  #syncSpaceRow(space) {
    if (space.system) return undefined;
    const t = this.#sysTable('spaces');
    if (!t) return undefined; // mid-bootstrap
    let row = this.#sysRow('spaces', space.id);
    if (!row) {
      row = this.#metaSync(() => this.createEntity(t.id, { name: space.name, values: { Description: space.description ?? '' } }));
      row.sysId = space.id;
      this.#mark(row);
      this.save();
      return row;
    }
    const patch = {};
    if (this.entityName(row) !== space.name) patch.Name = space.name;
    const descF = this.#sysField(t, 'Description');
    if ((row.values[descF.id] ?? '') !== (space.description ?? '')) patch.Description = space.description ?? '';
    if (Object.keys(patch).length) this.#metaSync(() => this.updateEntity(row.id, patch));
    return row;
  }

  #syncTableRow(db) {
    if (db.system) return undefined;
    const t = this.#sysTable('tables');
    if (!t) return undefined;
    const spaceRow = this.#sysRow('spaces', db.spaceId);
    let row = this.#sysRow('tables', db.id);
    if (!row) {
      row = this.#metaSync(() => this.createEntity(t.id, {
        name: db.name,
        values: { Description: db.description ?? '', ...(spaceRow ? { Space: spaceRow.id } : {}) },
      }));
      row.sysId = db.id;
      this.#mark(row);
      this.save();
      return row;
    }
    const patch = {};
    if (this.entityName(row) !== db.name) patch.Name = db.name;
    const descF = this.#sysField(t, 'Description');
    if ((row.values[descF.id] ?? '') !== (db.description ?? '')) patch.Description = db.description ?? '';
    if (Object.keys(patch).length) this.#metaSync(() => this.updateEntity(row.id, patch));
    return row;
  }

  /* One row per field of every user table (Feature #52). DEFINABLE types
     carry their shape as a `field` value; relations and computed fields are
     rows too — the registry is complete — but their Definition stays empty
     and their shape belongs to the schema verbs that understand them. */
  #syncFieldRow(db, f) {
    if (db.system) return undefined;
    const t = this.#sysTable('fields');
    if (!t) return undefined;
    const tableRow = this.#sysRow('tables', db.id);
    if (!tableRow) return undefined;
    const definable = DEFINABLE_TYPES.includes(f.type) && !(f.type === 'field' && (f.config.depth ?? 1) >= 4);
    let row = this.#sysRow('fields', f.id);
    if (!row) {
      row = this.#metaSync(() => this.createEntity(t.id, {
        name: f.name,
        values: {
          Table: tableRow.id,
          Type: f.type,
          ...(definable ? { Definition: { type: f.type, config: f.config } } : {}),
        },
      }));
      row.sysId = f.id;
      this.#mark(row);
      this.save();
      return row;
    }
    const patch = {};
    if (this.entityName(row) !== f.name) patch.Name = f.name;
    if (definable) patch.Definition = { type: f.type, config: f.config };
    if (Object.keys(patch).length) this.#metaSync(() => this.updateEntity(row.id, patch));
    return row;
  }

  #dropFieldRow(fieldId) {
    const row = this.#sysRow('fields', fieldId);
    if (row) this.#metaSync(() => this.deleteEntity(row.id, { hard: true }));
  }

  /* The table a field id belongs to — the registry's way back to the schema. */
  #fieldOwner(fieldId) {
    return Object.values(this.state.tables).find((t) => t.fields[fieldId]);
  }

  #dropSysRow(kind, sysId) {
    const row = this.#sysRow(kind, sysId);
    if (row) this.#metaSync(() => this.deleteEntity(row.id, { hard: true }));
  }

  /* Row-side verbs arriving at a system table translate into the structural
     verb; that verb's own sync writes the row, so both directions share one
     path. Returns undefined when the call should proceed as a plain row op. */
  #interceptCreate(db, input) {
    if (!db.system || this.#inMetaSync) return undefined;
    const flat = Object.fromEntries(Object.entries(input ?? {}).filter(([k]) => !['name', 'values', 'doc', 'docs'].includes(k)));
    const values = { ...flat, ...(input?.values ?? {}) };
    const name = input?.name ?? values.Name;
    if (!name) throw new WeaveError('Name is required', 'invalid');
    const description = values.Description ?? '';
    delete values.Name;
    delete values.Description;
    let made;
    if (db.system === 'spaces') {
      made = this.#sysRow('spaces', this.createSpace({ name, description }).id);
    } else if (db.system === 'tables') {
      const spaceRef = values.Space;
      delete values.Space;
      if (spaceRef == null) throw new WeaveError(`A Tables row needs its 'Space' — which space the table lives in`, 'invalid');
      const spaceRow = this.findEntity(this.#sysTable('spaces').id, spaceRef);
      if (!spaceRow) throw new WeaveError(`Space row '${spaceRef}' not found`, 'not-found');
      made = this.#sysRow('tables', this.createTable({ space: spaceRow.sysId, name, description }).id);
    } else if (db.system === 'fields') {
      const tableRef = values.Table;
      const def = values.Definition;
      delete values.Table;
      delete values.Definition;
      delete values.Type; // derived from the definition, never written directly
      if (tableRef == null) throw new WeaveError(`A Fields row needs its 'Table' — which table the column lands on`, 'invalid');
      if (!def || typeof def !== 'object' || !def.type) throw new WeaveError(`A Fields row needs its 'Definition' — the column's shape`, 'invalid');
      const tableRow = this.findEntity(this.#sysTable('tables').id, tableRef);
      if (!tableRow) throw new WeaveError(`Table row '${tableRef}' not found`, 'not-found');
      const f = this.addField(tableRow.sysId, { name, type: def.type, config: def.config ?? {} });
      made = this.#sysRow('fields', f.id);
    } else {
      return undefined;
    }
    if (Object.keys(values).length) this.#metaSync(() => this.updateEntity(made.id, values));
    return this.getEntity(made.id);
  }

  #interceptUpdate(e, db, valuesByName) {
    if (!db.system || this.#inMetaSync) return undefined;
    const patch = { ...valuesByName };
    if (db.system === 'fields') {
      const owner = this.#fieldOwner(e.sysId);
      const f = owner?.fields[e.sysId];
      if ('Type' in patch) throw new WeaveError(`'Type' follows the Definition — change the definition, not the label`, 'invalid');
      if ('Table' in patch) {
        const next = patch.Table == null ? null : this.findEntity(this.#sysTable('tables').id, patch.Table)?.id;
        const cur = e.values[this.#sysField(db, 'Table').id] ?? null;
        if (next !== cur) throw new WeaveError('A field cannot move between tables', 'invalid');
        delete patch.Table;
      }
      if ('Name' in patch) {
        this.updateField(owner.id, f.id, { name: patch.Name });
        delete patch.Name;
      }
      if ('Definition' in patch) {
        const def = patch.Definition;
        if (!DEFINABLE_TYPES.includes(f.type)) {
          throw new WeaveError(`A ${f.type} field's shape is edited through the schema verbs, not its Definition`, 'invalid');
        }
        if (!def || def.type !== f.type) {
          throw new WeaveError(`A definition cannot change its type ('${f.type}' → '${def?.type}') — delete the column and create it anew`, 'invalid');
        }
        this.updateField(owner.id, f.id, { config: def.config ?? {} });
        delete patch.Definition;
      }
    } else {
      if (db.system === 'tables' && 'Space' in patch) {
        const spaceF = this.#sysField(db, 'Space');
        const next = patch.Space == null ? null : this.findEntity(this.#sysTable('spaces').id, patch.Space)?.id;
        if (next !== (e.values[spaceF.id] ?? null)) {
          throw new WeaveError('A table cannot move between spaces yet', 'invalid');
        }
        delete patch.Space;
      }
      const structural = {};
      if ('Name' in patch) { structural.name = patch.Name; delete patch.Name; }
      if ('Description' in patch) { structural.description = patch.Description; delete patch.Description; }
      if (Object.keys(structural).length) {
        if (db.system === 'spaces') this.updateSpace(e.sysId, structural);
        else this.updateTable(e.sysId, structural);
      }
    }
    if (Object.keys(patch).length) this.#metaSync(() => this.updateEntity(e.id, patch));
    return this.getEntity(e.id);
  }

  #interceptDelete(e, db, hard) {
    if (!db.system || this.#inMetaSync) return undefined;
    const noun = { spaces: 'space', tables: 'table', fields: 'column' }[db.system];
    if (!hard) {
      throw new WeaveError(`Deleting a ${noun} is not recoverable — pass hard to confirm`, 'invalid');
    }
    if (db.system === 'spaces') this.deleteSpace(e.sysId);
    else if (db.system === 'tables') this.deleteTable(e.sysId);
    else {
      const owner = this.#fieldOwner(e.sysId);
      if (owner && owner.nameFieldId === e.sysId) {
        throw new WeaveError('Cannot delete the Name field', 'invalid');
      }
      if (owner) this.deleteField(owner.id, e.sysId);
      else this.#metaSync(() => this.deleteEntity(e.id, { hard: true })); // orphaned row
    }
    return { id: e.id, purged: true };
  }

  findField(db, ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    if (db.fields[ref]) return db.fields[ref];
    const fields = Object.values(db.fields);
    return fields.find((f) => f.name === ref)
      ?? fields.find((f) => f.name.toLowerCase() === String(ref).toLowerCase());
  }

  getField(dbRef, ref) {
    const db = this.getTable(dbRef);
    const f = this.findField(db, ref);
    if (!f) throw new WeaveError(`Field '${ref}' not found in table '${db.name}'`, 'not-found');
    return f;
  }

  /* A stored `field` definition becomes a real column. Thin by design: the
     definition was validated by the same normaliser addField runs, so this
     cannot be asked to create a field addField would refuse. The binding —
     how a Fields row names the table it lands on — is the caller's business
     (Feature #52); this is only the act. */
  materializeField(dbRef, name, def) {
    if (!def || typeof def !== 'object' || !def.type) {
      throw new WeaveError(`'${name}' has no definition to materialize`, 'invalid');
    }
    return this.addField(dbRef, { name, type: def.type, config: def.config ?? {} });
  }

  addField(dbRef, { name, type, config = {} }) {
    const db = this.getTable(dbRef);
    if (!name) throw new WeaveError('Field name is required', 'invalid');
    if (this.findField(db, name)) throw new WeaveError(`Field '${name}' already exists`, 'conflict');
    if (!FIELD_TYPES.includes(type)) throw new WeaveError(`Unknown field type '${type}'`, 'invalid');
    if (type === 'relation') throw new WeaveError(`Use addRelation() to create relation fields`, 'invalid');

    const field = { id: uuid(), name, type, config: {} };
    if (type === 'select' || type === 'multiselect' || type === 'workflow' || type === 'field' || type === 'number' || type === 'date') {
      // One normaliser, shared with `field` value validation — see the note on
      // normalizeSelfContainedConfig. If these drift, a definition can describe
      // a field addField would reject.
      field.config = normalizeSelfContainedConfig(type, config);
      if (type === 'workflow' && !field.config.states.some((s) => s.default)) {
        field.config.states[0].default = true;
      }
    } else if (type === 'lookup') {
      const rel = this.getField(db.id, config.relationField ?? config.relation);
      if (rel.type !== 'relation') throw new WeaveError('Lookup must point at a relation field', 'invalid');
      const target = this.getField(rel.config.targetDb, config.targetField);
      field.config = { relationField: rel.id, targetField: target.id };
    } else if (type === 'rollup') {
      const rel = this.getField(db.id, config.relationField ?? config.relation);
      if (rel.type !== 'relation') throw new WeaveError('Rollup must point at a relation field', 'invalid');
      const aggregate = config.aggregate ?? 'count';
      if (!AGGREGATES.includes(aggregate)) throw new WeaveError(`Invalid aggregate '${aggregate}' (use ${AGGREGATES.join(', ')})`, 'invalid');
      let targetFieldId = null;
      if (aggregate !== 'count') {
        const target = this.getField(rel.config.targetDb, config.targetField);
        targetFieldId = target.id;
      }
      field.config = { relationField: rel.id, targetField: targetFieldId, aggregate };
    } else if (type === 'formula') {
      if (!config.expression) throw new WeaveError('Formula field needs an expression', 'invalid');
      field.config = { expression: config.expression };
    }
    if (config.default !== undefined && config.default !== null) {
      field.config.default = this.#validateDefault(field, config.default);
    }

    db.fields[field.id] = field;
    db.fieldOrder.push(field.id);
    this.save();
    this.#syncFieldRow(db, field);
    if (!db.system) this.#audit('field-added', { table: db.name, name: field.name, type: field.type });
    return field;
  }

  addRelation(dbRef, { name, targetDb, cardinality = 'many-to-one', inverseName }) {
    const db = this.getTable(dbRef);
    const target = this.getTable(targetDb);
    if (!name) throw new WeaveError('Relation field name is required', 'invalid');
    if (this.findField(db, name)) throw new WeaveError(`Field '${name}' already exists`, 'conflict');
    const cards = {
      'many-to-one': { thisMany: false, targetMany: true },   // Task.Project ← Project.Tasks
      'one-to-many': { thisMany: true, targetMany: false },   // Project.Tasks → Task.Project
      'many-to-many': { thisMany: true, targetMany: true },
      'one-to-one': { thisMany: false, targetMany: false },
    };
    const card = cards[cardinality];
    if (!card) throw new WeaveError(`Invalid cardinality '${cardinality}'`, 'invalid');
    const invName = inverseName ?? db.name + (card.targetMany ? 's' : '');
    if (this.findField(target, invName)) throw new WeaveError(`Field '${invName}' already exists in target table`, 'conflict');

    const a = { id: uuid(), name, type: 'relation', config: { targetDb: target.id, many: card.thisMany } };
    const b = { id: uuid(), name: invName, type: 'relation', config: { targetDb: db.id, many: card.targetMany } };
    a.config.inverseFieldId = b.id;
    b.config.inverseFieldId = a.id;
    db.fields[a.id] = a;
    db.fieldOrder.push(a.id);
    target.fields[b.id] = b;
    target.fieldOrder.push(b.id);
    this.save();
    this.#syncFieldRow(db, a);
    this.#syncFieldRow(target, b);
    if (!db.system) this.#audit('relation-added', { table: db.name, name: a.name, target: target.name });
    return { field: a, inverse: b };
  }

  updateField(dbRef, fieldRef, patch) {
    const db = this.getTable(dbRef);
    const field = this.getField(db.id, fieldRef);
    if (patch.name != null) {
      if (field.id === db.nameFieldId) throw new WeaveError('Cannot rename the Name field', 'invalid');
      field.name = patch.name;
    }
    if (patch.config) {
      // Column width belongs to every field type, so it is handled before the
      // type switch — and independently of it, so a resize cannot clobber a
      // select's options and an options edit cannot reset the width. null is
      // the auto-fit reset: back to letting the column size itself.
      if ('width' in patch.config) {
        const width = patch.config.width;
        if (width === null) delete field.config.width;
        else if (typeof width !== 'number' || !Number.isFinite(width) || width < MIN_COLUMN_WIDTH) {
          throw new WeaveError(`Column width must be a number of at least ${MIN_COLUMN_WIDTH}px`, 'invalid');
        } else field.config.width = Math.round(width);
      }
      // The default rides alongside the type config for the same reason width
      // does: editing one must not clobber the other. null clears it.
      if ('default' in patch.config) {
        if (patch.config.default === null) delete field.config.default;
        else field.config.default = this.#validateDefault(field, patch.config.default);
      }
      if (field.type === 'number') {
        // Merge the costume keys through the same validation addField runs;
        // absent keys keep their value, width/default ride their own lanes.
        const costume = normalizeSelfContainedConfig('number', { ...field.config, ...patch.config });
        for (const k of ['format', 'unit', 'decimals', 'separator']) {
          if (k in patch.config || k in costume) {
            if (costume[k] == null) delete field.config[k];
            else field.config[k] = costume[k];
          }
        }
      }
      if (field.type === 'date') {
        const costume = normalizeSelfContainedConfig('date', { ...field.config, ...patch.config });
        for (const k of ['format', 'time']) {
          if (k in patch.config || k in costume) {
            if (costume[k] == null) delete field.config[k];
            else field.config[k] = costume[k];
          }
        }
      }
      if (field.type === 'select' || field.type === 'multiselect') {
        if (patch.config.options) {
          field.config.options = patch.config.options.map((o) =>
            typeof o === 'string' ? { id: slug(o), name: o, color: '' } : { id: o.id ?? slug(o.name), name: o.name, color: o.color ?? '' });
        }
      } else if (field.type === 'formula') {
        if (patch.config.expression) field.config.expression = patch.config.expression;
      } else if (field.type === 'workflow') {
        if (patch.config.states) {
          const states = patch.config.states.map((s) =>
            typeof s === 'string' ? { id: slug(s), name: s, category: 'in-progress', default: false }
              : { id: s.id ?? slug(s.name), name: s.name, category: s.category ?? 'in-progress', default: !!s.default });
          if (!states.some((s) => s.default) && states.length) states[0].default = true;
          field.config.states = states;
        }
      }
    }
    this.#syncFieldRow(db, field);
    this.save();
    if (!db.system) this.#audit('field-updated', { table: db.name, name: field.name, patch: Object.keys(patch) });
    return field;
  }

  deleteField(dbRef, fieldRef) {
    const db = this.getTable(dbRef);
    const field = this.getField(db.id, fieldRef);
    if (field.id === db.nameFieldId) throw new WeaveError('Cannot delete the Name field', 'invalid');
    if (field.system) throw new WeaveError(`Field '${field.name}' is part of the system registry`, 'invalid');
    if (field.type === 'relation') {
      // Unlink all values first so inverse sides stay consistent, then drop both ends.
      for (const e of this.listEntities(db.id)) {
        if (e.values[field.id] != null) this.#setRelationValue(e, db, field, []);
      }
      const other = this.state.tables[field.config.targetDb];
      if (other) this.#removeFieldRaw(other, field.config.inverseFieldId);
    }
    // Drop dependent computed fields.
    for (const f of Object.values(db.fields)) {
      if ((f.type === 'lookup' || f.type === 'rollup') && f.config.relationField === field.id) {
        this.#removeFieldRaw(db, f.id);
      }
    }
    this.#removeFieldRaw(db, field.id);
    this.#dropFieldRow(field.id);
    if (field.type === 'relation' && field.config.inverseFieldId) this.#dropFieldRow(field.config.inverseFieldId);
    this.save();
    if (!db.system) this.#audit('field-deleted', { table: db.name, name: field.name });
  }

  #removeFieldRaw(db, fieldId) {
    if (!db.fields[fieldId]) return;
    delete db.fields[fieldId];
    db.fieldOrder = db.fieldOrder.filter((id) => id !== fieldId);
    for (const e of this.listEntities(db.id)) {
      delete e.values[fieldId];
      if (e.docs) delete e.docs[fieldId];
      this.#mark(e);
    }
  }

  // Document fields on a table, in field order. The first one is the default.
  documentFields(db) {
    return db.fieldOrder.map((id) => db.fields[id]).filter((f) => f.type === 'document');
  }

  #resolveDocField(db, fieldRef = null) {
    if (fieldRef == null) {
      const first = this.documentFields(db)[0];
      if (!first) throw new WeaveError(`Table '${db.name}' has no document field`, 'not-found');
      return first;
    }
    const f = this.findField(db, fieldRef);
    if (!f || f.type !== 'document') throw new WeaveError(`'${fieldRef}' is not a document field of '${db.name}'`, 'invalid');
    return f;
  }

  // ---------------- entities ----------------

  /* Soft-deleted rows keep their id, publicId, values, documents and relation
     links — they are simply not "in the table" any more. Every read that means
     "the rows of this table" goes through here, so the trash is invisible by
     default and opting back into it is one explicit flag. */
  listEntities(dbId, { includeDeleted = false } = {}) {
    return Object.values(this.state.entities)
      .filter((e) => e.dbId === dbId && (includeDeleted || !e.deletedAt));
  }

  // The deleted rows of one table, or of the whole workspace when ref is null.
  listTrash(dbRef = null) {
    const dbId = dbRef == null ? null : this.getTable(dbRef).id;
    return Object.values(this.state.entities)
      .filter((e) => e.deletedAt && (dbId == null || e.dbId === dbId))
      .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
      .map((e) => this.readEntity(e.id));
  }

  // A relation target that is still live. Deleted targets keep their link (so
  // restore is lossless) but must not be seen by anything reading through it.
  #liveEntity(id) {
    const e = this.state.entities[id];
    return e && !e.deletedAt ? e : null;
  }

  getEntity(id) {
    const e = this.state.entities[id];
    if (e) return e;
    // 'Table#12' / 'Space/Table#12' refs work everywhere an id does.
    const m = /^(.+)#(\d+)$/.exec(String(id));
    if (m && this.findTable(m[1])) {
      const found = this.findEntity(m[1], '#' + m[2]);
      if (found) return found;
    }
    throw new WeaveError(`Entity '${id}' not found`, 'not-found');
  }

  findEntity(dbRef, ref) {
    // ref: entity object, entity id, public id (number or '#12'), or exact name
    if (ref && typeof ref === 'object') ref = ref.id;
    if (this.state.entities[ref]) return this.state.entities[ref];
    const db = this.getTable(dbRef);
    const list = this.listEntities(db.id);
    // Qualified 'Table#12' / 'Space/Table#12' refs resolve everywhere else
    // (getEntity, REST, mentions); relation targets must match (Issue #21).
    // The named table must BE the target table — 'Task#1' offered to an Issue
    // relation falls through to name matching rather than resolving by pid.
    const q = /^(.+)#(\d+)$/.exec(String(ref));
    if (q) {
      const qt = this.findTable(q[1]);
      if (qt && qt.id === db.id) {
        const byPid = list.find((e) => String(e.publicId) === q[2]);
        if (byPid) return byPid;
      }
    }
    const pid = String(ref).replace(/^#/, '');
    if (/^\d+$/.test(pid)) {
      const byPid = list.find((e) => String(e.publicId) === pid);
      if (byPid) return byPid;
    }
    return list.find((e) => this.entityName(e) === ref)
      ?? list.find((e) => this.entityName(e).toLowerCase() === String(ref).toLowerCase());
  }

  entityName(e) {
    const db = this.state.tables[e.dbId];
    return String(e.values[db.nameFieldId] ?? '');
  }

  createEntity(dbRef, input = {}, { depth = 0 } = {}) {
    const db = this.getTable(dbRef);
    const meta = this.#interceptCreate(db, input);
    if (meta) return meta;
    // Create must be as forgiving as update (Issue #33). updateEntity takes
    // values by name and the REST layer hands it `body.values ?? body`, so a
    // flat {Name, Estimate} object is the shape callers reach for first.
    // Reading only `input.values` turned that into a 201 with an empty row —
    // silent data loss, and how Feature #66 ended up blank. Anything that is
    // not a documented key is a value; a misspelled field still fails loudly
    // in #applyValues rather than vanishing.
    const flat = Object.fromEntries(
      Object.entries(input).filter(([k]) => !CREATE_INPUT_KEYS.has(k)));
    const values = { ...flat, ...(input.values ?? {}) };
    if (input.name != null && values.Name == null) values.Name = input.name;
    const e = {
      id: uuid(),
      dbId: db.id,
      publicId: ++db.publicIdCounter,
      values: {},
      docs: {},
      comments: [],
      activity: [],
      files: [],
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: this.actor,
      modifiedBy: this.actor,
    };
    // Initial documents: input.doc fills the default document field;
    // input.docs maps document field names to markdown.
    if (input.doc) {
      const f = this.#resolveDocField(db);
      e.docs[f.id] = String(input.doc);
    }
    for (const [fieldName, md] of Object.entries(input.docs ?? {})) {
      const f = this.#resolveDocField(db, fieldName);
      e.docs[f.id] = String(md);
    }
    /* Where a new row starts: a workflow's default state, and every other
       field's configured default — but only for fields this create did not
       name. Naming a field is a choice, including naming it empty. */
    const named = new Set();
    for (const key of Object.keys(values)) {
      const f = this.findField(db, key);
      if (f) named.add(f.id);
    }
    for (const f of Object.values(db.fields)) {
      if (f.type === 'workflow') {
        e.values[f.id] = f.config.states.find((s) => s.default)?.id ?? f.config.states[0].id;
      } else if (f.config?.default !== undefined && !named.has(f.id)) {
        e.values[f.id] = f.config.default;
      }
    }
    this.state.entities[e.id] = e;
    this.#logActivity(e, 'created', {});
    try {
      this.#applyValues(e, db, values, { depth, isCreate: true });
    } catch (err) {
      // Atomic create: roll back the partial entity (unlink any relations set so far).
      for (const field of Object.values(db.fields)) {
        if (field.type === 'relation' && e.values[field.id] != null) {
          this.#setRelationValue(e, db, field, []);
        }
      }
      delete this.state.entities[e.id];
      db.publicIdCounter--;
      throw err;
    }
    // Recorded before automations run, so their edits sit above the create on
    // the undo stack and step back first.
    this.#recordUndo('create', e);
    this.#runAutomations(db, e, { type: 'entity-created' }, depth);
    this.save();
    return e;
  }

  updateEntity(id, valuesByName, { depth = 0 } = {}) {
    const e = this.getEntity(id);
    const db = this.state.tables[e.dbId];
    const meta = this.#interceptUpdate(e, db, valuesByName);
    if (meta) return meta;
    const before = this.#undoBefore(e, db, Object.keys(valuesByName));
    this.#applyValues(e, db, valuesByName, { depth });
    if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
    this.save();
    return e;
  }

  #applyValues(e, db, valuesByName, { depth = 0, isCreate = false } = {}) {
    for (const [key, raw] of Object.entries(valuesByName)) {
      const field = this.findField(db, key);
      if (!field) throw new WeaveError(`Field '${key}' not found in table '${db.name}'`, 'not-found');
      if (COMPUTED_TYPES.includes(field.type)) {
        throw new WeaveError(`Field '${field.name}' is computed (${field.type}) and cannot be written`, 'invalid');
      }
      if (field.type === 'relation') {
        const ids = this.#normalizeRelationInput(field, raw);
        this.#setRelationValue(e, db, field, ids);
        continue;
      }
      if (field.type === 'workflow') {
        this.#setStateInternal(e, db, field, raw, depth);
        continue;
      }
      if (field.type === 'document') {
        const md = String(raw ?? '');
        const before = e.docs[field.id] ?? '';
        if (before === md) continue;
        e.docs[field.id] = md;
        e.updatedAt = nowISO();
        e.modifiedBy = this.actor;
        if (!isCreate) this.#logActivity(e, 'doc-updated', docChange(field.name, before, md));
        continue;
      }
      const val = this.#validateValue(field, raw);
      if (field.type === 'attachments') {
        // A column can only name the entity's OWN files — a foreign id would
        // be a pointer nobody can follow from here.
        for (const id of val) {
          if (!e.files.some((x) => x.id === id)) {
            throw new WeaveError(`'${id}' is not a file on this entity — upload it here first`, 'invalid');
          }
        }
      }
      const old = e.values[field.id];
      if (JSON.stringify(old) === JSON.stringify(val)) continue;
      e.values[field.id] = val;
      e.updatedAt = nowISO();
      e.modifiedBy = this.actor;
      if (!isCreate) this.#logActivity(e, 'field-updated', { field: field.name, from: old ?? null, to: val });
      this.#runAutomations(db, e, { type: 'field-updated', fieldId: field.id }, depth);
    }
  }

  /* A default is a value, so it is validated by the field that will hold it —
     the same call the row itself goes through, at definition time instead of
     write time. Types with nothing to default say so: a computed field has no
     value of its own, a document starts empty, a relation points at rows that
     do not exist yet, and a workflow already has a default state. */
  #validateDefault(field, raw) {
    if (!DEFAULTABLE_TYPES.includes(field.type)) {
      throw new WeaveError(`A ${field.type} field cannot carry a default value`, 'invalid');
    }
    return this.#validateValue(field, raw);
  }

  #validateValue(field, raw) {
    if (raw == null || raw === '') return field.type === 'checkbox' ? false : null;
    switch (field.type) {
      case 'text':
        return String(raw);
      case 'url':
      case 'email': {
        const s = String(raw);
        if (field.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
          throw new WeaveError(`'${s}' is not a valid email`, 'invalid');
        }
        return s;
      }
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new WeaveError(`'${raw}' is not a number`, 'invalid');
        return n;
      }
      case 'date': {
        if (Number.isNaN(Date.parse(raw))) throw new WeaveError(`'${raw}' is not a valid date`, 'invalid');
        return String(raw);
      }
      case 'daterange': {
        const { start, end } = raw;
        if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
          throw new WeaveError('Date range needs valid start and end', 'invalid');
        }
        return { start, end };
      }
      case 'checkbox':
        return Boolean(raw);
      case 'select': {
        const opt = this.#findOption(field.config.options, raw);
        if (!opt) throw new WeaveError(`'${raw}' is not an option of '${field.name}'`, 'invalid');
        return opt.id;
      }
      case 'multiselect': {
        const arr = Array.isArray(raw) ? raw : [raw];
        return arr.map((r) => {
          const opt = this.#findOption(field.config.options, r);
          if (!opt) throw new WeaveError(`'${r}' is not an option of '${field.name}'`, 'invalid');
          return opt.id;
        });
      }
      case 'field':
        // The value IS a field definition. Validated by the same normaliser
        // addField uses, so it can only ever describe a creatable field.
        return normalizeDefinition(raw, field.config.depth ?? 1);
      case 'key':
        // Only the NAME is a value; the secret stays in the keystore (#64).
        // An unknown name is storable on purpose — set the secret before or
        // after, the cell shows which state you are in.
        return String(raw);
      case 'attachments': {
        // An array of file ids. Whose files they are is checked at apply
        // time, where the entity is known (#applyValues).
        const arr = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
        return arr.map((r) => String(r && typeof r === 'object' ? r.id : r));
      }
      default:
        throw new WeaveError(`Cannot write field type '${field.type}'`, 'invalid');
    }
  }

  #findOption(options, ref) {
    return options.find((o) => o.id === ref)
      ?? options.find((o) => o.name === ref)
      ?? options.find((o) => o.name.toLowerCase() === String(ref).toLowerCase());
  }

  #normalizeRelationInput(field, raw) {
    const arr = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    return arr.map((r) => {
      const target = this.findEntity(field.config.targetDb, r);
      if (!target) throw new WeaveError(`Related entity '${r}' not found`, 'not-found');
      if (target.dbId !== field.config.targetDb) throw new WeaveError(`Entity '${r}' is not in the related table`, 'invalid');
      return target.id;
    });
  }

  #setRelationValue(e, db, field, newIds) {
    if (!field.config.many && newIds.length > 1) {
      throw new WeaveError(`Field '${field.name}' holds a single entity`, 'invalid');
    }
    const oldIds = this.#relationIds(e, field);
    const removed = oldIds.filter((id) => !newIds.includes(id));
    const added = newIds.filter((id) => !oldIds.includes(id));
    if (!removed.length && !added.length) return;

    const targetDb = this.state.tables[field.config.targetDb];
    const inverse = targetDb.fields[field.config.inverseFieldId];

    for (const rid of removed) {
      const t = this.state.entities[rid];
      if (t) this.#pluck(t, inverse, e.id);
    }
    for (const rid of added) {
      const t = this.getEntity(rid);
      this.#mark(t); // inverse side changes without its own activity entry
      if (inverse.config.many) {
        const cur = this.#relationIds(t, inverse);
        if (!cur.includes(e.id)) t.values[inverse.id] = [...cur, e.id];
      } else {
        // Steal from the previous holder: t's old single parent loses t.
        const prevHolder = t.values[inverse.id];
        if (prevHolder && prevHolder !== e.id) {
          const p = this.state.entities[prevHolder];
          if (p) this.#pluck(p, field, t.id);
        }
        t.values[inverse.id] = e.id;
      }
    }
    e.values[field.id] = field.config.many ? newIds : (newIds[0] ?? null);
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    this.#logActivity(e, 'relation-updated', {
      field: field.name,
      added: added.map((id) => this.entityName(this.state.entities[id])),
      removed: removed.map((id) => this.state.entities[id] ? this.entityName(this.state.entities[id]) : id),
    });
  }

  #relationIds(e, field) {
    const v = e.values[field.id];
    return v == null ? [] : Array.isArray(v) ? v : [v];
  }

  #pluck(entity, field, removeId) {
    const cur = this.#relationIds(entity, field);
    const next = cur.filter((id) => id !== removeId);
    entity.values[field.id] = field.config.many ? next : (next[0] ?? null);
    entity.updatedAt = nowISO();
    this.#mark(entity);
  }

  link(entityId, fieldRef, targetRefs) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'relation') throw new WeaveError(`Field '${field.name}' is not a relation`, 'invalid');
    const addIds = this.#normalizeRelationInput(field, targetRefs);
    const cur = this.#relationIds(e, field);
    const next = field.config.many ? [...new Set([...cur, ...addIds])] : addIds.slice(-1);
    const before = this.#undoBefore(e, db, [field]);
    this.#setRelationValue(e, db, field, next);
    if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
    this.save();
    return e;
  }

  unlink(entityId, fieldRef, targetRefs) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'relation') throw new WeaveError(`Field '${field.name}' is not a relation`, 'invalid');
    const removeIds = this.#normalizeRelationInput(field, targetRefs);
    const next = this.#relationIds(e, field).filter((id) => !removeIds.includes(id));
    const before = this.#undoBefore(e, db, [field]);
    this.#setRelationValue(e, db, field, next);
    if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
    this.save();
    return e;
  }

  setState(entityId, fieldRef, stateRef, { depth = 0 } = {}) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'workflow') throw new WeaveError(`Field '${field.name}' is not a workflow`, 'invalid');
    const before = this.#undoBefore(e, db, [field]);
    this.#setStateInternal(e, db, field, stateRef, depth);
    if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
    this.save();
    return e;
  }

  #setStateInternal(e, db, field, stateRef, depth) {
    const state = field.config.states.find((s) => s.id === stateRef)
      ?? field.config.states.find((s) => s.name === stateRef)
      ?? field.config.states.find((s) => s.name.toLowerCase() === String(stateRef).toLowerCase());
    if (!state) throw new WeaveError(`'${stateRef}' is not a state of '${field.name}'`, 'invalid');
    const old = e.values[field.id];
    if (old === state.id) return;
    e.values[field.id] = state.id;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    const oldName = field.config.states.find((s) => s.id === old)?.name ?? null;
    this.#logActivity(e, 'state-changed', { field: field.name, from: oldName, to: state.name });
    this.#runAutomations(db, e, { type: 'state-changed', fieldId: field.id, toStateId: state.id }, depth);
  }

  /* Recoverable by default. `hard` is the irreversible opt-in: it unlinks the
     relations (so the inverse sides stay consistent) and drops the row. A soft
     delete deliberately leaves the links in place — restoring has to give back
     exactly what was deleted. */
  deleteEntity(id, { hard = false } = {}) {
    const e = this.getEntity(id);
    {
      const db = this.state.tables[e.dbId];
      const meta = this.#interceptDelete(e, db, hard);
      if (meta) return meta;
    }
    const db = this.state.tables[e.dbId];
    if (!hard) {
      if (e.deletedAt) return this.readEntity(id); // already in the trash
      e.deletedAt = nowISO();
      e.updatedAt = e.deletedAt;
      e.activity.push({ ts: e.deletedAt, kind: 'deleted', detail: {} });
      this.#recordUndo('delete', e);
      this.#mark(e);
      this.save();
      return this.readEntity(id);
    }
    // Unlink every relation so inverse sides stay consistent.
    for (const field of Object.values(db.fields)) {
      if (field.type === 'relation' && e.values[field.id] != null) {
        this.#setRelationValue(e, db, field, []);
      }
    }
    delete this.state.entities[id];
    this.#mark(id); // absent from state at save time → row delete
    this.save();
    return { id, purged: true };
  }

  restoreEntity(id) {
    const e = this.getEntity(id);
    if (!e.deletedAt) return this.readEntity(id);
    e.deletedAt = null;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    e.activity.push({ ts: e.updatedAt, kind: 'restored', detail: {} });
    this.#recordUndo('restore', e);
    this.#mark(e);
    this.save();
    return this.readEntity(id);
  }

  // ---------------- computed values ----------------

  resolveField(e, fieldRef, depth = 0) {
    const db = this.state.tables[e.dbId];
    const field = this.findField(db, fieldRef);
    if (!field) {
      if (fieldRef === 'createdAt' || fieldRef === 'Created At') return e.createdAt;
      if (fieldRef === 'updatedAt' || fieldRef === 'Updated At') return e.updatedAt;
      if (fieldRef === 'publicId' || fieldRef === 'Public Id') return e.publicId;
      throw new WeaveError(`Field '${fieldRef}' not found in table '${db.name}'`, 'not-found');
    }
    return this.#resolve(e, db, field, depth);
  }

  #resolve(e, db, field, depth) {
    if (depth > MAX_COMPUTE_DEPTH) return null;
    switch (field.type) {
      case 'relation':
        // Deleted targets stay linked in storage but are never read back out.
        return this.#relationIds(e, field).filter((id) => this.#liveEntity(id));
      case 'lookup': {
        const rel = db.fields[field.config.relationField];
        const targetDb = this.state.tables[rel.config.targetDb];
        const targetField = targetDb.fields[field.config.targetField];
        const vals = this.#relationIds(e, rel)
          .map((id) => this.#liveEntity(id))
          .filter(Boolean)
          .map((t) => this.#resolve(t, targetDb, targetField, depth + 1));
        return rel.config.many ? vals : (vals[0] ?? null);
      }
      case 'rollup': {
        const rel = db.fields[field.config.relationField];
        const targetDb = this.state.tables[rel.config.targetDb];
        const related = this.#relationIds(e, rel).map((id) => this.#liveEntity(id)).filter(Boolean);
        if (field.config.aggregate === 'count') return related.length;
        const targetField = targetDb.fields[field.config.targetField];
        const vals = related.map((t) => this.#resolve(t, targetDb, targetField, depth + 1));
        const display = vals.map((v) => this.#displayValue(targetDb, targetField, v));
        const nums = vals.map(Number).filter(Number.isFinite);
        switch (field.config.aggregate) {
          case 'sum': return nums.reduce((a, b) => a + b, 0);
          case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          case 'min': return nums.length ? Math.min(...nums) : null;
          case 'max': return nums.length ? Math.max(...nums) : null;
          case 'join': return display.filter((v) => v != null && v !== '').join(', ');
        }
        return null;
      }
      case 'formula': {
        try {
          return evaluate(field.config.expression, (name) => {
            const f = this.findField(db, name);
            if (!f) {
              if (name === 'PublicId') return e.publicId;
              throw new WeaveError(`Formula references unknown field '${name}'`, 'invalid');
            }
            const v = this.#resolve(e, db, f, depth + 1);
            // Numbers stay numbers in formulas — the display costume (#97)
            // would turn '$1,200.50' * 2 into NaN. Everything else keeps its
            // display form (state and option names, joined relations).
            return typeof v === 'number' ? v : this.#displayValue(db, f, v, e);
          });
        } catch (err) {
          return `#ERR: ${err.message}`;
        }
      }
      case 'document':
        return e.docs?.[field.id] ?? '';
      default:
        return e.values[field.id] ?? (field.type === 'checkbox' ? false : null);
    }
  }

  // Human-readable value: option/state names, entity names for relations.
  #displayValue(db, field, resolved, e = null) {
    if (resolved == null) return null;
    switch (field.type) {
      case 'select':
        return this.#findOption(field.config.options, resolved)?.name ?? resolved;
      case 'multiselect':
        return resolved.map((id) => this.#findOption(field.config.options, id)?.name ?? id);
      case 'workflow':
        return field.config.states.find((s) => s.id === resolved)?.name ?? resolved;
      case 'field': {
        // A definition should read as a sentence in a grid cell, not as JSON.
        const n = resolved.config?.options?.length ?? resolved.config?.states?.length ?? 0;
        const unit = resolved.config?.states ? 'state' : 'option';
        return n ? `${resolved.type} · ${n} ${unit}${n === 1 ? '' : 's'}` : resolved.type;
      }
      case 'key':
        // The name and whether the keystore holds it — never the secret.
        return `🔑 ${resolved}${this.hasKey(resolved) ? '' : ' (unset)'}`;
      case 'attachments': {
        if (!Array.isArray(resolved) || !resolved.length) return null;
        const names = resolved.map((id) => e?.files?.find((x) => x.id === id)?.name ?? '(missing)');
        return names.join(', ');
      }
      case 'date': {
        const c = field.config;
        if (!c.format && !c.time) return resolved;
        const d = new Date(resolved);
        if (Number.isNaN(d.getTime())) return resolved;
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        // Format on the stored wall-clock parts, not the local zone's reading
        // of them — '2026-08-21' must never render as Aug 20.
        const [datePart, timePart] = String(resolved).split('T');
        const [y, mo, day] = datePart.split('-').map(Number);
        const dateText = c.format === 'us' ? `${mo}/${day}/${y}`
          : c.format === 'eu' ? `${day}.${mo}.${y}`
          : c.format === 'long' ? `${MONTHS[mo - 1]} ${day}, ${y}`
          : datePart;
        const timeText = c.time && timePart ? ' ' + timePart.slice(0, 5) : '';
        return dateText + timeText;
      }
      case 'number': {
        const c = field.config;
        if (c.format == null && c.unit == null && c.decimals == null && !c.separator) return resolved;
        let n = Number(resolved);
        let text = c.decimals != null ? n.toFixed(c.decimals) : String(n);
        if (c.separator) {
          const [int, frac] = text.split('.');
          text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
        }
        if (c.format === 'percent') return `${text}%`;
        if (c.format === 'currency') return `${c.unit ?? '$'}${text}`;
        return c.unit ? `${text} ${c.unit}` : text;
      }
      case 'relation': {
        const names = resolved.map((id) => {
          const t = this.state.entities[id];
          return t ? this.entityName(t) : id;
        });
        return field.config.many ? names : (names[0] ?? null);
      }
      default:
        return resolved;
    }
  }

  // Full materialized read: everything by field name, display values + raw.
  readEntity(id) {
    const e = this.getEntity(id);
    const db = this.state.tables[e.dbId];
    const fields = {};
    const raw = {};
    for (const fid of db.fieldOrder) {
      const f = db.fields[fid];
      const resolved = this.#resolve(e, db, f, 0);
      raw[f.name] = resolved;
      if (f.type === 'relation') {
        const summaries = resolved.map((rid) => this.#summary(rid)).filter(Boolean);
        fields[f.name] = f.config.many ? summaries : (summaries[0] ?? null);
      } else {
        fields[f.name] = this.#displayValue(db, f, resolved, e);
      }
    }
    const docs = {};
    for (const f of this.documentFields(db)) docs[f.name] = e.docs?.[f.id] ?? '';
    const defaultDocField = this.documentFields(db)[0];
    return {
      id: e.id,
      publicId: e.publicId,
      db: this.qualifiedName(db),
      dbId: db.id,
      name: this.entityName(e),
      fields,
      raw,
      doc: defaultDocField ? (e.docs?.[defaultDocField.id] ?? '') : '',
      docs,
      comments: e.comments,
      activity: e.activity,
      files: e.files,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      createdBy: e.createdBy ?? null,
      modifiedBy: e.modifiedBy ?? null,
      deletedAt: e.deletedAt ?? null,
    };
  }

  #summary(id) {
    const e = this.state.entities[id];
    if (!e) return null;
    const db = this.state.tables[e.dbId];
    return { id: e.id, publicId: e.publicId, name: this.entityName(e), db: this.qualifiedName(db) };
  }

  // ---------------- query ----------------

  // where: [ [path, op, value], ... ] AND-combined, or { or:[...] } / { and:[...] } nodes.
  query(dbRef, { where = [], sort = [], limit = null, offset = 0, select = null, includeDeleted = false } = {}) {
    const db = this.getTable(dbRef);
    let rows = this.listEntities(db.id, { includeDeleted });
    if (where && (Array.isArray(where) ? where.length : true)) {
      rows = rows.filter((e) => this.#matchNode(e, db, Array.isArray(where) ? { and: where } : where));
    }
    for (const s of [...sort].reverse()) {
      const { field, dir = 'asc' } = typeof s === 'string' ? { field: s } : s;
      const mul = dir === 'desc' ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const av = this.#pathValue(a, db, field);
        const bv = this.#pathValue(b, db, field);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
        return String(av).localeCompare(String(bv)) * mul;
      });
    }
    const total = rows.length;
    rows = rows.slice(offset, limit != null ? offset + limit : undefined);
    const items = rows.map((e) => {
      if (!select) return this.readEntity(e.id);
      const out = { id: e.id, publicId: e.publicId, name: this.entityName(e) };
      for (const path of select) out[path] = this.#pathValue(e, db, path);
      return out;
    });
    return { total, items };
  }

  #matchNode(e, db, node) {
    if (Array.isArray(node)) return this.#matchCondition(e, db, node);
    if (node.and) return node.and.every((n) => this.#matchNode(e, db, n));
    if (node.or) return node.or.some((n) => this.#matchNode(e, db, n));
    throw new WeaveError('Invalid where node', 'invalid');
  }

  #matchCondition(e, db, [path, op, value]) {
    const v = this.#pathValue(e, db, path);
    const list = Array.isArray(v) ? v : [v];
    switch (op) {
      case '=': return list.some((x) => this.#looseEq(x, value));
      case '!=': return !list.some((x) => this.#looseEq(x, value));
      case '<': return list.some((x) => x != null && x < value);
      case '<=': return list.some((x) => x != null && x <= value);
      case '>': return list.some((x) => x != null && x > value);
      case '>=': return list.some((x) => x != null && x >= value);
      case 'contains':
        return list.some((x) => String(x ?? '').toLowerCase().includes(String(value).toLowerCase()));
      case 'in':
        return list.some((x) => (Array.isArray(value) ? value : [value]).some((y) => this.#looseEq(x, y)));
      case 'is-empty':
        return v == null || v === '' || (Array.isArray(v) && v.length === 0);
      case 'not-empty':
        return !(v == null || v === '' || (Array.isArray(v) && v.length === 0));
      default:
        throw new WeaveError(`Unknown operator '${op}'`, 'invalid');
    }
  }

  #looseEq(a, b) {
    return a === b || String(a) === String(b);
  }

  // Path: 'Field' or 'Relation.Field' (any hops). Returns display values.
  #pathValue(e, db, path) {
    const parts = String(path).split('.');
    let current = [{ e, db }];
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const next = [];
      const results = [];
      for (const { e: ce, db: cdb } of current) {
        // `id` alongside publicId: asking for a known set of rows by identity
        // is what an embedded related grid does, and a name can collide.
        if (parts[i] === 'id') { results.push(ce.id); continue; }
        if (parts[i] === 'publicId' || parts[i] === 'Public Id') { results.push(ce.publicId); continue; }
        if (parts[i] === 'createdAt') { results.push(ce.createdAt); continue; }
        if (parts[i] === 'updatedAt') { results.push(ce.updatedAt); continue; }
        const f = this.findField(cdb, parts[i]);
        if (!f) throw new WeaveError(`Field '${parts[i]}' not found in table '${cdb.name}'`, 'not-found');
        const resolved = this.#resolve(ce, cdb, f, 0);
        if (isLast) {
          results.push(this.#displayValue(cdb, f, resolved));
        } else {
          if (f.type !== 'relation') throw new WeaveError(`'${parts[i]}' is not a relation; cannot traverse`, 'invalid');
          const tdb = this.state.tables[f.config.targetDb];
          for (const rid of resolved) {
            const t = this.#liveEntity(rid);
            if (t) next.push({ e: t, db: tdb });
          }
        }
      }
      if (isLast) {
        const flat = results.flatMap((r) => (Array.isArray(r) ? r : [r]));
        return parts.length === 1 && !Array.isArray(results[0]) && results.length === 1 ? results[0]
          : flat.length === 1 ? flat[0] : flat;
      }
      current = next;
      if (!current.length) return null;
    }
    return null;
  }

  // ---------------- documents ----------------

  // field is optional everywhere: default = the table's first document field.
  getDoc(entityId, fieldRef = null) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const f = this.#resolveDocField(db, fieldRef);
    return e.docs?.[f.id] ?? '';
  }

  setDoc(entityId, markdown, fieldRef = null) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const f = this.#resolveDocField(db, fieldRef);
    e.docs = e.docs ?? {};
    const before = e.docs[f.id] ?? '';
    const after = String(markdown ?? '');
    // Autosave writes on every pause, so identical text arrives often. Nothing
    // changed, nothing happened: no timestamp bump and no entry in the feed.
    if (before === after) return e;
    e.docs[f.id] = after;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    this.#logActivity(e, 'doc-updated', docChange(f.name, before, after));
    this.#recordUndo('update', e, { before: { values: {}, docs: { [f.id]: before } } });
    this.save();
    return e;
  }

  appendDoc(entityId, markdown, fieldRef = null) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const f = this.#resolveDocField(db, fieldRef);
    e.docs = e.docs ?? {};
    const before = e.docs[f.id] ?? '';
    const after = (before ? before.replace(/\n*$/, '\n\n') : '') + String(markdown ?? '');
    if (before === after) return e;
    e.docs[f.id] = after;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    this.#logActivity(e, 'doc-appended', docChange(f.name, before, after));
    this.#recordUndo('update', e, { before: { values: {}, docs: { [f.id]: before } } });
    this.save();
    return e;
  }

  // ---------------- comments & activity ----------------

  addComment(entityId, { author = 'anonymous', text }) {
    if (!text) throw new WeaveError('Comment text is required', 'invalid');
    const e = this.getEntity(entityId);
    const comment = { id: uuid(), author, text, createdAt: nowISO() };
    e.comments.push(comment);
    this.#logActivity(e, 'comment-added', { author });
    this.#recordUndo('comment-add', e, { commentId: comment.id });
    this.save();
    return comment;
  }

  deleteComment(entityId, commentId) {
    const e = this.getEntity(entityId);
    const removed = e.comments.find((c) => c.id === commentId);
    e.comments = e.comments.filter((c) => c.id !== commentId);
    if (removed) this.#recordUndo('comment-delete', e, { comment: removed });
    this.#mark(e);
    this.save();
  }

  /* ---------------- the workspace Activity table ----------------
     Activity is a SYSTEM table: a fixed shape nobody can redefine, no rows
     anyone writes by hand. It is a read over the history every entity already
     carries, so the workspace feed and an entity's own list can never drift
     apart — they are the same rows, filtered differently. The id is
     `<entityId>:<index>`, which makes a single event addressable as a link. */
  activityFeed({ entityId = null, tableRef = null, kinds = null, since = null, limit = null, offset = 0 } = {}) {
    const wanted = kinds?.length ? new Set(kinds) : null;
    const dbId = tableRef ? this.getTable(tableRef).id : null;
    const rows = [];
    for (const e of Object.values(this.state.entities)) {
      if (entityId && e.id !== entityId) continue;
      if (dbId && e.dbId !== dbId) continue;
      const db = this.state.tables[e.dbId];
      (e.activity ?? []).forEach((a, i) => {
        if (wanted && !wanted.has(a.kind)) return;
        if (since && a.ts < since) return;
        rows.push({
          id: `${e.id}:${i}`,
          ts: a.ts,
          kind: a.kind,
          actor: a.actor ?? null,
          detail: a.detail ?? {},
          entityId: e.id,
          entityName: this.entityName(e),
          publicId: e.publicId,
          dbId: e.dbId,
          db: db ? this.qualifiedName(db) : null,
          space: db ? (this.state.spaces[db.spaceId]?.name ?? null) : null,
          deleted: !!e.deletedAt,
        });
      });
    }
    // Same-millisecond events (an entity created with a document writes two)
    // fall back to the index, so the later one still reads as the later one.
    rows.sort((x, y) => (x.ts === y.ts ? y.id.localeCompare(x.id) : (x.ts < y.ts ? 1 : -1)));
    return {
      total: rows.length,
      items: limit == null ? rows.slice(offset) : rows.slice(offset, offset + limit),
    };
  }

  getActivity(id) {
    const at = String(id).lastIndexOf(':');
    const entityId = String(id).slice(0, at);
    const index = Number(String(id).slice(at + 1));
    const e = this.state.entities[entityId];
    const a = e?.activity?.[index];
    if (!a) throw new WeaveError(`Activity '${id}' not found`, 'not-found');
    return this.activityFeed({ entityId }).items.find((r) => r.id === `${entityId}:${index}`);
  }

  #logActivity(e, kind, detail) {
    // One editing session is one entry: autosave flushes every pause, and a
    // row per pause is a keystroke log (Issue #32). A doc-updated landing
    // right after another doc-updated for the same field folds into it,
    // keeping the session's starting length so delta spans the whole session.
    // Mutating in place (not pop+push) preserves entityId:index activity ids.
    const last = e.activity[e.activity.length - 1];
    if (kind === 'doc-updated' && last?.kind === 'doc-updated'
      && last.detail?.field === detail.field
      && Date.now() - Date.parse(last.ts) < 10 * 60 * 1000) {
      last.ts = nowISO();
      last.detail = { ...detail, prevLength: last.detail.prevLength, delta: detail.length - last.detail.prevLength };
      this.#mark(e);
      return;
    }
    e.activity.push({ ts: nowISO(), kind, detail, actor: this.actor });
    if (e.activity.length > 500) e.activity = e.activity.slice(-500);
    this.#mark(e);
  }

  // ---------------- automations ----------------

  createAutomation(dbRef, { name, trigger, actions, enabled = true }) {
    const db = this.getTable(dbRef);
    if (!trigger?.type || !['entity-created', 'field-updated', 'state-changed'].includes(trigger.type)) {
      throw new WeaveError(`Invalid automation trigger`, 'invalid');
    }
    const t = { type: trigger.type };
    if (trigger.type !== 'entity-created') {
      const f = this.getField(db.id, trigger.field);
      t.fieldId = f.id;
      if (trigger.type === 'state-changed' && trigger.toState) {
        const st = f.config.states.find((s) => s.id === trigger.toState || s.name === trigger.toState);
        if (!st) throw new WeaveError(`Unknown state '${trigger.toState}'`, 'invalid');
        t.toStateId = st.id;
      }
    }
    const acts = (actions ?? []).map((a) => {
      if (a.type === 'set-field') {
        const f = this.getField(db.id, a.field);
        return { type: 'set-field', fieldId: f.id, value: a.value };
      }
      if (a.type === 'append-doc') {
        const act = { type: 'append-doc', text: String(a.text ?? '') };
        if (a.field) act.fieldId = this.#resolveDocField(db, a.field).id;
        return act;
      }
      if (a.type === 'add-comment') return { type: 'add-comment', text: String(a.text ?? ''), author: a.author ?? 'automation' };
      if (a.type === 'webhook') {
        if (!/^https?:\/\//.test(a.url ?? '')) throw new WeaveError('Webhook action needs an http(s) url', 'invalid');
        return { type: 'webhook', url: a.url };
      }
      throw new WeaveError(`Unknown automation action '${a.type}'`, 'invalid');
    });
    if (!acts.length) throw new WeaveError('Automation needs at least one action', 'invalid');
    const auto = { id: uuid(), dbId: db.id, name: name ?? 'Automation', trigger: t, actions: acts, enabled };
    this.state.automations[auto.id] = auto;
    this.save();
    return auto;
  }

  listAutomations(dbRef = null) {
    const all = Object.values(this.state.automations);
    if (!dbRef) return all;
    const db = this.getTable(dbRef);
    return all.filter((a) => a.dbId === db.id);
  }

  // Human/agent-readable automation descriptions (field ids → names).
  // Powers the relation map's automation layer.
  describeAutomations(dbRef = null) {
    return this.listAutomations(dbRef).map((auto) => {
      const db = this.state.tables[auto.dbId];
      const fieldName = (fid) => db?.fields[fid]?.name ?? null;
      const trigger = { type: auto.trigger.type };
      if (auto.trigger.fieldId) trigger.field = fieldName(auto.trigger.fieldId);
      if (auto.trigger.toStateId && auto.trigger.fieldId) {
        trigger.toState = db.fields[auto.trigger.fieldId]?.config.states
          ?.find((s) => s.id === auto.trigger.toStateId)?.name ?? null;
      }
      return {
        id: auto.id,
        name: auto.name,
        table: db ? this.qualifiedName(db) : null,
        tableId: auto.dbId,
        enabled: auto.enabled,
        trigger,
        actions: auto.actions.map((a) => {
          if (a.type === 'set-field') return { type: a.type, field: fieldName(a.fieldId) };
          if (a.type === 'append-doc') return { type: a.type, field: a.fieldId ? fieldName(a.fieldId) : 'Description' };
          if (a.type === 'webhook') return { type: a.type, url: a.url };
          return { type: a.type };
        }),
      };
    });
  }

  updateAutomation(id, patch) {
    const auto = this.state.automations[id];
    if (!auto) throw new WeaveError(`Automation '${id}' not found`, 'not-found');
    if (patch.enabled != null) auto.enabled = patch.enabled;
    if (patch.name != null) auto.name = patch.name;
    this.save();
    return auto;
  }

  deleteAutomation(id) {
    delete this.state.automations[id];
    this.save();
  }

  #runAutomations(db, e, event, depth) {
    if (depth >= 3) return;
    for (const auto of Object.values(this.state.automations)) {
      if (!auto.enabled || auto.dbId !== db.id) continue;
      const t = auto.trigger;
      if (t.type !== event.type) continue;
      if (t.fieldId && t.fieldId !== event.fieldId) continue;
      if (t.toStateId && t.toStateId !== event.toStateId) continue;
      for (const action of auto.actions) {
        if (action.type === 'set-field') {
          const f = db.fields[action.fieldId];
          if (f) {
            const before = this.#undoBefore(e, db, [f]);
            this.#applyValues(e, db, { [f.name]: action.value }, { depth: depth + 1 });
            if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
          }
        } else if (action.type === 'append-doc') {
          const docField = db.fields[action.fieldId] ?? this.documentFields(db)[0];
          if (docField) {
            e.docs = e.docs ?? {};
            const cur = e.docs[docField.id] ?? '';
            this.#recordUndo('update', e, { before: { values: {}, docs: { [docField.id]: cur } } });
            e.docs[docField.id] = (cur ? cur.replace(/\n*$/, '\n\n') : '') + this.#template(action.text, e, db);
            e.updatedAt = nowISO();
            e.modifiedBy = this.actor;
          }
        } else if (action.type === 'add-comment') {
          const comment = { id: uuid(), author: action.author, text: this.#template(action.text, e, db), createdAt: nowISO() };
          e.comments.push(comment);
          this.#recordUndo('comment-add', e, { commentId: comment.id });
        } else if (action.type === 'webhook') {
          // Fire and forget; a dead endpoint must never block a mutation.
          const payload = {
            event: event.type,
            workspace: this.state.meta.name,
            entity: this.#summary(e.id),
            automation: auto.name,
            at: nowISO(),
          };
          fetch(action.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => {});
        }
      }
      this.#logActivity(e, 'automation-ran', { name: auto.name });
    }
  }

  #template(text, e, db) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, name) => {
      const key = name.trim();
      if (key === 'PublicId') return String(e.publicId);
      if (key === 'Today') return new Date().toISOString().slice(0, 10);
      const f = this.findField(db, key);
      if (!f) return '';
      const v = this.#displayValue(db, f, this.#resolve(e, db, f, 0), e);
      return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
    });
  }

  // ---------------- search ----------------

  search(text, { limit = 25 } = {}) {
    const needle = String(text).toLowerCase();
    if (!needle) return [];
    const results = [];
    for (const e of Object.values(this.state.entities)) {
      if (e.deletedAt) continue; // the trash is not searchable
      const name = this.entityName(e);
      const docText = Object.values(e.docs ?? {}).join('\n');
      const comments = e.comments.map((c) => c.text).join('\n');
      let score = 0;
      let snippet = '';
      if (name.toLowerCase().includes(needle)) score += 10;
      const hay = docText + '\n' + comments;
      const idx = hay.toLowerCase().indexOf(needle);
      if (idx >= 0) {
        score += 5;
        snippet = hay.slice(Math.max(0, idx - 40), idx + needle.length + 40).replace(/\n+/g, ' ').trim();
      }
      if (score > 0) results.push({ ...this.#summary(e.id), score, snippet });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Universal search across everything addressable, with stable permalinks.
  // Kinds: workspace, space, table, entity.
  universalSearch(text, { limit = 25, prefix = '' } = {}) {
    const needle = String(text).toLowerCase().trim();
    if (!needle) return [];
    const results = [];
    if (this.state.meta.name.toLowerCase().includes(needle)) {
      results.push({ kind: 'workspace', id: 'workspace', name: this.state.meta.name, url: prefix + '/', score: 8 });
    }
    for (const sp of this.listSpaces()) {
      if (sp.name.toLowerCase().includes(needle)) {
        results.push({ kind: 'space', id: sp.id, name: sp.name, url: `${prefix}/#/space/${sp.id}`, score: 9 });
      }
    }
    for (const db of this.listTables()) {
      if (db.name.toLowerCase().includes(needle) || this.qualifiedName(db).toLowerCase().includes(needle)) {
        results.push({
          kind: 'table', id: db.id, name: this.qualifiedName(db),
          url: `${prefix}/#/table/${db.id}`, entityCount: this.listEntities(db.id).length, score: 9,
        });
      }
    }
    for (const hit of this.search(text, { limit })) {
      results.push({ kind: 'entity', url: `${prefix}/e/${hit.id}`, ...hit });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ---------------- files ----------------

  // Attach a file to an entity. bytes is a Buffer (or base64 string). Blobs are
  // stored on disk next to the workspace file, or inline when in-memory.
  attachFile(entityId, { name, mime = 'application/octet-stream', bytes }) {
    const e = this.getEntity(entityId);
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'base64');
    const file = { id: uuid(), name: String(name), size: buf.length, mime, createdAt: nowISO() };
    if (this.store.path) {
      const dir = join(dirname(this.store.path), 'files');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file.id), buf);
    } else {
      this.state.fileBlobs = this.state.fileBlobs ?? {};
      this.state.fileBlobs[file.id] = buf.toString('base64');
    }
    e.files.push(file);
    this.#logActivity(e, 'file-attached', { name: file.name });
    this.#recordUndo('file-attach', e, { fileId: file.id });
    this.save();
    return file;
  }

  /* Upload a file and put it in an attachments column in one motion —
     the flow every surface actually wants (Feature #16). */
  attachToField(entityId, fieldRef, fileInput) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'attachments') throw new WeaveError(`Field '${field.name}' is not an attachments field`, 'invalid');
    const file = this.attachFile(e.id, fileInput);
    const cur = Array.isArray(e.values[field.id]) ? e.values[field.id] : [];
    this.updateEntity(e.id, { [field.name]: [...cur, file.id] });
    return file;
  }

  readFile(fileId) {
    for (const e of Object.values(this.state.entities)) {
      const meta = e.files.find((f) => f.id === fileId);
      if (!meta) continue;
      if (this.store.path) {
        const p = join(dirname(this.store.path), 'files', fileId);
        if (!existsSync(p)) throw new WeaveError('File blob missing', 'not-found');
        return { meta, bytes: readFileSync(p) };
      }
      const b64 = this.state.fileBlobs?.[fileId];
      if (b64 == null) throw new WeaveError('File blob missing', 'not-found');
      return { meta, bytes: Buffer.from(b64, 'base64') };
    }
    throw new WeaveError(`File '${fileId}' not found`, 'not-found');
  }

  // Workspace-level logo (shown in the workspace-selector chip). Stored like
  // entity file blobs; the descriptor lives on meta so it persists with the
  // schema rows. Becomes a real field once workspace-as-table lands.
  setWorkspaceLogo({ name, mime = 'image/png', bytes }) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'base64');
    if (this.state.meta.logo) this.deleteWorkspaceLogo();
    const logo = { id: uuid(), name: String(name), size: buf.length, mime, createdAt: nowISO() };
    if (this.store.path) {
      const dir = join(dirname(this.store.path), 'files');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, logo.id), buf);
    } else {
      this.state.fileBlobs = this.state.fileBlobs ?? {};
      this.state.fileBlobs[logo.id] = buf.toString('base64');
    }
    this.state.meta.logo = logo;
    this.save();
    return logo;
  }

  getWorkspaceLogo() {
    const logo = this.state.meta.logo;
    if (!logo) throw new WeaveError('Workspace has no logo', 'not-found');
    if (this.store.path) {
      const p = join(dirname(this.store.path), 'files', logo.id);
      if (!existsSync(p)) throw new WeaveError('Logo blob missing', 'not-found');
      return { meta: logo, bytes: readFileSync(p) };
    }
    const b64 = this.state.fileBlobs?.[logo.id];
    if (b64 == null) throw new WeaveError('Logo blob missing', 'not-found');
    return { meta: logo, bytes: Buffer.from(b64, 'base64') };
  }

  deleteWorkspaceLogo() {
    const logo = this.state.meta.logo;
    if (!logo) return;
    if (this.state.fileBlobs) delete this.state.fileBlobs[logo.id];
    delete this.state.meta.logo;
    this.save();
  }

  deleteFile(entityId, fileId) {
    const e = this.getEntity(entityId);
    e.files = e.files.filter((f) => f.id !== fileId);
    // No ghost pointers: an attachments column loses the file with the file.
    const db = this.state.tables[e.dbId];
    for (const f of Object.values(db.fields)) {
      if (f.type === 'attachments' && Array.isArray(e.values[f.id]) && e.values[f.id].includes(fileId)) {
        e.values[f.id] = e.values[f.id].filter((id) => id !== fileId);
      }
    }
    if (this.state.fileBlobs) delete this.state.fileBlobs[fileId];
    this.#mark(e);
    this.save();
  }

  // ---------------- CSV import ----------------

  importCSV(dbRef, csvText) {
    const db = this.getTable(dbRef);
    const rows = parseCSV(csvText);
    if (!rows.length) return { created: 0 };
    const header = rows[0];
    const skip = new Set(['Public Id', 'Created At', 'Updated At', 'publicId', 'createdAt', 'updatedAt']);
    const writable = header.map((name) => {
      if (skip.has(name)) return null;
      const f = this.findField(db, name);
      if (!f || ['lookup', 'rollup', 'formula'].includes(f.type)) return null;
      return f;
    });
    let created = 0;
    const errors = [];
    for (const row of rows.slice(1)) {
      if (row.every((c) => c === '')) continue;
      const values = {};
      writable.forEach((f, i) => {
        if (!f || row[i] === '' || row[i] == null) return;
        let v = row[i];
        if (f.type === 'multiselect' || (f.type === 'relation' && f.config.many)) {
          v = v.split(';').map((s) => s.trim()).filter(Boolean);
        } else if (f.type === 'checkbox') {
          v = ['true', '1', 'yes', '✓', 'x'].includes(v.toLowerCase());
        }
        values[f.name] = v;
      });
      try {
        this.createEntity(db, { values });
        created++;
      } catch (err) {
        errors.push({ row: created + errors.length + 2, error: err.message });
      }
    }
    return { created, errors };
  }

  // ---------------- schema description & export ----------------

  describeSchema() {
    return this.listSpaces().map((sp) => ({
      space: sp.name,
      spaceId: sp.id,
      description: sp.description ?? '',
      ...(sp.system ? { system: sp.system } : {}),
      ...(sp.icon ? { icon: sp.icon } : {}),
      tables: this.listTables(sp.id).map((db) => ({
        id: db.id,
        name: db.name,
        description: db.description ?? '',
        ...(db.system ? { system: db.system } : {}),
        ...(db.icon ? { icon: db.icon } : {}),
        ...(db.systemFields?.length ? { systemFields: [...db.systemFields] } : {}),
        ...(db.noun ? { noun: db.noun } : {}),
        qualified: this.qualifiedName(db),
        entityCount: this.listEntities(db.id).length,
        fields: db.fieldOrder.map((fid) => {
          const f = db.fields[fid];
          const out = { id: f.id, name: f.name, type: f.type };
          if (f.config.width) out.width = f.config.width;
          if (f.type === 'select' || f.type === 'multiselect') {
            out.options = f.config.options.map((o) => o.name);
            // The field dialog edits colors and must round-trip ids so a
            // rename keeps the option's identity. `options` stays plain
            // names for every existing consumer.
            out.optionsFull = f.config.options.map((o) => ({ id: o.id, name: o.name, color: o.color ?? '' }));
          }
          if (f.type === 'workflow') out.states = f.config.states.map((s) => ({ id: s.id, name: s.name, category: s.category, default: !!s.default }));
          if (f.type === 'relation') {
            const target = this.state.tables[f.config.targetDb];
            out.targetDb = this.qualifiedName(target);
            out.targetDbId = target.id;
            out.many = f.config.many;
            out.inverseFieldId = f.config.inverseFieldId;
            out.inverseField = target.fields[f.config.inverseFieldId]?.name ?? null;
          }
          if (f.type === 'lookup' || f.type === 'rollup') {
            const rel = db.fields[f.config.relationField];
            out.via = rel?.name;
            if (f.config.targetField) {
              const tdb = this.state.tables[rel.config.targetDb];
              out.targetField = tdb.fields[f.config.targetField]?.name;
            }
            if (f.type === 'rollup') out.aggregate = f.config.aggregate;
          }
          if (f.type === 'number') {
            for (const k of ['format', 'unit', 'decimals', 'separator']) {
              if (f.config[k] != null) out[k] = f.config[k];
            }
          }
          if (f.type === 'date') {
            if (f.config.format) out.format = f.config.format;
            if (f.config.time) out.time = true;
          }
          if (f.type === 'formula') out.expression = f.config.expression;
          if (f.type === 'field') { out.types = [...f.config.types]; out.depth = f.config.depth; }
          if (f.config?.default !== undefined) out.default = f.config.default;
          return out;
        }),
      })),
    }));
  }

  exportJSON() {
    return JSON.parse(JSON.stringify(this.state));
  }

  importJSON(state) {
    if (!state || ![1, 2].includes(state.version)) throw new WeaveError('Unsupported workspace format', 'invalid');
    this.state = JSON.parse(JSON.stringify(state));
    this.#migrate();
    this.#ensureMetaTables();
    this.#dirtyAll = true;
    this.save();
  }

  exportCSV(dbRef) {
    const db = this.getTable(dbRef);
    const fieldNames = db.fieldOrder.map((fid) => db.fields[fid].name);
    const header = ['Public Id', ...fieldNames, 'Created At', 'Updated At'];
    const esc = (v) => {
      if (v == null) return '';
      const s = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.name : x)).join('; ') : typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.map(esc).join(',')];
    for (const e of this.listEntities(db.id)) {
      const read = this.readEntity(e.id);
      lines.push([e.publicId, ...fieldNames.map((n) => read.fields[n]), e.createdAt, e.updatedAt].map(esc).join(','));
    }
    return lines.join('\n') + '\n';
  }
}
