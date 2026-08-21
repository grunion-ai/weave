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
};
