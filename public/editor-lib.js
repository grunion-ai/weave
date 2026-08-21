/* Pure helpers for the document-editor decoration passes (Phase 4).
   A classic script in the browser (one global, no module syntax) that node
   can also import for its side effect — the only shape that serves both a
   buildless <script src> and `node --test` without a DOM. Nothing in here
   may touch `document`: DOM work belongs to app.js. */

globalThis.WeaveEditorLib = {
  /* [[ref]] / [[ref|label]] spans in one text-node's worth of plain text.
     Same grammar renderInline() parses server-side (src/markdown.js): no
     newlines or brackets inside a reference, label after the first pipe. */
  findRefSpans(text) {
    const out = [];
    const src = String(text ?? '');
    const re = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
    let m;
    while ((m = re.exec(src))) {
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        ref: m[1].trim(),
        label: m[2]?.trim() ?? null,
      });
    }
    return out;
  },

  /* Where a chip must never paint: code is literal text by definition, and
     Vditor's own marker/preview copies are not the writing surface. */
  REF_SKIP_SELECTOR: 'pre, code, .vditor-ir__marker, .vditor-ir__preview',

  /* One dash per heading, length by level — a minimap, not a tree. Below 3
     headings a map explains nothing, so there is no rail at all (Issue #87). */
  railSpec(headings) {
    if (!Array.isArray(headings) || headings.length < 3) return [];
    // Widths stay under 13px so the rail column never reaches the fold
    // carets sharing the gutter (rail at -26, carets from -13).
    return headings.map((h) => ({
      level: h.level,
      text: h.text,
      width: Math.max(4, 14 - h.level * 2),
    }));
  },

  /* The tracker: index of the last heading at or above the reading line
     (viewport-relative tops), the first section before any heading passes it,
     -1 when there are no headings. */
  currentSection(tops, line) {
    let current = tops.length ? 0 : -1;
    tops.forEach((top, i) => { if (top <= line) current = i; });
    return current;
  },

  /* What a fold hides (Issue #88): the block indices after heading i, up to
     but not including the next heading of the same or a higher level.
     `blocks` is one entry per block — a heading's level, or null. */
  foldRange(blocks, i) {
    const out = [];
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[j] != null && blocks[j] <= blocks[i]) break;
      out.push(j);
    }
    return out;
  },
};
