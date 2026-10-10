const SCHEMA = `
CREATE TABLE IF NOT EXISTS weave_meta (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY, db_id TEXT NOT NULL, public_id INTEGER,
  updated_at TEXT, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_entities_db ON entities(db_id);
CREATE INDEX IF NOT EXISTS idx_entities_pid ON entities(db_id, public_id);
CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
  actor TEXT, action TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS undo_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS doc_revisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL, field_id TEXT NOT NULL,
  at TEXT NOT NULL, actor TEXT, text TEXT NOT NULL, len INTEGER NOT NULL, restored_from INTEGER);
CREATE INDEX IF NOT EXISTS idx_doc_revisions ON doc_revisions(entity_id, field_id, seq);
`;

const LOAD_ORDER = {
  automations: " ORDER BY json_extract(json, '$.seq') IS NULL, json_extract(json, '$.seq'), rowid",
};

const UNDO_CAP = 200;
const DOC_REVISION_CAP = 200;

export class CFStore {
  #sql = null;
  #txn = null;
  #cache = null;
  #batch = false;

  constructor(storage) {
    this.#sql = storage.sql;
    this.#txn = (fn) => storage.transactionSync(fn);
    this.path = null;
    this.legacyJsonPath = null;
  }

  #all(query, ...params) {
    return this.#sql.exec(query, ...params).toArray();
  }

  #run(query, ...params) {
    this.#sql.exec(query, ...params);
  }

  load() {
    for (const stmt of SCHEMA.split(';')) {
      if (stmt.trim()) this.#run(stmt);
    }
    try { this.#run('ALTER TABLE doc_revisions ADD COLUMN restored_from INTEGER'); }
    catch (err) { if (!/duplicate column/i.test(err.message)) throw err; }
    this.#run('CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(id UNINDEXED, text)');
    return this.#loadState();
  }

  #loadState() {
    const metaRow = this.#all('SELECT json FROM weave_meta WHERE id = 1')[0];
    if (!metaRow) {
      this.#cache = { meta: null, spaces: new Map(), tables: new Map(), automations: new Map() };
      return null;
    }
    const state = { ...JSON.parse(metaRow.json), spaces: {}, tables: {}, entities: {}, automations: {} };
    const cache = { meta: metaRow.json, spaces: new Map(), tables: new Map(), automations: new Map() };
    for (const key of ['spaces', 'tables', 'automations']) {
      for (const row of this.#all(`SELECT id, json FROM ${key}${LOAD_ORDER[key] ?? ''}`)) {
        state[key][row.id] = JSON.parse(row.json);
        cache[key].set(row.id, row.json);
      }
    }
    for (const row of this.#all('SELECT id, json FROM entities')) {
      state.entities[row.id] = JSON.parse(row.json);
    }
    this.#cache = cache;
    return state;
  }

  batch(fn) {
    if (this.#batch) return fn();
    this.#batch = true;
    try { return this.#txn(fn); }
    catch (err) { this.#loadState(); throw err; }
    finally { this.#batch = false; }
  }

  save(state, { dirty = null, all = false } = {}) {
    this.batch(() => {
      const { spaces, tables, entities, automations, ...rest } = state;
      const metaJson = JSON.stringify(rest);
      if (metaJson !== this.#cache.meta) {
        this.#run('INSERT INTO weave_meta (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json', metaJson);
        this.#cache.meta = metaJson;
      }
      for (const [key, collection] of [['spaces', spaces], ['tables', tables], ['automations', automations]]) {
        const cache = this.#cache[key];
        for (const [id, obj] of Object.entries(collection)) {
          const json = JSON.stringify(obj);
          if (cache.get(id) === json) continue;
          this.#run(`INSERT INTO ${key} (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`, id, json);
          cache.set(id, json);
        }
        for (const id of [...cache.keys()]) {
          if (collection[id] === undefined) {
            this.#run(`DELETE FROM ${key} WHERE id = ?`, id);
            cache.delete(id);
          }
        }
      }
      const ids = all
        ? new Set([...Object.keys(entities), ...this.#all('SELECT id FROM entities').map((r) => r.id)])
        : (dirty ?? new Set());
      for (const id of ids) {
        const e = entities[id];
        if (e === undefined) {
          this.#run('DELETE FROM entities WHERE id = ?', id);
          this.#run('DELETE FROM entities_fts WHERE id = ?', id);
        } else {
          this.#run(`INSERT INTO entities (id, db_id, public_id, updated_at, json) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET db_id = excluded.db_id, public_id = excluded.public_id,
            updated_at = excluded.updated_at, json = excluded.json`,
            e.id, e.dbId, e.publicId ?? null, e.updatedAt ?? null, JSON.stringify(e));
          this.#run('DELETE FROM entities_fts WHERE id = ?', id);
          if (!e.deletedAt) {
            this.#run('INSERT INTO entities_fts (id, text) VALUES (?, ?)', id, this.#ftsText(state, e));
          }
        }
      }
    });
  }

  #ftsText(state, e) {
    const table = state.tables[e.dbId];
    const name = table ? String(e.values?.[table.nameFieldId] ?? '') : '';
    const docs = Object.values(e.docs ?? {}).join('\n');
    const comments = (e.comments ?? []).map((c) => c.text).join('\n');
    return [name, docs, comments].filter(Boolean).join('\n');
  }

  audit(entry) {
    this.#run('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)',
      entry.at, entry.actor, entry.action, JSON.stringify(entry.detail ?? {}));
  }

  setAuditDetail(seq, detail) {
    this.#run('UPDATE audit_log SET detail = ? WHERE seq = ?', JSON.stringify(detail ?? {}), seq);
  }

  listAudit({ limit = 100, offset = 0, actions = null } = {}) {
    const where = actions?.length ? ` WHERE action IN (${actions.map(() => '?').join(', ')})` : '';
    return this.#all(`SELECT seq, at, actor, action, detail FROM audit_log${where} ORDER BY seq DESC LIMIT ? OFFSET ?`, ...(where ? actions : []), limit, offset)
      .map((r) => ({ ...r, detail: JSON.parse(r.detail ?? '{}') }));
  }

  pushUndo(entry) {
    this.#run('INSERT INTO undo_log (json) VALUES (?)', JSON.stringify(entry));
    this.#run('DELETE FROM undo_log WHERE seq <= (SELECT MAX(seq) FROM undo_log) - ?', UNDO_CAP);
  }

  popUndo() {
    const row = this.#all('SELECT seq, json FROM undo_log ORDER BY seq DESC LIMIT 1')[0];
    if (!row) return null;
    this.#run('DELETE FROM undo_log WHERE seq = ?', row.seq);
    return JSON.parse(row.json);
  }

  listUndo({ limit = 20 } = {}) {
    return this.#all('SELECT json FROM undo_log ORDER BY seq DESC LIMIT ?', limit)
      .map((r) => JSON.parse(r.json));
  }

  pushDocRevision({ entityId, fieldId, at, actor = null, text, restoredFrom = null }) {
    this.#run('INSERT INTO doc_revisions (entity_id, field_id, at, actor, text, len, restored_from) VALUES (?, ?, ?, ?, ?, ?, ?)',
      entityId, fieldId, at, actor, text, text.length, restoredFrom);
    const [{ seq }] = this.#all('SELECT MAX(seq) AS seq FROM doc_revisions');
    this.#run(`DELETE FROM doc_revisions WHERE entity_id = ? AND field_id = ? AND seq NOT IN
      (SELECT seq FROM doc_revisions WHERE entity_id = ? AND field_id = ? ORDER BY seq DESC LIMIT ?)`,
    entityId, fieldId, entityId, fieldId, DOC_REVISION_CAP);
    return { seq: Number(seq) };
  }

  replaceDocRevision(seq, { at, text }) {
    this.#run('UPDATE doc_revisions SET at = ?, text = ?, len = ? WHERE seq = ?', at, text, text.length, seq);
  }

  listDocRevisions(entityId, fieldId, { limit = 50 } = {}) {
    return this.#all('SELECT seq, at, actor, len, restored_from AS restoredFrom FROM doc_revisions WHERE entity_id = ? AND field_id = ? ORDER BY seq DESC LIMIT ?', entityId, fieldId, limit);
  }

  getDocRevision(entityId, fieldId, seq) {
    return this.#all('SELECT seq, at, actor, len, restored_from AS restoredFrom, text FROM doc_revisions WHERE seq = ? AND entity_id = ? AND field_id = ?', seq, entityId, fieldId)[0] ?? null;
  }

  deleteDocRevisions(entityId) {
    this.#run('DELETE FROM doc_revisions WHERE entity_id = ?', entityId);
  }

  changedExternally() { return false; }

  reload() { return this.#loadState(); }

  close() {}
}
