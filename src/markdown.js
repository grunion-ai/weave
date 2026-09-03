// Zero-dependency markdown renderer for entity documents.
// Supports: headings, paragraphs, bold, italic, strikethrough, inline code,
// links, images, fenced code blocks, blockquotes, hr, ordered/unordered lists
// (with nesting by 2-space indent), tables, task lists, entity mentions
// of the form [[Table#123]] or [[Table#123|label]], and inline icons.

/* Inline icons (Kyle, 2026-09-02): `:bell:` draws the bell where an emoji
   shortcode would go, `:check:` the tick, `:ring-half:` a ring. The set, its motion and the
   drawn marks come from the same three browser files (classic scripts node
   can import for their globals), so a document exports with the same icons
   the editor shows. Anything not in the set stays literal — `12:30:45`,
   `:smile:` — and the same grammar lives in WeaveEditorLib.ICON_TOKEN and in
   the shortcode table the document editor renders from. A progress ring goes
   by its ascii alias (`:ring-quarter:`). */
/* Fail open: the Worker bundle has no import.meta.url and no public/ beside
   it, and a PDF rendered there keeps every token literal rather than
   throwing (the same rule the font fallback follows in src/pdf.js). */
let ICONS = null, ICON_SVG = null, MARKS = null;
try {
  const here = new URL('.', import.meta.url);
  for (const f of ['icon-registry.js', 'vendor/lucide-moving.js', 'mark-icons.js']) await import(new URL(`../public/${f}`, here).href);
  ICONS = globalThis.weaveIconRegistry ?? null;
  ICON_SVG = globalThis.LUCIDE_MOVING ?? null;
  MARKS = globalThis.weaveMarkIcons ?? null;
} catch { /* no icon set here: tokens stay literal */ }
const ICON_TOKEN = /^:([a-z0-9][a-z0-9-]*):/;
export function inlineIconHtml(token) {
  if (!ICONS || !ICON_SVG || !MARKS) return null;
  const hit = ICONS.inline(token);
  if (!hit) return null;
  if (hit.name) {
    return `<span class="wv-icon md-icon mi mi-${hit.name}" data-ms="${ICONS.MOTION[hit.name] || 0}" title="${escapeHtml(token)}">${ICON_SVG[hit.name]}</span>`;
  }
  return `<span class="wv-icon md-icon" title="${escapeHtml(token)}"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">${MARKS.markSvg(hit.mark)}</svg></span>`;
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text, resolveMention) {
  let out = '';
  let i = 0;
  /* Hard breaks first, on the raw source: a line ending in two spaces or a
     backslash is a <br> (both CommonMark spellings). Trailing whitespace on
     the last line is noise, not a break. */
  const src = String(text).replace(/[ \t]*$/, '').replace(/(?: {2,}|\\)\n/g, '\u0000\n');
  while (i < src.length) {
    /* Reference: [[Table#12]] (entity), [[table:Space/Name]], [[space:Name]],
       [[workspace]] — any of them with |label. The parser only splits kind
       from reference; the resolver decides what each kind addresses and what
       it links to, so there is one place that knows the URL shapes. */
    if (src.startsWith('[[', i)) {
      const end = src.indexOf(']]', i);
      if (end > 0) {
        const inner = src.slice(i + 2, end);
        const pipe = inner.indexOf('|');
        const ref = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
        const label = pipe < 0 ? null : inner.slice(pipe + 1).trim();
        const typed = ref.match(/^(table|space|workspace)(?::(.*))?$/);
        // Two entity spellings: the human 'Table#12' and the durable bare
        // uuid, which survives every rename (universal reference rule).
        const kind = typed ? typed[1] : (/^.+#\d+$/.test(ref) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref)) ? 'entity' : null;
        const target = typed ? (typed[2] ?? '').trim() : ref;
        if (kind && resolveMention && (kind === 'workspace' || target)) {
          // A resolver reaches into workspace state and can throw on an
          // ambiguous or half-deleted target. One bad reference must cost its
          // own chip, not the rest of the document.
          let resolved = null;
          try {
            resolved = resolveMention(kind, target);
          } catch { /* falls through to the broken chip below */ }
          if (resolved) {
            /* A chip with preview fields collapses to its name behind a caret
               (Kyle, 2026-09-01): the whole chip stays a link to the entity;
               only the caret toggles the field segments open. */
            const fields = (resolved.fields ?? []).filter((f) => f && f.value != null && f.value !== '').slice(0, 3);
            const a = `<a class="mention mention-${kind}" href="${escapeHtml(resolved.href)}">`
              + `${escapeHtml(label ?? resolved.label)}`
              + (fields.length
                ? `<span class="mention-fields">${fields.map((f) =>
                  `<span class="mention-f"><span class="mention-f-label">${escapeHtml(f.label)}</span>${escapeHtml(String(f.value))}</span>`).join('')}</span>`
                : '')
              + '</a>';
            out += fields.length
              ? `<span class="mention-wrap">${a}<button type="button" class="mention-caret" aria-expanded="false" aria-label="Show fields">${ICON_SVG?.['chevron-right'] ?? '▸'}</button></span>`
              : a;
            i = end + 2;
            continue;
          }
        }
        out += `<span class="mention broken">${escapeHtml(inner)}</span>`;
        i = end + 2;
        continue;
      }
    }
    // Inline icon: :name: or :mark:, only when the set knows it
    if (src[i] === ':') {
      const m = src.slice(i).match(ICON_TOKEN);
      const html = m && inlineIconHtml(m[1]);
      if (html) { out += html; i += m[0].length; continue; }
    }
    // Inline code
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > 0) {
        out += `<code>${escapeHtml(src.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }
    // Image
    if (src.startsWith('![', i)) {
      const m = src.slice(i).match(/^!\[([^\]]*)\]\(([^)\s]+)\)/);
      if (m) {
        out += `<img src="${escapeHtml(m[2])}" alt="${escapeHtml(m[1])}">`;
        i += m[0].length;
        continue;
      }
    }
    // Link
    if (src[i] === '[') {
      const m = src.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
      if (m) {
        out += `<a href="${escapeHtml(m[2])}">${renderInline(m[1], resolveMention)}</a>`;
        i += m[0].length;
        continue;
      }
    }
    // Bold
    if (src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2);
      if (end > 0) {
        out += `<strong>${renderInline(src.slice(i + 2, end), resolveMention)}</strong>`;
        i = end + 2;
        continue;
      }
    }
    // Strikethrough
    if (src.startsWith('~~', i)) {
      const end = src.indexOf('~~', i + 2);
      if (end > 0) {
        out += `<del>${renderInline(src.slice(i + 2, end), resolveMention)}</del>`;
        i = end + 2;
        continue;
      }
    }
    // Italic
    if (src[i] === '*' || (src[i] === '_' && /\s|^/.test(src[i - 1] ?? ' '))) {
      const ch = src[i];
      const end = src.indexOf(ch, i + 1);
      if (end > 0 && end > i + 1) {
        out += `<em>${renderInline(src.slice(i + 1, end), resolveMention)}</em>`;
        i = end + 1;
        continue;
      }
    }
    out += escapeHtml(src[i]);
    i++;
  }
  return out.replace(/\u0000/g, '<br>');
}

// Parse markdown into a flat block list (also consumed by the PDF renderer).
export function parseBlocks(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    // Fenced code (```mermaid / ```mmd become diagram blocks)
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence
      const lang = fence[1] || '';
      blocks.push({
        type: ['mermaid', 'mmd'].includes(lang.toLowerCase()) ? 'mermaid' : 'code',
        lang,
        text: code.join('\n'),
      });
      continue;
    }

    // Raw HTML block: passes through untouched until a blank line.
    if (/^<[a-zA-Z!/]/.test(line)) {
      const html = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i])) html.push(lines[i++]);
      blocks.push({ type: 'html', text: html.join('\n') });
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    // Table: header row + separator row
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const parseRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) rows.push(parseRow(lines[i++]));
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // Lists (with 2-space nesting and task items)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!m) break;
        const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
        items.push({
          depth: Math.floor(m[1].length / 2),
          ordered: /\d/.test(m[2]),
          text: task ? task[2] : m[3],
          checked: task ? task[1].toLowerCase() === 'x' : null,
        });
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Paragraph: consume until blank line or new block-start
    const para = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push({ type: 'paragraph', text: para.join('\n') });
  }
  return blocks;
}

function renderList(items, resolveMention) {
  let html = '';
  const stack = []; // open list tags: 'ul' | 'ol'
  let prevDepth = null;
  for (const item of items) {
    const tag = item.ordered ? 'ol' : 'ul';
    if (prevDepth === null) {
      html += `<${tag}>`;
      stack.push(tag);
    } else if (item.depth > prevDepth) {
      // Nested list opens inside the still-open parent <li>.
      for (let d = prevDepth; d < item.depth; d++) {
        html += `<${tag}>`;
        stack.push(tag);
      }
    } else {
      html += '</li>';
      for (let d = item.depth; d < prevDepth; d++) html += `</${stack.pop()}></li>`;
    }
    const check = item.checked == null ? ''
      : `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `;
    html += `<li>${check}${renderInline(item.text, resolveMention)}`;
    prevDepth = item.depth;
  }
  html += '</li>';
  while (stack.length > 1) html += `</${stack.pop()}></li>`;
  html += `</${stack.pop()}>`;
  return html;
}

export function renderMarkdown(markdown, { resolveMention = null } = {}) {
  const blocks = parseBlocks(markdown);
  let html = '';
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        html += `<h${b.level}>${renderInline(b.text, resolveMention)}</h${b.level}>\n`;
        break;
      case 'paragraph':
        html += `<p>${renderInline(b.text, resolveMention)}</p>\n`;
        break;
      case 'code':
        html += `<pre><code${b.lang ? ` class="language-${escapeHtml(b.lang)}"` : ''}>${escapeHtml(b.text)}</code></pre>\n`;
        break;
      case 'mermaid':
        // Mermaid's native target element; renders when mermaid.js is present,
        // and the escaped source stays legible when it is not.
        html += `<pre class="mermaid">${escapeHtml(b.text)}</pre>\n`;
        break;
      case 'html':
        html += b.text + '\n';
        break;
      case 'quote':
        html += `<blockquote>${renderMarkdown(b.text, { resolveMention })}</blockquote>\n`;
        break;
      case 'hr':
        html += '<hr>\n';
        break;
      case 'list':
        html += renderList(b.items, resolveMention) + '\n';
        break;
      case 'table': {
        const cells = (row, tag) => row.map((c) => `<${tag}>${renderInline(c, resolveMention)}</${tag}>`).join('');
        html += `<table><thead><tr>${cells(b.header, 'th')}</tr></thead><tbody>`;
        for (const r of b.rows) html += `<tr>${cells(r, 'td')}</tr>`;
        html += '</tbody></table>\n';
        break;
      }
    }
  }
  return html;
}

// Full standalone HTML page for an entity document.
/* A document can be an app. When the stored text is itself a complete HTML
   document — a slide deck, an interactive figure — it is not markdown with
   an HTML block in it, and must never be split at blank lines or wrapped in
   the page skeleton. The test is the file's own opening: a doctype or the
   <html> tag, nothing else. */
export function isHtmlDocument(text) {
  return typeof text === 'string' && /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text);
}

export function renderDocumentPage({ title, subtitle = '', markdown, resolveMention = null }) {
  const body = renderMarkdown(markdown, { resolveMention });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/brand/weave-favicon.svg">
<style>
:root { --fg: #1a1d23; --muted: #6b7280; --line: #e5e7eb; --accent: #4f46e5; --bg: #ffffff; --soft: #f6f7f9; --code-bg: #ffffff; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e5e7eb; --muted: #9ca3af; --line: #30343c; --accent: #818cf8; --bg: #111318; --soft: #1a1d23; --code-bg: #0d1117; }
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 760px; padding: 48px 24px; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.5em; }
h1:first-child { margin-top: 0; }
.doc-meta { color: var(--muted); font-size: 13px; margin-bottom: 2em; border-bottom: 1px solid var(--line); padding-bottom: 1em; }
a { color: var(--accent); }
a.mention { background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; text-decoration: none; }
.md-icon { display: inline-flex; width: 1em; height: 1em; vertical-align: -.15em; margin-right: .15em; }
.md-icon svg { width: 1em; height: 1em; }
.mention.broken { color: var(--muted); border: 1px dashed var(--line); border-radius: 4px; padding: 0 4px; }
/* A leading glyph says what kind of thing a reference points at, so a chip is
   readable without following it. Generated content, so it never lands in a
   copy-paste of the text. */
.mention::before { color: var(--muted); margin-right: 4px; font-size: .9em; }
.mention-entity::before { content: "#"; }
.mention-table::before { content: "▦"; }
.mention-space::before { content: "◇"; }
.mention-workspace::before { content: "⬡"; }
/* Collapsed chip shows the name; the caret opens the preview segments. The
   whole chip is the link — the caret is the only non-navigating pixel. */
.mention-wrap { display: inline-flex; align-items: center; white-space: nowrap; }
.mention-fields { display: none; }
.mention-wrap.open .mention-fields { display: inline-flex; gap: 8px; margin-left: 6px; padding-left: 7px; border-left: 1px solid var(--line); color: var(--muted); font-size: .85em; }
.mention-f-label { opacity: .65; margin-right: 3px; }
.mention-caret { border: 1px solid var(--line); background: none; border-radius: 4px; color: var(--muted); cursor: pointer; font-size: .65em; line-height: 1.4; padding: 0 3px; margin-left: 3px; transition: transform .1s; }
.mention-wrap.open .mention-caret { transform: rotate(90deg); }
code { background: var(--soft); border-radius: 4px; padding: 1px 5px; font-size: 0.9em; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
/* A code block sits on the ground its palette was drawn for — white for
   github, #0d1117 for github-dark — because a token colour answers to the
   surface under it, not to the theme around it (Issue #81). On --soft's grey
   the github keyword red measured 4.27:1, under AA by a hair. The border is
   what makes the block a block when the slab matches the page. */
pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow-x: auto; position: relative; }
pre code { background: none; padding: 0; }
/* hljs contributes token colours only; the block chrome (background, border,
   padding, copy button) stays the page's own. */
pre code.hljs { background: none; padding: 0; }
/* Code is there to be taken, so the button is always on the block rather than
   waiting for a hover that a touch screen never sends. */
.code-copy { position: absolute; top: 8px; right: 8px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--bg); color: var(--muted); font: 11px/1 ui-monospace, "SF Mono", Menlo, monospace;
  padding: 5px 7px; cursor: pointer; opacity: .6; }
.code-copy:hover { opacity: 1; color: var(--fg); }
blockquote { border-left: 3px solid var(--line); margin: 1em 0; padding: 2px 0 2px 16px; color: var(--muted); }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
th { background: var(--soft); }
hr { border: none; border-top: 1px solid var(--line); margin: 2em 0; }
img { display: block; margin: 8px auto; max-width: 60%; }
iframe.wv-file { display: block; margin: 8px auto; width: 60%; max-width: 60%; aspect-ratio: 4 / 3;
  border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
pre.mermaid { background: var(--bg); border: 1px dashed var(--line); text-align: center; }
@media print { .pagebreak { page-break-after: always; break-after: page; } .code-copy { display: none; } }
</style>
</head>
<body>
<div class="doc-meta">${escapeHtml(subtitle)}</div>
${body}
<script>
for (const pre of document.querySelectorAll('pre:not(.mermaid)')) {
  const btn = document.createElement('button');
  btn.className = 'code-copy';
  btn.type = 'button';
  btn.textContent = 'Copy';
  btn.onclick = async () => {
    const code = pre.querySelector('code') ?? pre;
    try { await navigator.clipboard.writeText(code.textContent); btn.textContent = 'Copied'; }
    catch { btn.textContent = 'Press ⌘C'; getSelection().selectAllChildren(code); }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
  };
  pre.append(btn);
}
document.addEventListener('click', (ev) => {
  const caret = ev.target.closest('.mention-caret');
  if (!caret) return;
  const open = caret.closest('.mention-wrap').classList.toggle('open');
  caret.setAttribute('aria-expanded', String(open));
});
</script>
${body.includes('class="mermaid"') ? `<script src="/vendor/mermaid.min.js" onerror="document.querySelectorAll('pre.mermaid').forEach(p=>p.style.textAlign='left')"></script>
<script>if (window.mermaid) mermaid.initialize({ startOnLoad: true, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' });</script>` : ''}
${/* Same vendored highlight.js the editor loads (Issue #35), and literally
      the same detection: editor-lib.js is the one place that decides what an
      untagged fence is written in, so a block cannot be coloured one way in
      the editor and another on its own page. A fence that names its language
      wins; one that does not is detected structurally; anything unrecognised
      — prose, a note, a diagram source — stays plain text. Diagram and math
      fences belong to their own renderers and are never touched. */
  body.includes('<pre><code') ? `<link rel="stylesheet" href="/vendor/vditor/dist/js/highlight.js/styles/github.min.css" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="/vendor/vditor/dist/js/highlight.js/styles/github-dark.min.css" media="(prefers-color-scheme: dark)">
<script src="/vendor/vditor/dist/js/highlight.js/highlight.min.js"></script>
<script src="/editor-lib.js"></script>
<script>
const OWNED = /language-(mermaid|mmd|math|graphviz|plantuml|echarts|mindmap|abc|flowchart)\\b/;
if (window.hljs) for (const code of document.querySelectorAll('pre > code')) {
  if (OWNED.test(code.className)) continue;
  if (/language-\\S/.test(code.className)) { hljs.highlightElement(code); continue; }
  const text = code.textContent || '';
  const lang = window.WeaveEditorLib && WeaveEditorLib.detectCodeLanguage(text);
  if (!lang) continue;
  try {
    code.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    code.className = 'hljs language-' + lang;
  } catch (e) { /* the language is not in the vendored bundle */ }
}
</script>` : ''}
</body>
</html>`;
}
