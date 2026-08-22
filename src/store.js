import { readFileSync, existsSync } from 'node:fs';

// node:sqlite is the storage engine (zero runtime deps — it ships inside Node).
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  throw new Error(
    `weave requires Node >= 22.16 — node:sqlite is missing in ${process.version}. `
    + 'Upgrade Node (24 LTS recommended) and retry.');
}

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
`;

// The undo stack is bounded: it is a working set, not an archive (the audit
// log is the archive). 200 steps of full before-images stays small.
const UNDO_CAP = 200;

function isWorkspaceShape(data) {
  return data && typeof data === 'object' && data.meta && (data.tables != null || data.databases != null);
}

// SQLite persistence: one workspace = one .db file (WAL, fsync'd, row-level
// writes). A legacy .json path is accepted and auto-migrated to a sibling .db
// on first open — the .json is preserved untouched as a frozen backup and the
// human-readable layer moves to exportJSON(). Pass a null path for a purely
// in-memory store (tests / scratch): no SQLite involved at all.
export class Store {
  #db = null;
  #dataVersion = null;
  #cache = null; // last-written json strings: { meta, spaces:Map, tables:Map, automations:Map }

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
    // Migration source must be validated BEFORE any .db file is created, so a
    // stray package.json can never spawn a workspace beside it.
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
    const existed = existsSync(this.path);
    let db;
    try {
      db = new DatabaseSync(this.path);
      // busy_timeout FIRST: the WAL switch below needs a lock another process
      // may briefly hold during its own boot — without the timeout in place
      // yet, a simultaneous boot dies with "database is locked" (2026-08-21).
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
      for (const row of db.prepare(`SELECT id, json FROM ${key}`).all()) {
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

  // Row-level persistence. `dirty` is the set of entity ids touched since the
  // last save (missing from state = deleted row); `all` forces a full
  // reconcile (migration / importJSON). Schema-side rows (meta, spaces,
  // tables, automations) never grow with data volume, so they are synced by
  // cheap string comparison on every save.
  /* Durable audit trail (Feature #14). SQLite-backed when there is a file;
     an in-memory workspace keeps a plain array so the API is uniform. */
  #memAudit = [];

  audit(entry) {
    if (!this.#db) { this.#memAudit.push({ seq: this.#memAudit.length + 1, ...entry }); return; }
    this.#db.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)')
      .run(entry.at, entry.actor, entry.action, JSON.stringify(entry.detail ?? {}));
  }

  /* Undo stack (same dual backing as the audit trail): SQLite when there is a
     file, a plain array in memory otherwise. Rows are inverse-operation
     payloads owned by the engine; the store only pushes, pops, and caps. */
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

  listAudit({ limit = 100, offset = 0 } = {}) {
    if (!this.#db) {
      return this.#memAudit.slice().reverse().slice(offset, offset + limit)
        .map((r) => ({ ...r, detail: r.detail ?? {} }));
    }
    return this.#db.prepare('SELECT seq, at, actor, action, detail FROM audit_log ORDER BY seq DESC LIMIT ? OFFSET ?')
      .all(limit, offset)
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
          // Soft-deleted rows stay in `entities` (restore needs them) but leave
          // the search index — the trash must not be searchable.
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

  #pragmaDataVersion() {
    return this.#db.prepare('PRAGMA data_version').get().data_version;
  }

  // True when another connection (CLI, another server) committed since we
  // last looked. Own writes never trip it.
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
