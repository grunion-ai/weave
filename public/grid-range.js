/* Grid ranges, the pure half (Feature #220).

   Kyle, 2026-09-09: "I need a better way to select, drag to duplicate, copy
   or paste values — like single or multi select dropdowns — across cells."

   #134 made the cell rest as a value; #132 gave a selection of ROWS one
   write. Both stop at the row. This is the rectangle between them — a range
   of CELLS, the fill that drags one value across it, and a clipboard that
   carries typed values rather than strings.

   No DOM here and no writes: a rectangle, a block of cells and a table's
   field types resolve to the writes `bulk set` will make and the field names
   that refused them. public/app.js carries them out, over the SAME `bulk`
   verb the puck uses (Feature #132, slice 3) — this is the gesture layer,
   not a second write path, so every row keeps its own undo step, tombstone
   and activity entry.

     rect / size / cellsOf / has   the rectangle
     extend                        ⇧-arrow grows it, the anchor holds
     block / toTSV / parseTSV      what a copy carries, both directions
     target / at                   where a paste lands, and how it tiles
     fillTarget                    where the corner handle dragged to
     plan / group                  the writes, and what refused
     toast                         what did NOT land, said out loud */
(() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const text = (d) => (d == null ? '' : Array.isArray(d) ? d.join(', ') : String(d));

  /* A field type takes a pasted value exactly when "Set a field…" would offer
     it one: a relation is Link to…'s, a document is prose, and a formula,
     rollup, lookup or view is a READ — writing to one is not a slow write,
     it is a category error. One list, so the puck and the clipboard can
     never drift apart on what a value is. */
  const PASTEABLE = globalThis.WeaveSelection?.SETTABLE ?? [];

  // A value that will not read at all — distinct from null, which IS a value.
  const UNREADABLE = Symbol('unreadable');
  const TRUE = /^(true|yes|y|1|on|✓|checked)$/i;
  const FALSE = /^(false|no|n|0|off|✗|unchecked)$/i;

  globalThis.WeaveGridRange = {
    PASTEABLE,
    pasteable(type) { return PASTEABLE.includes(type); },

    /* ---------- the rectangle ---------- */
    rect(a, b) {
      return {
        r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c),
        r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c),
      };
    },
    size(x) {
      return x.h != null ? { h: x.h, w: x.w } : { h: x.r1 - x.r0 + 1, w: x.c1 - x.c0 + 1 };
    },
    // The resting cursor of #134 IS a range — of one cell. Everything below
    // reads it that way, so there is one target shape rather than two.
    single(rect) { return rect.r0 === rect.r1 && rect.c0 === rect.c1; },
    has(rect, r, c) { return r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1; },
    cellsOf(rect) {
      const out = [];
      for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) out.push({ r, c });
      return out;
    },

    /* ---------- ⇧-arrow ----------
       The focus walks, the anchor holds — the same anchor rule the checkbox
       column's shift-click and #134's ⇧↑/⇧↓ already use, one dimension up.
       A step that would leave the grid is no step at all: the range holds
       rather than silently stopping at an edge the reader cannot see. */
    extend({ anchor, focus, dr = 0, dc = 0, rows, cols }) {
      const a = anchor ?? focus;
      const nr = focus.r + dr, nc = focus.c + dc;
      if (nr < 0 || nr > rows - 1 || nc < 0 || nc > cols - 1) return null;
      return { anchor: a, focus: { r: nr, c: nc } };
    },

    /* ---------- what a copy carries ----------
       Internal copies carry the TYPED value — a select's option id, a
       multi-select's whole set, a checkbox's boolean — beside the label the
       TSV needs. `d` is what a spreadsheet reads; `v` is what weave writes. */
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

    /* Text from outside weave. Row-major, tabs between columns — the shape
       every spreadsheet puts on the clipboard. It names no fields, so every
       value arrives as a string and the target column's type decides what it
       becomes (`plan` below). A trailing newline is the copy's, not a row. */
    parseTSV(str) {
      if (typeof str !== 'string' || !str.trim()) return null;
      const lines = str.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
      const cells = lines.map((line) => line.split('\t').map((s) => ({ type: null, v: s, d: s })));
      const w = Math.max(...cells.map((row) => row.length));
      // A ragged paste is squared off rather than refused: a short row's
      // missing cells are empty, which is what they look like in the sheet.
      for (const row of cells) while (row.length < w) row.push({ type: null, v: '', d: '' });
      return { h: cells.length, w, fields: null, cells };
    },

    /* ---------- where a paste lands ----------
       Onto one cell, the block takes its own shape from there. Onto a range,
       the range wins and the block tiles to cover it — which is how one
       copied cell fills twenty. Either way the target stops at the last row
       and column: a paste never invents rows. */
    target({ rect, block, rows, cols }) {
      const r1 = this.single(rect) ? rect.r0 + block.h - 1 : rect.r1;
      const c1 = this.single(rect) ? rect.c0 + block.w - 1 : rect.c1;
      return { r0: rect.r0, c0: rect.c0, r1: clamp(r1, rect.r0, rows - 1), c1: clamp(c1, rect.c0, cols - 1) };
    },
    // The block cell that covers an offset in the target, repeating.
    at(block, dr, dc) { return block.cells[dr % block.h][dc % block.w]; },

    /* ---------- the fill handle ----------
       The handle sits on the range's bottom-right corner and drags DOWN or
       ACROSS — one axis, whichever it travelled further along. Two axes at
       once would be a resize, and a resize of a range that is already the
       source of its own values has no honest reading. Dragged back inside
       the range, it fills nothing. */
    fillTarget(rect, { r, c }) {
      const dr = r - rect.r1, dc = c - rect.c1;
      if (dr <= 0 && dc <= 0) return null;
      return dr >= dc ? { ...rect, r1: r } : { ...rect, c1: c };
    },

    /* ---------- the plan ----------
       Every cell of the target, resolved against the column it lands in:

       - A column that cannot take a value REFUSES, by name. It is named once
         however many cells hit it, following `bulk`'s precedent of saying
         what did not land rather than reporting a success it cannot vouch for.
       - Select, multi-select and workflow paste by OPTION IDENTITY. The id
         carries over whole within a table; into a different one the id is a
         stranger, so the LABEL goes instead and the engine resolves it or
         refuses it. The grid never invents an option that does not exist.
       - A multi-select cell pastes as a REPLACEMENT — the whole set, as it
         stood — never a merge.
       - Text from outside is read into the column's type: a number parsed, a
         checkbox read rather than coerced (`Boolean('false')` is true, which
         is exactly the mistake to avoid), a comma list split into a set. A
         cell that will not read is dropped and counted; its neighbours land. */
    plan({ block, rect, fields, rowIds, typeOf, optionsOf }) {
      const writes = [], refused = [];
      let unparsed = 0;
      for (const { r, c } of this.cellsOf(rect)) {
        const field = fields[c], eid = rowIds[r];
        if (field == null || eid == null) continue;
        const type = typeOf(field);
        if (!this.pasteable(type)) {
          if (!refused.includes(field)) refused.push(field);
          continue;
        }
        const cell = this.at(block, r - rect.r0, c - rect.c0);
        const value = valueFor(cell, type, optionsOf(field));
        if (value === UNREADABLE) { unparsed += 1; continue; }
        writes.push({ eid, field, value });
      }
      return { writes, refused, unparsed };
    },

    /* Rows that receive an IDENTICAL set of values are one `bulk` call, so a
       fill down twenty rows is one write rather than twenty — which is what
       makes one gesture undo the whole thing. A paste whose rows differ costs
       one call per distinct value set, and no more. */
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

    /* What the toast says. The part worth saying is what did NOT land: the
       columns that refused, by name, and the cells that would not read, by
       count — there is no column to name for those. `bulkToast` says this for
       a selection of rows (#132); this says it for a rectangle of cells. */
    toast({ verb, cells, refused = [], unparsed = 0, results = [] }) {
      const failed = results.flatMap((r) => r.failed ?? []);
      const aside = [
        refused.length ? `${refused.join(', ')} cannot take a value` : null,
        unparsed ? `${unparsed} unreadable` : null,
      ].filter(Boolean).join('; ');
      if (failed.length) {
        return { msg: `${verb.toLowerCase()}: ${failed.length} of ${results.reduce((n, r) => n + (r.done?.length ?? 0), 0) + failed.length} rows failed — ${failed[0].error}`, err: true };
      }
      if (!cells) return { msg: `Nothing ${verb.toLowerCase()}${aside ? ` — ${aside}` : ''}`, err: true };
      return { msg: `${verb} ${cells} cell${cells === 1 ? '' : 's'}${aside ? ` — ${aside}` : ''}`, err: false };
    },
  };


  /* One cell of a copied block, resolved against the column it lands in.
     UNREADABLE is not a value: the cell is dropped and counted, and its
     neighbours in the same paste still land. */
  function valueFor(cell, type, options) {
    const sameType = cell.type === type;
    // An option id we hold is the identity; anything else falls back to the
    // label, which the engine matches or refuses by name.
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
    if (type === 'number') {
      if (typeof cell.v === 'number') return cell.v;
      const s = text(cell.d).trim();
      if (!s) return null;
      const n = Number(s.replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? n : UNREADABLE;
    }
    // text, date, daterange, url, email: the typed value when the columns
    // agree, else the label, for the engine's own validation to judge.
    if (sameType) return cell.v ?? null;
    const s = text(cell.d);
    return s === '' ? null : s;
  }

})();
