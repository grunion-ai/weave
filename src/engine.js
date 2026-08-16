import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

const VALUE_TYPES = ['text', 'number', 'date', 'daterange', 'checkbox', 'url', 'email', 'select', 'multiselect', 'workflow', 'relation'];
const COMPUTED_TYPES = ['lookup', 'rollup', 'formula'];
export const FIELD_TYPES = [...VALUE_TYPES, ...COMPUTED_TYPES, 'document'];
const STATE_CATEGORIES = ['not-started', 'in-progress', 'done', 'canceled'];
const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'join'];
const MAX_COMPUTE_DEPTH = 8;

export { WeaveError };

function nowISO() {
  return new Date().toISOString();
}

export class Weave {
  // Entity ids mutated since the last save — the store flushes only these
  // rows. An id missing from state at save time means "delete the row".
  #dirty = new Set();
  #dirtyAll = false;

  constructor({ path = null } = {}) {
    this.store = new Store(path);
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
    if (patch.name != null) s.name = patch.name;
    if (patch.description != null) s.description = patch.description;
    this.save();
    return s;
  }

  deleteSpace(ref) {
    const s = this.getSpace(ref);
    for (const db of this.listTables(s.id)) this.deleteTable(db.id);
    delete this.state.spaces[s.id];
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
    this.save();
    return db;
  }

  deleteTable(ref) {
    const db = this.getTable(ref);
    for (const e of this.listEntities(db.id)) this.deleteEntity(e.id);
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
    delete this.state.tables[db.id];
    this.save();
  }

  // ---------------- fields ----------------

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

