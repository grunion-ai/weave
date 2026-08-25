/* The pure half of the in-app bug reporter (Feature #141).

   Every weave session runs a recorder. It keeps a short ring buffer of what
   just happened — routes entered, controls clicked, API calls with their
   status and duration, anything that threw — so that when somebody clicks
   Report, the Issue already contains the steps to reproduce it. Nobody has to
   remember what they did, which is the reason most bug reports are useless.

   Two rules the buffer never breaks:

     Values are not actions. A control is remembered by its name, never by
     what was typed into it. The trace is pasted into a shared Issue, so the
     characters someone entered stay in their browser.

     An error outranks recency. A ring buffer that drops the throw and keeps
     the twelve clicks after it has thrown away the only line that mattered.

   Classic script + ESM in one file, same pattern as chip-core.js: the browser
   reads the window global, node imports the same source
   (test/bug-report.test.mjs). The four categories are declared in
   src/bugreport.js too — the panel must render the instant it opens, so it
   carries its own copy, and a contract test pins the copies together. */
(function (root) {
  /* Label and severity are the server's (src/bugreport.js); the glyph is the
     panel's, because only the panel draws buttons. */
  const CATEGORIES = [
    { id: 'slow', label: 'Slow', severity: 'Medium', icon: 'iconly:timecircle', hint: 'Took too long, or never finished' },
    { id: 'broken-ui', label: 'Looks broken', severity: 'Medium', icon: 'iconly:category', hint: 'Overlapping, clipped, or misdrawn' },
    { id: 'wrong-data', label: 'Wrong data', severity: 'High', icon: 'iconly:papernegative', hint: "Didn't save, or shows the wrong value" },
    { id: 'error', label: 'Error', severity: 'High', icon: 'iconly:closesquare', hint: 'Something threw, or the page is empty' },
  ];

  // Long enough to hold the minute before a bug, short enough that the JSON
  // block stays a trace rather than a log file.
  const MAX_EVENTS = 60;

  const isError = (e) => e.kind === 'error' || e.kind === 'console';

  /* A ring buffer that protects errors. At capacity it drops the oldest
     ordinary event; only when the whole buffer is errors does the oldest
     error go, because at that point the newest throws are the story. */
  function createRecorder({ max = MAX_EVENTS } = {}) {
    const buf = [];
    return {
      record(ev) {
        if (!ev || !ev.kind) return;
        buf.push(ev);
        while (buf.length > max) {
          const i = buf.findIndex((e) => !isError(e));
          buf.splice(i === -1 ? 0 : i, 1);
        }
      },
      events: () => buf.slice(),
      clear: () => { buf.length = 0; },
      counts() {
        const c = { actions: 0, errors: 0, failedRequests: 0, total: buf.length };
        for (const e of buf) {
          if (isError(e)) c.errors++;
          else if (e.kind === 'api') { if (e.status >= 400 || e.status === 0) c.failedRequests++; }
          else c.actions++;
        }
        return c;
      },
    };
  }

  /* What an agent needs to find the same control again: the tag, the one
     class that identifies it, and the words on it. Deliberately not a full
     CSS path — a path through this app's generated grid is longer than the
     bug report and stops being true on the next render. */
  const NAMEABLE = /^(BUTTON|A|SUMMARY|LABEL|TH|TD|LI|OPTION)$/;

  /* A control's own words, not the words of the things sitting inside it.
     `<a>Task<span class="count">5</span></a>` is the table called Task, not
     one called "Task5" — reading textContent glues the badge onto the name
     and sends an agent looking for a table that does not exist. Direct text
     nodes only; a control that has none (an icon-only button) falls back to
     everything it contains rather than reporting nothing. */
  function ownText(node) {
    const kids = node.childNodes;
    if (!kids || typeof kids.length !== 'number') return node.textContent ?? '';
    let own = '';
    for (const k of kids) if (k.nodeType === 3) own += k.nodeValue ?? '';
    return own.trim() ? own : (node.textContent ?? '');
  }

  function describeTarget(node) {
    if (!node || !node.tagName) return 'unknown';
    const tag = String(node.tagName).toLowerCase();
    /* One class, and it must be the identifying one. `btn btn-primary` names
       a family and then a control: keep the control. Dropping any class that
       is merely a prefix of another present class does that without a list of
       framework names to maintain. */
    const classes = String(node.className ?? '')
      .split(/\s+/)
      .filter((c) => c && !/^(ng-|is-|has-)/.test(c));
    const named = classes.filter((c) => !classes.some((o) => o !== c && o.startsWith(c + '-')));
    const cls = named.length ? '.' + named[0] : '';
    const id = node.id ? '#' + node.id : '';
    // The words: an aria-label or title first (they are written for exactly
    // this), then the element's own text — but never a value or a placeholder,
    // which are the user's, not the app's.
    const attr = (a) => (typeof node.getAttribute === 'function' ? node.getAttribute(a) : null);
    /* A grid cell holds an <input>, so it has no words of its own — and the
       one thing it does have, the input's value, is the user's. What names it
       is the column, which the grid already stamps on the cell as data-field:
       schema, not data, and exactly the instruction an agent needs. The row's
       entity id comes with it, because "click the Name cell" is a different
       step from "click THIS Name cell". */
    const field = node.dataset?.field;
    const eid = node.parentElement?.dataset?.eid;
    if (field) return `${tag}${cls}[${field}]${eid ? ` of ${eid}` : ''}`;
    const words = (attr('aria-label') || attr('title') || (NAMEABLE.test(node.tagName) ? ownText(node) : '') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    return `${tag}${id}${cls}${words ? ` "${words}"` : ''}`;
  }

  /* What the page knows about itself at the moment Report is clicked. Passed
     a window-shaped object so it can be checked without a browser. */
  function clientContext(win = root, now = () => Date.now()) {
    const doc = win.document ?? {};
    return {
      url: String(win.location?.href ?? ''),
      route: String(win.location?.hash ?? ''),
      viewport: { w: win.innerWidth ?? 0, h: win.innerHeight ?? 0 },
      theme: doc.documentElement?.dataset?.bsTheme ?? 'light',
      userAgent: String(win.navigator?.userAgent ?? ''),
      at: now(),
      filedAt: new Date(now()).toISOString(),
    };
  }

  /* Symptoms are a set, not a choice: one bug is often slow AND wrong, and
     making the reporter rank them is asking them to do triage. */
  function toggleCategory(picked, id) {
    const next = picked.filter((p) => p !== id);
    return next.length === picked.length ? [...picked, id] : next;
  }

  /* A report is sendable once it says something — a symptom, a sentence, or
     both. The note alone is the "other" everybody reaches for when none of
     the four fits. */
  const canSubmit = (picked, note) => picked.length > 0 || String(note ?? '').trim().length > 0;

  root.bugCore = { CATEGORIES, MAX_EVENTS, createRecorder, describeTarget, clientContext, toggleCategory, canSubmit };
})(typeof window !== 'undefined' ? window : globalThis);
