import { readFileSync, existsSync, statSync } from 'node:fs';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {}

export class WeaveError extends Error {
  constructor(message, code = 'weave-error') {
    super(message);
    this.code = code;
  }
}

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
export const DOC_REVISION_CAP = 200;

function addRestoredFrom(exec) {
  try { exec('ALTER TABLE doc_revisions ADD COLUMN restored_from INTEGER'); }
  catch (err) { if (!/duplicate column/i.test(err.message)) throw err; }
}

function isWorkspaceShape(data) {
  return data && typeof data === 'object' && data.meta && (data.tables != null || data.databases != null);
}

export class Store {
  #db = null;
  #dataVersion = null;
  #cache = null;

  constructor(path = null) {
    this.legacyJsonPath = null;
    if (path && path.endsWith('.json')) {
      this.legacyJsonPath = path;
      path = path.slice(0, -5) + '.db';
    }
    this.path = path;
  }

  load() {
    if (!this.path) return null;
    if (existsSync(this.path)) return this.#open();
    let legacyState = null;
    if (this.legacyJsonPath && existsSync(this.legacyJsonPath)) {
      try {
        legacyState = JSON.parse(readFileSync(this.legacyJsonPath, 'utf8'));
      } catch {
        throw new WeaveError(`'${this.legacyJsonPath}' is not valid JSON`, 'invalid');
      }
      if (!isWorkspaceShape(legacyState)) {
        throw new WeaveError(`'${this.legacyJsonPath}' is not a Weave workspace file`, 'invalid');
      }
    }
    const state = this.#open();
    if (legacyState && !state) {
      this.save(legacyState, { all: true });
      return this.#loadState();
    }
    return state;
  }