  addField(dbRef, { name, type, config = {} }) {
    const db = this.getTable(dbRef);
    if (!name) throw new WeaveError('Field name is required', 'invalid');
    if (this.findField(db, name)) throw new WeaveError(`Field '${name}' already exists`, 'conflict');
    if (!FIELD_TYPES.includes(type)) throw new WeaveError(`Unknown field type '${type}'`, 'invalid');
    if (type === 'relation') throw new WeaveError(`Use addRelation() to create relation fields`, 'invalid');

    const field = { id: uuid(), name, type, config: {} };
    if (type === 'select' || type === 'multiselect') {
      field.config.options = (config.options ?? []).map((o) =>
        typeof o === 'string' ? { id: slug(o), name: o, color: '' } : { id: o.id ?? slug(o.name), name: o.name, color: o.color ?? '' });
    } else if (type === 'workflow') {
      const states = (config.states ?? []).map((s) =>
        typeof s === 'string' ? { id: slug(s), name: s, category: 'in-progress', default: false }
          : { id: s.id ?? slug(s.name), name: s.name, category: s.category ?? 'in-progress', default: !!s.default });
      if (states.length === 0) throw new WeaveError('Workflow field needs at least one state', 'invalid');
      for (const s of states) {
        if (!STATE_CATEGORIES.includes(s.category)) {
          throw new WeaveError(`Invalid state category '${s.category}' (use ${STATE_CATEGORIES.join(', ')})`, 'invalid');
        }
      }
      if (!states.some((s) => s.default)) states[0].default = true;
      field.config.states = states;
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

    db.fields[field.id] = field;
    db.fieldOrder.push(field.id);
    this.save();
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
    this.save();
    return field;
  }

  deleteField(dbRef, fieldRef) {
    const db = this.getTable(dbRef);
    const field = this.getField(db.id, fieldRef);
    if (field.id === db.nameFieldId) throw new WeaveError('Cannot delete the Name field', 'invalid');
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
    this.save();
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
    const values = { ...(input.values ?? {}) };
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
    // Default workflow states.
    for (const f of Object.values(db.fields)) {
      if (f.type === 'workflow') {
        e.values[f.id] = f.config.states.find((s) => s.default)?.id ?? f.config.states[0].id;
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
    this.#runAutomations(db, e, { type: 'entity-created' }, depth);
    this.save();
    return e;
  }

  updateEntity(id, valuesByName, { depth = 0 } = {}) {
    const e = this.getEntity(id);
    const db = this.state.tables[e.dbId];
    this.#applyValues(e, db, valuesByName, { depth });
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
        if ((e.docs[field.id] ?? '') === md) continue;
        e.docs[field.id] = md;
        e.updatedAt = nowISO();
        if (!isCreate) this.#logActivity(e, 'doc-updated', { field: field.name, length: md.length });
        continue;
      }
      const val = this.#validateValue(field, raw);
      const old = e.values[field.id];
      if (JSON.stringify(old) === JSON.stringify(val)) continue;
      e.values[field.id] = val;
      e.updatedAt = nowISO();
      if (!isCreate) this.#logActivity(e, 'field-updated', { field: field.name, from: old ?? null, to: val });
      this.#runAutomations(db, e, { type: 'field-updated', fieldId: field.id }, depth);
    }
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
    this.#setRelationValue(e, db, field, next);
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
    this.#setRelationValue(e, db, field, next);
    this.save();
    return e;
  }

  setState(entityId, fieldRef, stateRef, { depth = 0 } = {}) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'workflow') throw new WeaveError(`Field '${field.name}' is not a workflow`, 'invalid');
    this.#setStateInternal(e, db, field, stateRef, depth);
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
    const db = this.state.tables[e.dbId];
    if (!hard) {
      if (e.deletedAt) return this.readEntity(id); // already in the trash
      e.deletedAt = nowISO();
      e.updatedAt = e.deletedAt;
      e.activity.push({ ts: e.deletedAt, kind: 'deleted', detail: {} });
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
    e.activity.push({ ts: e.updatedAt, kind: 'restored', detail: {} });
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
            return this.#displayValue(db, f, v);
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
  #displayValue(db, field, resolved) {
    if (resolved == null) return null;
    switch (field.type) {
      case 'select':
        return this.#findOption(field.config.options, resolved)?.name ?? resolved;
      case 'multiselect':
        return resolved.map((id) => this.#findOption(field.config.options, id)?.name ?? id);
      case 'workflow':
        return field.config.states.find((s) => s.id === resolved)?.name ?? resolved;
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
        fields[f.name] = this.#displayValue(db, f, resolved);
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
    e.docs[f.id] = String(markdown ?? '');
    e.updatedAt = nowISO();
    this.#logActivity(e, 'doc-updated', { field: f.name, length: e.docs[f.id].length });
    this.save();
    return e;
  }

  appendDoc(entityId, markdown, fieldRef = null) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const f = this.#resolveDocField(db, fieldRef);
    e.docs = e.docs ?? {};
    const cur = e.docs[f.id] ?? '';
    e.docs[f.id] = (cur ? cur.replace(/\n*$/, '\n\n') : '') + String(markdown ?? '');
    e.updatedAt = nowISO();
    this.#logActivity(e, 'doc-appended', { field: f.name, length: e.docs[f.id].length });
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
    this.save();
    return comment;
  }

  deleteComment(entityId, commentId) {
    const e = this.getEntity(entityId);
    e.comments = e.comments.filter((c) => c.id !== commentId);
    this.#mark(e);
    this.save();
  }

  #logActivity(e, kind, detail) {
    e.activity.push({ ts: nowISO(), kind, detail });
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
          if (f) this.#applyValues(e, db, { [f.name]: action.value }, { depth: depth + 1 });
        } else if (action.type === 'append-doc') {
          const docField = db.fields[action.fieldId] ?? this.documentFields(db)[0];
          if (docField) {
            e.docs = e.docs ?? {};
            const cur = e.docs[docField.id] ?? '';
            e.docs[docField.id] = (cur ? cur.replace(/\n*$/, '\n\n') : '') + this.#template(action.text, e, db);
            e.updatedAt = nowISO();
          }
        } else if (action.type === 'add-comment') {
          e.comments.push({ id: uuid(), author: action.author, text: this.#template(action.text, e, db), createdAt: nowISO() });
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
      const v = this.#displayValue(db, f, this.#resolve(e, db, f, 0));
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
    this.save();
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
      tables: this.listTables(sp.id).map((db) => ({
        id: db.id,
        name: db.name,
        description: db.description ?? '',
        qualified: this.qualifiedName(db),
        entityCount: this.listEntities(db.id).length,
        fields: db.fieldOrder.map((fid) => {
          const f = db.fields[fid];
          const out = { id: f.id, name: f.name, type: f.type };
          if (f.type === 'select' || f.type === 'multiselect') out.options = f.config.options.map((o) => o.name);
          if (f.type === 'workflow') out.states = f.config.states.map((s) => ({ name: s.name, category: s.category, default: !!s.default }));
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
          if (f.type === 'formula') out.expression = f.config.expression;
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
