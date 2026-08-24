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

  /* ---------- one line of markdown, as marks instead of syntax ----------
     For places that show a markdown value without editing it — the text
     cells of the registry grids, where a space description was reading
     `**Official docs** — the pages`. Flat by design: the first mark that
     closes wins, nothing nests, and an unclosed marker is just text (so
     `2 * 3` and `snake_case` survive). Same grammar as renderInline() in
     src/markdown.js, minus the block level, which a cell has no room for. */
  inlineTokens(md) {
    const src = String(md ?? '');
    if (!src) return [];
    const RULES = [
      [/^\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/, (m) => ({ text: (m[2] ?? m[1]).trim(), mark: 'ref' })],
      [/^\[([^\]\n]+)\]\([^)\s]*\)/, (m) => ({ text: m[1], mark: 'link' })],
      // Every emphasis mark is flanked: it may not open or close on a space,
      // so `2 * 3 * 4` stays arithmetic.
      [/^\*\*(\S|\S[^*\n]*\S)\*\*/, (m) => ({ text: m[1], mark: 'strong' })],
      [/^__(\S|\S[^_\n]*\S)__/, (m) => ({ text: m[1], mark: 'strong' })],
      [/^~~(\S|\S[^~\n]*\S)~~/, (m) => ({ text: m[1], mark: 'strike' })],
      [/^`(\S|\S[^`\n]*\S)`/, (m) => ({ text: m[1], mark: 'code' })],
      [/^\*(\S|\S[^*\n]*\S)\*/, (m) => ({ text: m[1], mark: 'em' })],
      // _em_ only between non-word edges, or snake_case_names would italicise.
      [/^_(\S|\S[^_\n]*\S)_(?!\w)/, (m) => ({ text: m[1], mark: 'em' })],
    ];
    const out = [];
    let plain = '';
    const flush = () => { if (plain) { out.push({ text: plain, mark: null }); plain = ''; } };
    for (let i = 0; i < src.length;) {
      const rest = src.slice(i);
      const hit = RULES.map(([re, make]) => [re.exec(rest), make]).find(([m]) => m);
      // An underscore mark may only open where a word does not already run.
      if (hit && !(hit[0][0][0] === '_' && /\w$/.test(plain))) {
        flush();
        out.push(hit[1](hit[0]));
        i += hit[0][0].length;
      } else {
        plain += src[i];
        i += 1;
      }
    }
    flush();
    return out;
  },

  /* ---------- what language a fence is written in, when it does not say ----
     Measured first, then written: highlight.js's own auto-detection is not
     usable here. Over a subset it read a JS block as CSS (relevance 4) and a
     mermaid graph as CSS (3); over its full set it answered ada, ebnf,
     livecodeserver and solidity for ordinary JavaScript, SQL and a file path.
     A scorer that confident and that wrong colours code as a lie.

     So these are structural rules, precision first: a format is claimed only
     when its shape says so, and everything else is plain text — which is what
     a Code block should show anyway. Deterministic, so a block cannot change
     colour between the editor, the page and the next visit. */
  MERMAID_HEAD: /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph)\b/,
  SHELL_HEAD: /^\s*(npm|npx|yarn|pnpm|git|curl|wget|cd|ls|mkdir|rm|cp|mv|brew|apt|apt-get|sudo|docker|kubectl|node|deno|python3?|pip3?|make|bash|sh|zsh|ssh|scp|export|echo|cat|grep|sed|awk|tar|open)\s/,

  detectCodeLanguage(text) {
    const body = String(text ?? '').trim();
    if (body.length < 8) return null; // too little to be sure of anything
    const lines = body.split('\n');

    // JSON that parses is JSON. No heuristic beats the parser.
    if (/^[[{]/.test(body)) {
      try { JSON.parse(body); return 'json'; } catch { /* not JSON after all */ }
    }
    // Markup that closes its tags is markup — html and xml share a grammar.
    if (/^</.test(body) && /<\/[a-zA-Z][\w-]*>|\/>/.test(body)) return 'xml';
    if (/^(diff --git |@@ |[+-]{3} )/.test(body)) return 'diff';
    // A diagram source is not code to colour: it is shown as the text it is.
    if (this.MERMAID_HEAD.test(body)) return null;
    if (/^\s*(select|insert|update|delete|create|alter|drop|with)\b/i.test(body)
      && /\b(from|into|table|set|values|where)\b/i.test(body)) return 'sql';
    if (/^\s*[$#]\s+\S/.test(body) || this.SHELL_HEAD.test(lines[0])) return 'bash';
    if (/^\s*(def|class)\s+\w+[^\n]*:\s*$/m.test(body)
      || /^\s*(from\s+[\w.]+\s+)?import\s+\w+/m.test(body)) return 'python';
    // A rule block with declarations in it, and none of JavaScript's words —
    // both languages use braces, only one of them uses `function`.
    if (/[.#@]?[\w-]+\s*\{[^{}]*[\w-]+\s*:[^{}]+\}/.test(body)
      && !/\b(function|const|let|var|return)\b|=>/.test(body)) return 'css';
    const jsSignals = [
      /\b(const|let|var)\s+[\w$]+\s*=/, /\bfunction\s*[\w$]*\s*\(/, /=>/,
      /\b(import|export)\b[^\n]*\bfrom\b/, /\bclass\s+[\w$]+/, /\breturn\b/,
    ].filter((re) => re.test(body)).length;
    if (jsSignals >= 2 || /^\s*(const|let|var)\s+[\w$]+\s*=[^\n]*;\s*$/m.test(body)) return 'javascript';
    // Loosest rule, so it goes last: every line is a key, a list item or a
    // comment, and at least one of them is a key.
    if (lines.length >= 2
      && lines.every((l) => !l.trim() || /^(\s*-\s|\s*#|\s*[\w.$-]+\s*:(\s|$))/.test(l))
      && /^\s*[\w.$-]+\s*:/m.test(body)) return 'yaml';
    return null;
  },

  /* Where a chip must never paint: code is literal text by definition, and
     Vditor's own marker/preview copies are not the writing surface. */
  REF_SKIP_SELECTOR: 'pre, code, .vditor-ir__marker, .vditor-ir__preview',

  /* One dash per heading, length by level — a minimap, not a tree. Below 3
     headings a map explains nothing, so there is no rail at all (Issue #87). */
  railSpec(headings) {
    if (!Array.isArray(headings) || headings.length < 3) return [];
    // Widths stay under 20px: the rail owns the full gutter now that the
    // document text is indented and the fold carets moved inside that indent.
    return headings.map((h) => ({
      level: h.level,
      text: h.text,
      width: Math.max(6, 20 - h.level * 3),
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