  #open() {
    if (!DatabaseSync) {
      throw new WeaveError(
        `weave requires Node >= 22.16 — node:sqlite is missing in ${process.version}. `
        + 'Upgrade Node (24 LTS recommended) and retry.', 'invalid');
    }
    const existed = existsSync(this.path);
    let db;
    try {
      db = new DatabaseSync(this.path);
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = FULL');
    } catch (err) {
      throw new WeaveError(`'${this.path}' is not a SQLite database (${err.message})`, 'invalid');
    }
    if (existed) {
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      if (names.length && !names.includes('weave_meta')) {
        db.close();
        throw new WeaveError(`'${this.path}' is a SQLite database but not a Weave workspace`, 'invalid');
      }
    }
    db.exec(SCHEMA);
    addRestoredFrom((q) => db.exec(q));
    try {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(id UNINDEXED, text)");
    } catch (err) {
      db.close();
      throw new WeaveError(
        `SQLite FTS5 is unavailable in this Node (${process.version}); weave needs Node >= 22.16 `
        + `(24 LTS recommended). Underlying error: ${err.message}`, 'invalid');
    }
    this.#db = db;
    this.#dataVersion = this.#pragmaDataVersion();
    return this.#loadState();
  }

  #loadState() {
    const db = this.#db;
    const metaRow = db.prepare('SELECT json FROM weave_meta WHERE id = 1').get();
    if (!metaRow) {
      this.#cache = { meta: null, spaces: new Map(), tables: new Map(), automations: new Map() };
      return null;
    }
    const state = { ...JSON.parse(metaRow.json), spaces: {}, tables: {}, entities: {}, automations: {} };
    const cache = { meta: metaRow.json, spaces: new Map(), tables: new Map(), automations: new Map() };
    for (const key of ['spaces', 'tables', 'automations']) {
      for (const row of db.prepare(`SELECT id, json FROM ${key}${LOAD_ORDER[key] ?? ''}`).all()) {
        state[key][row.id] = JSON.parse(row.json);
        cache[key].set(row.id, row.json);
      }
    }
    for (const row of db.prepare('SELECT id, json FROM entities').all()) {
      state.entities[row.id] = JSON.parse(row.json);
    }
    this.#cache = cache;
    return state;
  }

  #memAudit = [];

  audit(entry) {
    if (!this.#db) { this.#memAudit.push({ seq: this.#memAudit.length + 1, ...entry }); return; }
    this.#db.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)')
      .run(entry.at, entry.actor, entry.action, JSON.stringify(entry.detail ?? {}));
  }

  #memUndo = [];

  pushUndo(entry) {
    if (!this.#db) {
      this.#memUndo.push(entry);
      if (this.#memUndo.length > UNDO_CAP) this.#memUndo = this.#memUndo.slice(-UNDO_CAP);
      return;
    }
    this.#db.prepare('INSERT INTO undo_log (json) VALUES (?)').run(JSON.stringify(entry));
    this.#db.prepare('DELETE FROM undo_log WHERE seq <= (SELECT MAX(seq) FROM undo_log) - ?').run(UNDO_CAP);
  }

  popUndo() {
    if (!this.#db) return this.#memUndo.pop() ?? null;
    const row = this.#db.prepare('SELECT seq, json FROM undo_log ORDER BY seq DESC LIMIT 1').get();
    if (!row) return null;
    this.#db.prepare('DELETE FROM undo_log WHERE seq = ?').run(row.seq);
    return JSON.parse(row.json);
  }

  listUndo({ limit = 20 } = {}) {
    if (!this.#db) return this.#memUndo.slice(-limit).reverse();
    return this.#db.prepare('SELECT json FROM undo_log ORDER BY seq DESC LIMIT ?').all(limit)
      .map((r) => JSON.parse(r.json));
  }

  #memRevs = [];
  #memRevSeq = 0;

  pushDocRevision({ entityId, fieldId, at, actor = null, text, restoredFrom = null }) {
    const len = text.length;
    if (!this.#db) {
      const row = { seq: ++this.#memRevSeq, entityId, fieldId, at, actor, text, len, restoredFrom };
      this.#memRevs.push(row);
      const mine = this.#memRevs.filter((r) => r.entityId === entityId && r.fieldId === fieldId);
      if (mine.length > DOC_REVISION_CAP) {
        const drop = new Set(mine.slice(0, mine.length - DOC_REVISION_CAP).map((r) => r.seq));
        this.#memRevs = this.#memRevs.filter((r) => !drop.has(r.seq));
      }
      return { seq: row.seq };
    }
    const { lastInsertRowid } = this.#db.prepare('INSERT INTO doc_revisions (entity_id, field_id, at, actor, text, len, restored_from) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(entityId, fieldId, at, actor, text, len, restoredFrom);
    this.#db.prepare(`DELETE FROM doc_revisions WHERE entity_id = ? AND field_id = ? AND seq NOT IN
      (SELECT seq FROM doc_revisions WHERE entity_id = ? AND field_id = ? ORDER BY seq DESC LIMIT ?)`)
      .run(entityId, fieldId, entityId, fieldId, DOC_REVISION_CAP);
    return { seq: Number(lastInsertRowid) };
  }

  replaceDocRevision(seq, { at, text }) {
    if (!this.#db) {
      const row = this.#memRevs.find((r) => r.seq === seq);
      if (row) Object.assign(row, { at, text, len: text.length });
      return;
    }
    this.#db.prepare('UPDATE doc_revisions SET at = ?, text = ?, len = ? WHERE seq = ?').run(at, text, text.length, seq);
  }

  listDocRevisions(entityId, fieldId, { limit = 50 } = {}) {
    if (!this.#db) {
      return this.#memRevs.filter((r) => r.entityId === entityId && r.fieldId === fieldId)
        .slice(-limit).reverse().map(({ seq, at, actor, len, restoredFrom }) => ({ seq, at, actor, len, restoredFrom }));
    }
    return this.#db.prepare('SELECT seq, at, actor, len, restored_from AS restoredFrom FROM doc_revisions WHERE entity_id = ? AND field_id = ? ORDER BY seq DESC LIMIT ?')
      .all(entityId, fieldId, limit);
  }

  getDocRevision(entityId, fieldId, seq) {
    if (!this.#db) {
      const r = this.#memRevs.find((x) => x.seq === seq && x.entityId === entityId && x.fieldId === fieldId);
      return r ? { seq: r.seq, at: r.at, actor: r.actor, len: r.len, restoredFrom: r.restoredFrom, text: r.text } : null;
    }
    return this.#db.prepare('SELECT seq, at, actor, len, restored_from AS restoredFrom, text FROM doc_revisions WHERE seq = ? AND entity_id = ? AND field_id = ?')
      .get(seq, entityId, fieldId) ?? null;
  }

  deleteDocRevisions(entityId) {
    if (!this.#db) { this.#memRevs = this.#memRevs.filter((r) => r.entityId !== entityId); return; }
    this.#db.prepare('DELETE FROM doc_revisions WHERE entity_id = ?').run(entityId);
  }

  setAuditDetail(seq, detail) {
    if (!this.#db) {
      const row = this.#memAudit.find((r) => r.seq === seq);
      if (row) row.detail = structuredClone(detail);
      return;
    }
    this.#db.prepare('UPDATE audit_log SET detail = ? WHERE seq = ?').run(JSON.stringify(detail ?? {}), seq);
  }

  listAudit({ limit = 100, offset = 0, actions = null } = {}) {
    if (!this.#db) {
      const rows = this.#memAudit.slice().reverse().filter((r) => !actions || actions.includes(r.action));
      return rows.slice(offset, limit < 0 ? undefined : offset + limit)
        .map((r) => ({ ...r, detail: structuredClone(r.detail ?? {}) }));
    }
    const where = actions?.length ? ` WHERE action IN (${actions.map(() => '?').join(', ')})` : '';
    return this.#db.prepare(`SELECT seq, at, actor, action, detail FROM audit_log${where} ORDER BY seq DESC LIMIT ? OFFSET ?`)
      .all(...(where ? actions : []), limit, offset)
      .map((r) => ({ ...r, detail: JSON.parse(r.detail ?? '{}') }));
  }

  save(state, { dirty = null, all = false } = {}) {
    if (!this.path) return;
    if (!this.#db) this.#open();
    const db = this.#db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const { spaces, tables, entities, automations, ...rest } = state;
      const metaJson = JSON.stringify(rest);
      if (metaJson !== this.#cache.meta) {
        db.prepare('INSERT INTO weave_meta (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(metaJson);
        this.#cache.meta = metaJson;
      }
      for (const [key, collection] of [['spaces', spaces], ['tables', tables], ['automations', automations]]) {
        const cache = this.#cache[key];
        for (const [id, obj] of Object.entries(collection)) {
          const json = JSON.stringify(obj);
          if (cache.get(id) === json) continue;
          db.prepare(`INSERT INTO ${key} (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`).run(id, json);
          cache.set(id, json);
        }
        for (const id of [...cache.keys()]) {
          if (collection[id] === undefined) {
            db.prepare(`DELETE FROM ${key} WHERE id = ?`).run(id);
            cache.delete(id);
          }
        }
      }
      const ids = all
        ? new Set([...Object.keys(entities), ...db.prepare('SELECT id FROM entities').all().map((r) => r.id)])
        : (dirty ?? new Set());
      for (const id of ids) {
        const e = entities[id];
        if (e === undefined) {
          db.prepare('DELETE FROM entities WHERE id = ?').run(id);
          db.prepare('DELETE FROM entities_fts WHERE id = ?').run(id);
        } else {
          db.prepare(`INSERT INTO entities (id, db_id, public_id, updated_at, json) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET db_id = excluded.db_id, public_id = excluded.public_id,
            updated_at = excluded.updated_at, json = excluded.json`)
            .run(e.id, e.dbId, e.publicId ?? null, e.updatedAt ?? null, JSON.stringify(e));
          db.prepare('DELETE FROM entities_fts WHERE id = ?').run(id);
          if (!e.deletedAt) {
            db.prepare('INSERT INTO entities_fts (id, text) VALUES (?, ?)').run(id, this.#ftsText(state, e));
          }
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  #ftsText(state, e) {
    const table = state.tables[e.dbId];
    const name = table ? String(e.values?.[table.nameFieldId] ?? '') : '';
    const docs = Object.values(e.docs ?? {}).join('\n');
    const comments = (e.comments ?? []).map((c) => c.text).join('\n');
    return [name, docs, comments].filter(Boolean).join('\n');
  }

  sizeBytes() {
    if (!this.path) return null;
    let total = 0;
    for (const p of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      try { total += statSync(p).size; } catch {}
    }
    return total;
  }

  #pragmaDataVersion() {
    return this.#db.prepare('PRAGMA data_version').get().data_version;
  }

  changedExternally() {
    if (!this.#db) return false;
    const v = this.#pragmaDataVersion();
    const changed = v !== this.#dataVersion;
    this.#dataVersion = v;
    return changed;
  }

  reload() {
    if (!this.#db) return null;
    return this.#loadState();
  }

  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }
}
