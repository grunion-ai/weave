(function (root) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function lcs(a, b) {
    const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push(['=', a[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', a[i++]]); else ops.push(['+', b[j++]]);
    }
    while (i < n) ops.push(['-', a[i++]]);
    while (j < m) ops.push(['+', b[j++]]);
    return ops;
  }
  function pairRuns(ops, { same, pair, rem, add }) {
    let dels = [], adds = [];
    const flush = () => {
      const k = Math.min(dels.length, adds.length);
      for (let i = 0; i < k; i++) pair(dels[i], adds[i]);
      dels.slice(k).forEach(rem); adds.slice(k).forEach(add);
      dels = []; adds = [];
    };
    for (const [t, s] of ops) { if (t === '=') { flush(); same(s); } else (t === '-' ? dels : adds).push(s); }
    flush();
  }
  function words(a, b) {
    let out = '';
    for (const [t, w] of lcs(a.split(/(\s+)/), b.split(/(\s+)/))) out += t === '=' ? esc(w) : t === '-' ? `<del>${esc(w)}</del>` : `<ins>${esc(w)}</ins>`;
    return out.replace(/<\/del>(\s*)<del>/g, '$1').replace(/<\/ins>(\s*)<ins>/g, '$1');
  }
  function sentences(a, b) {
    const out = []; const split = (s) => s.split(/(?<=[.!?:])\s+/);
    pairRuns(lcs(split(a), split(b)), {
      same: (s) => out.push(esc(s)),
      pair: (x, y) => {
        const wa = x.split(/\s+/), wb = y.split(/\s+/);
        const kept = lcs(wa, wb).filter((o) => o[0] === '=').length;
        out.push(kept / Math.max(wa.length, wb.length) >= 0.5 ? words(x, y) : `<del>${esc(x)}</del> <ins>${esc(y)}</ins>`);
      },
      rem: (x) => out.push(`<del>${esc(x)}</del>`),
      add: (y) => out.push(`<ins>${esc(y)}</ins>`),
    });
    return out.join(' ');
  }
  function lines(a, b) {
    const out = [];
    pairRuns(lcs(a.split('\n'), b.split('\n')), {
      same: (s) => out.push(esc(s)), pair: (x, y) => out.push(words(x, y)),
      rem: (x) => out.push(`<del>${esc(x)}</del>`), add: (y) => out.push(`<ins>${esc(y)}</ins>`),
    });
    return out.join('\n');
  }
  function renderDiff(oldText, newText) {
    const H = (s) => /^#{1,6} /.test(s), strip = (s) => (H(s) ? s.replace(/^#{1,6} /, '') : s);
    const SRC = (s) => /^(```|~~~|\||>|[-*+] |\d+[.)] )/.test(s), CODE = (s) => /^(```|~~~|\|)/.test(s);
    const tag = (s, html, cls = '') => {
      if (SRC(s)) return `<div class="src${CODE(s) ? ' code' : ''}${cls ? ` ${cls}` : ''}">${html}</div>`;
      return H(s) ? `<h4${cls ? ` class="${cls}"` : ''}>${html}</h4>` : `<p${cls ? ` class="${cls}"` : ''}>${html}</p>`;
    };
    const blocks = (t) => (t ? t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean) : []);
    let html = '', run = [];
    const flushRun = () => {
      if (run.length > 2) {
        const n = run.length - 2;
        html += tag(run[0], esc(strip(run[0]))) + `<p class="fold">${n} unchanged paragraph${n === 1 ? '' : 's'}</p>` + tag(run.at(-1), esc(strip(run.at(-1))));
      } else run.forEach((s) => { html += tag(s, esc(strip(s))); });
      run = [];
    };
    pairRuns(lcs(blocks(oldText), blocks(newText)), {
      same: (s) => run.push(s),
      pair: (a, b) => { flushRun(); html += tag(b, SRC(a) || SRC(b) ? lines(a, b) : sentences(strip(a), strip(b)), 'mod'); },
      rem: (a) => { flushRun(); html += tag(a, `<del>${esc(strip(a))}</del>`, 'rem'); },
      add: (b) => { flushRun(); html += tag(b, `<ins>${esc(strip(b))}</ins>`, 'add'); },
    });
    flushRun();
    return html || '<p class="fold">No changes between these versions.</p>';
  }
  function feed({ documents = [], activity = [], comments = [], optionName = (_f, v) => v }) {
    const revs = documents.flatMap(({ field, revisions }) => revisions.map((r, i) => {
      const source = r.restoredFrom == null ? null : revisions.find((x) => x.seq === r.restoredFrom);
      return {
        kind: 'rev', id: `r${r.seq}`, seq: r.seq, field, at: r.at, actor: r.actor ?? null, len: r.len,
        delta: r.len - (revisions[i + 1]?.len ?? 0), current: i === 0, first: i === revisions.length - 1,
        ...(r.restoredFrom == null ? {} : { restoredFrom: r.restoredFrom, source: source ? { at: source.at, actor: source.actor ?? null } : null }),
      };
    }));
    const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) < 3000;
    const acts = [];
    for (const a of activity) {
      if (a.kind === 'state-changed' || a.kind === 'field-updated') {
        acts.push({ kind: a.kind === 'state-changed' ? 'state' : 'field', id: `a${a.seq}`, at: a.ts, actor: a.actor ?? null,
          field: a.detail?.field, from: optionName(a.detail?.field, a.detail?.from), to: optionName(a.detail?.field, a.detail?.to) });
      } else if (a.kind === 'comment-added') {
        const c = comments.find((x) => near(x.createdAt, a.ts) && (!a.detail?.author || x.author === a.detail.author));
        if (c) acts.push({ kind: 'comment', id: `a${a.seq}`, at: a.ts, actor: a.actor ?? c.author ?? null, body: c.text, commentId: c.id });
      }
    }
    const docFields = new Set(documents.map((d) => d.field));
    for (const u of activity.filter((a) => a.kind === 'undo')) {
      for (const f of u.detail?.fields ?? []) {
        if (docFields.has(f)) { const r = revs.find((x) => x.field === f && near(x.at, u.ts)); if (r) r.undo = true; continue; }
        const target = acts.filter((a) => a.field === f && a.kind !== 'undo' && Date.parse(a.at) <= Date.parse(u.ts) && !a.undone)
          .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))[0];
        if (target) { target.undone = true; acts.push({ kind: 'undo', id: `a${u.seq}`, at: u.ts, actor: u.actor ?? null, field: f, from: target.to, to: target.from }); }
      }
    }
    return [...revs, ...acts].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  }
  function filterFeed(items, filter) {
    if (!filter || filter === 'all') return items;
    if (filter.startsWith('doc:')) return items.filter((it) => it.kind === 'rev' && it.field === filter.slice(4));
    if (filter === 'fields') return items.filter((it) => it.kind === 'state' || it.kind === 'field' || it.kind === 'undo');
    return items.filter((it) => it.kind === 'comment');
  }
  function dayLabel(iso, now = new Date()) {
    const d = new Date(iso), y = new Date(now.getTime() - 864e5);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  root.weaveHistoryCore = { lcs, renderDiff, feed, filterFeed, dayLabel, esc };
})(globalThis);
