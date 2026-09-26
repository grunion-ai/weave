/* The ⌘K palette, the pure half (Issue #382; option A, "Grouped results",
   Kyle's pick from the 2026-09-26 design pass). A hit is one line: its name
   with the match marked, an optional plain-text excerpt, the workflow state
   chip and where it lives ("Task #1"). No permalink line and no raw
   markdown: those made each hit three lines of noise.
   The parts that need no DOM live here — the markdown stripping, the
   grouping, the Tab jump between groups and the recents list — so
   test/palette-core.test.mjs holds them directly. app.js draws the rest.
   Loaded by the browser as a classic script and by the tests as a
   side-effect import, so it speaks only globalThis. */
(function (root) {
  /* Markdown to the words a reader sees. Order matters: references and links
     give up their labels before the URL pass removes what is left, and the
     partial-link passes catch the fragments a 40-character snippet window
     cuts through. A number sign that is content ("Task #143") stays; only a
     heading marker (hashes then a space) goes. */
  function plainText(md) {
    return String(md ?? '')
      .replace(/```[^\n]*|~~~[^\n]*/g, ' ')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\]\([^)\s]*\)?/g, '')
      .replace(/\bhttps?:\/\/\S+/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/(^|\n)[ \t]*(?:[-*+]|\d+[.)])[ \t]+/g, '$1')
      .replace(/\[[ xX]\][ \t]+/g, '')
      .replace(/(^|\s)(?:#{1,6}|>)[ \t]+/g, '$1')
      .replace(/:?-{3,}:?/g, ' ')
      .replace(/\*\*|__|~~|[*`[\]|]/g, ' ')
      .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|$|[.,;:!?])/g, '$1$2')
      .replace(/\(\s*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s([.,;:!?)])/g, '$1')
      .replace(/\(\s/g, '(')
      .trim();
  }

  /* A few words either side of the match, cut on word boundaries, with an
     ellipsis on each end that was cut. With no match left (it sat inside a
     URL the stripping removed) the opening words stand in. */
  const BEFORE = 3, AFTER = 8;
  function excerpt(snippet, needle) {
    const words = plainText(snippet).split(' ').filter(Boolean);
    const n = String(needle ?? '').toLowerCase().trim();
    let at = n ? words.findIndex((w) => w.toLowerCase().includes(n)) : -1;
    if (at < 0) at = 0;
    const from = Math.max(0, at - BEFORE);
    const to = Math.min(words.length, at + AFTER + 1);
    return (from > 0 ? '… ' : '') + words.slice(from, to).join(' ') + (to < words.length ? ' …' : '');
  }

  /* Segments of `text`, each marked as a match or not, for <mark>. */
  function highlight(text, needle) {
    const s = String(text ?? '');
    const n = String(needle ?? '').toLowerCase();
    if (!n) return [{ text: s, hit: false }];
    const out = [];
    const low = s.toLowerCase();
    let i = 0;
    for (let at = low.indexOf(n); at >= 0; at = low.indexOf(n, i)) {
      if (at > i) out.push({ text: s.slice(i, at), hit: false });
      out.push({ text: s.slice(at, at + n.length), hit: true });
      i = at + n.length;
    }
    if (i < s.length || !out.length) out.push({ text: s.slice(i), hit: false });
    return out;
  }

  /* Four groups in a fixed order, each hidden when it has no hits. A record
     whose name matches (or whose #id did) is a Record; a record found only
     in its text is In documents. Spaces, views and the workspace itself
     share the last group so a view hit (Issue #280) still has a home. */
  const GROUPS = [
    { key: 'records', label: 'Records' },
    { key: 'docs', label: 'In documents' },
    { key: 'tables', label: 'Tables' },
    { key: 'places', label: 'Spaces and views' },
  ];
  function groupOf(hit, needle) {
    if (hit.kind === 'table') return 'tables';
    if (hit.kind !== 'entity') return 'places';
    const byName = String(hit.name ?? '').toLowerCase().includes(needle);
    return byName || (hit.score ?? 0) >= 20 || !hit.snippet ? 'records' : 'docs';
  }
  function groupHits(hits, query) {
    const needle = String(query ?? '').toLowerCase().trim();
    return GROUPS
      .map((g) => ({ ...g, hits: hits.filter((h) => groupOf(h, needle) === g.key) }))
      .filter((g) => g.hits.length);
  }

  const lastSegment = (name) => String(name ?? '').split('/').pop();
  // A table hit's name is its qualified "Space/Table"; the line shows the
  // table and puts the space in the where-text.
  function displayName(hit) {
    return hit.kind === 'table' ? lastSegment(hit.name) : String(hit.name ?? '');
  }
  function whereText(hit) {
    if (hit.kind === 'entity') return `${lastSegment(hit.db)} #${hit.publicId}`;
    if (hit.kind === 'table') {
      const space = String(hit.name ?? '').includes('/') ? String(hit.name).split('/').slice(0, -1).join('/') : '';
      return space ? `${space} · table` : 'table';
    }
    return hit.kind;
  }

  /* Tab lands on the first row of the next group, Shift+Tab on the first
     row of the one before; both wrap. `sel` is the flat row index. */
  function groupJump(groups, sel, dir) {
    if (!groups.length) return 0;
    const starts = [];
    let n = 0;
    for (const g of groups) { starts.push(n); n += g.hits.length; }
    let g = 0;
    while (g + 1 < starts.length && starts[g + 1] <= sel) g++;
    const next = (g + (dir < 0 ? -1 : 1) + starts.length) % starts.length;
    return starts[next];
  }

  /* The empty palette's Recent group: newest first, one entry per thing
     (kind + id), eight at most. Stored per workspace by app.js. */
  const RECENT_MAX = 8;
  function pushRecent(list, item) {
    const key = (r) => `${r.kind}:${r.id}`;
    return [item, ...(Array.isArray(list) ? list : []).filter((r) => key(r) !== key(item))].slice(0, RECENT_MAX);
  }

  root.weavePalette = { plainText, excerpt, highlight, groupHits, displayName, whereText, groupJump, pushRecent, RECENT_MAX };
})(globalThis);
