(() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const text = (d) => (d == null ? '' : Array.isArray(d) ? d.join(', ') : String(d));

  const PASTEABLE = globalThis.WeaveSelection?.SETTABLE ?? [];

  const UNREADABLE = Symbol('unreadable');
  const TRUE = /^(true|yes|y|1|on|✓|checked)$/i;
  const FALSE = /^(false|no|n|0|off|✗|unchecked)$/i;

  globalThis.WeaveGridRange = {
    PASTEABLE,
    pasteable(type) { return PASTEABLE.includes(type); },

    rect(a, b) {
      return {
        r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c),
        r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c),
      };
    },
    size(x) {
      return x.h != null ? { h: x.h, w: x.w } : { h: x.r1 - x.r0 + 1, w: x.c1 - x.c0 + 1 };
    },
    single(rect) { return rect.r0 === rect.r1 && rect.c0 === rect.c1; },
    has(rect, r, c) { return r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1; },
    cellsOf(rect) {
      const out = [];
      for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) out.push({ r, c });
      return out;
    },

    extend({ anchor, focus, dr = 0, dc = 0, rows, cols }) {
      const a = anchor ?? focus;
      const nr = focus.r + dr, nc = focus.c + dc;
      if (nr < 0 || nr > rows - 1 || nc < 0 || nc > cols - 1) return null;
      return { anchor: a, focus: { r: nr, c: nc } };
    },

    block({ rect, fields, valueAt }) {
      const cells = [];
      for (let r = rect.r0; r <= rect.r1; r++) {
        const row = [];
        for (let c = rect.c0; c <= rect.c1; c++) row.push(valueAt(r, c));
        cells.push(row);
      }
      return {
        h: rect.r1 - rect.r0 + 1,
        w: rect.c1 - rect.c0 + 1,
        fields: fields.slice(rect.c0, rect.c1 + 1),
        cells,
      };
    },

    toTSV(block) {
      return block.cells.map((row) => row.map((cell) => text(cell.d)).join('\t')).join('\n');
    },

    parseTSV(str) {
      if (typeof str !== 'string' || !str.trim()) return null;
      const lines = str.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
      const cells = lines.map((line) => line.split('\t').map((s) => ({ type: null, v: s, d: s })));
      const w = Math.max(...cells.map((row) => row.length));
      for (const row of cells) while (row.length < w) row.push({ type: null, v: '', d: '' });
      return { h: cells.length, w, fields: null, cells };
    },

    target({ rect, block, rows, cols }) {
      const r1 = this.single(rect) ? rect.r0 + block.h - 1 : rect.r1;
      const c1 = this.single(rect) ? rect.c0 + block.w - 1 : rect.c1;
      return { r0: rect.r0, c0: rect.c0, r1: clamp(r1, rect.r0, rows - 1), c1: clamp(c1, rect.c0, cols - 1) };
    },
    at(block, dr, dc) { return block.cells[dr % block.h][dc % block.w]; },

    fillTarget(rect, { r, c }) {
      const dr = r - rect.r1, dc = c - rect.c1;
      if (dr <= 0 && dc <= 0) return null;
      return dr >= dc ? { ...rect, r1: r } : { ...rect, c1: c };
    },

    plan({ block, rect, fields, rowIds, typeOf, optionsOf, relationOf = () => null }) {
      const writes = [], refused = [], unmatched = [];
      let unparsed = 0;
      for (const { r, c } of this.cellsOf(rect)) {
        const field = fields[c], eid = rowIds[r];
        if (field == null || eid == null) continue;
        const type = typeOf(field);
        const rel = type === 'relation' ? relationOf(field) : null;
        if (!this.pasteable(type) && !rel) {
          if (!refused.includes(field)) refused.push(field);
          continue;
        }
        const cell = this.at(block, r - rect.r0, c - rect.c0);
        const value = rel ? relationValue(cell, rel, unmatched) : valueFor(cell, type, optionsOf(field));
        if (value === UNREADABLE) { unparsed += 1; continue; }
        writes.push({ eid, field, value });
      }
      return { writes, refused, unparsed, unmatched };
    },

    resolveRelation({ ids = [], labels = [], rows, many }) {
      const byId = new Map(rows.map((row) => [row.id, row]));
      const byName = new Map(rows.map((row) => [String(row.name ?? '').trim().toLowerCase(), row]));
      const byPid = new Map(rows.map((row) => [`#${row.publicId}`, row]));
      const out = [], unmatched = [];
      for (let i = 0; i < Math.max(ids.length, labels.length); i++) {
        const label = String(labels[i] ?? ids[i] ?? '').trim();
        const row = byId.get(ids[i]) ?? byName.get(label.toLowerCase()) ?? byPid.get(label);
        if (!row) { if (label) unmatched.push(label); continue; }
        if (!out.includes(row.id)) out.push(row.id);
      }
      return { ids: many ? out : out.slice(0, 1), unmatched };
    },

    group(writes) {
      const byRow = new Map();
      for (const w of writes) {
        if (!byRow.has(w.eid)) byRow.set(w.eid, {});
        byRow.get(w.eid)[w.field] = w.value;
      }
      const out = new Map();
      for (const [eid, values] of byRow) {
        const key = JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
        if (!out.has(key)) out.set(key, { ids: [], values });
        out.get(key).ids.push(eid);
      }
      return [...out.values()];
    },

    toast({ verb, cells, refused = [], unparsed = 0, unmatched = [], results = [] }) {
      const failed = results.flatMap((r) => r.failed ?? []);
      const aside = [
        refused.length ? `${refused.join(', ')} cannot take a value` : null,
        unparsed ? `${unparsed} unreadable` : null,
        unmatched.length ? `${unmatched.length} unmatched (${unmatched.join(', ')})` : null,
      ].filter(Boolean).join('; ');
      if (failed.length) {
        return { msg: `${verb.toLowerCase()}: ${failed.length} of ${results.reduce((n, r) => n + (r.done?.length ?? 0), 0) + failed.length} rows failed — ${failed[0].error}`, err: true };
      }
      if (!cells) return { msg: `Nothing ${verb.toLowerCase()}${aside ? ` — ${aside}` : ''}`, err: true };
      return { msg: `${verb} ${cells} cell${cells === 1 ? '' : 's'}${aside ? ` — ${aside}` : ''}`, err: false };
    },
  };


  function relationValue(cell, { rows, many }, unmatched) {
    const list = (x) => (x == null || x === '' ? [] : Array.isArray(x) ? x : [x]);
    const fromText = () => text(cell.d).split(',').map((x) => x.trim()).filter(Boolean);
    const ids = cell.type === 'relation' ? list(cell.v) : [];
    const labels = cell.type === 'relation' ? list(cell.d) : fromText();
    const got = globalThis.WeaveGridRange.resolveRelation({ ids, labels, rows, many });
    unmatched.push(...got.unmatched.filter((l) => !unmatched.includes(l)));
    if (!got.ids.length && (ids.length || labels.length)) return UNREADABLE;
    return many ? got.ids : (got.ids[0] ?? null);
  }

  function valueFor(cell, type, options) {
    const sameType = cell.type === type;
    const byIdentity = (v, d) => (options.some((o) => o.id === v) ? v : (d ?? v));

    if (type === 'select' || type === 'workflow') {
      if (cell.v == null || cell.v === '') return null;
      return sameType ? byIdentity(cell.v, text(cell.d)) : text(cell.d);
    }
    if (type === 'multiselect') {
      if (sameType) {
        const ids = Array.isArray(cell.v) ? cell.v : cell.v == null ? [] : [cell.v];
        const labels = Array.isArray(cell.d) ? cell.d : [];
        return ids.map((v, i) => byIdentity(v, labels[i]));
      }
      const s = text(cell.d).trim();
      return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
    }
    if (type === 'checkbox' || type === 'toggle') {
      if (typeof cell.v === 'boolean') return cell.v;
      const s = text(cell.d).trim();
      if (!s || FALSE.test(s)) return false;
      if (TRUE.test(s)) return true;
      return UNREADABLE;
    }
    if (type === 'number' || type === 'rating') {
      if (typeof cell.v === 'number') return cell.v;
      const s = text(cell.d).trim();
      if (!s) return null;
      const n = Number(s.replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? n : UNREADABLE;
    }
    if (sameType) return cell.v ?? null;
    const s = text(cell.d);
    return s === '' ? null : s;
  }

})();
