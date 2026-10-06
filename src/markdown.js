let ICONS = null, ICON_SVG = null, MARKS = null;
try {
  const here = new URL('.', import.meta.url);
  for (const f of ['icon-registry.js', 'vendor/lucide-moving.js', 'mark-icons.js']) await import(new URL(`../public/${f}`, here).href);
  ICONS = globalThis.weaveIconRegistry ?? null;
  ICON_SVG = globalThis.LUCIDE_MOVING ?? null;
  MARKS = globalThis.weaveMarkIcons ?? null;
} catch {}
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
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const ENTITY = { colon: ':', tab: '\t', newline: '\n', amp: '&', sol: '/', period: '.', lpar: '(', rpar: ')' };
function decodeEntities(s) {
  for (let n = 0; n < 4; n++) {
    const next = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
      if (e[0] !== '#') return ENTITY[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    });
    if (next === s) return s;
    s = next;
  }
  return s;
}
function safeUrl(url, { image = false } = {}) {
  const plain = decodeEntities(String(url)).replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
  const scheme = plain.match(/^([^/?#]*?):/);
  if (!scheme) return url;
  if (['http', 'https', 'mailto'].includes(scheme[1])) return url;
  if (image && /^data:image\/(png|jpeg|gif|webp)[;,]/.test(plain)) return url;
  return null;
}

function linkTarget(href) {
  return /^https?:\/\//i.test(String(href)) ? ' target="_blank" rel="noopener"' : '';
}

function renderInline(text, resolveMention) {
  let out = '';
  let i = 0;
  const src = String(text).replace(/[ \t]*$/, '').replace(/(?: {2,}|\\)\n/g, '\u0000\n');
  while (i < src.length) {
    if (src.startsWith('[[', i)) {
      const end = src.indexOf(']]', i);
      if (end > 0) {
        const inner = src.slice(i + 2, end);
        const pipe = inner.indexOf('|');
        const ref = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
        const label = pipe < 0 ? null : inner.slice(pipe + 1).trim();
        const typed = ref.match(/^(table|space|workspace)(?::(.*))?$/);
        const kind = typed ? typed[1] : (/^.+#\d+$/.test(ref) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref)) ? 'entity' : null;
        const target = typed ? (typed[2] ?? '').trim() : ref;
        if (kind && resolveMention && (kind === 'workspace' || target)) {
          let resolved = null;
          try {
            resolved = resolveMention(kind, target);
          } catch {}
          if (resolved && safeUrl(resolved.href) != null) {
            const fields = (resolved.fields ?? []).filter((f) => f && f.value != null && f.value !== '').slice(0, 3);
            const a = `<a class="mention mention-${kind}" href="${escapeHtml(resolved.href)}"`
              + (resolved.name ? ` data-name="${escapeHtml(resolved.name)}">` : '>')
              + `${escapeHtml(label ?? resolved.label)}`
              + (fields.length
                ? `<button type="button" class="mention-caret" aria-expanded="false" aria-label="Show fields">${ICON_SVG?.['chevron-right'] ?? '▸'}</button>`
                  + `<span class="mention-fields">${fields.map((f) =>
                    `<span class="mention-f"><span class="mention-f-label">${escapeHtml(f.label)}</span>${escapeHtml(String(f.value))}</span>`).join('')}</span>`
                : '')
              + '</a>';
            const chip = `<span class="k k-rel k-inline${fields.length ? ' has-segs' : ''}">${a}</span>`;
            out += fields.length ? `<span class="mention-wrap">${chip}</span>` : chip;
            i = end + 2;
            continue;
          }
        }
        out += `<span class="mention broken">${escapeHtml(inner)}</span>`;
        i = end + 2;
        continue;
      }
    }
    if (src[i] === ':') {
      const m = src.slice(i).match(ICON_TOKEN);
      const html = m && inlineIconHtml(m[1]);
      if (html) { out += html; i += m[0].length; continue; }
    }
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > 0) {
        out += `<code>${escapeHtml(src.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }
    if (src.startsWith('![', i)) {
      const m = src.slice(i).match(/^!\[([^\]]*)\]\(([^)\s]+)\)/);
      if (m) {
        const url = safeUrl(m[2], { image: true });
        out += url == null ? escapeHtml(m[1]) : `<img src="${escapeHtml(url)}" alt="${escapeHtml(m[1])}">`;
        i += m[0].length;
        continue;
      }
    }
    if (src[i] === '[') {
      const m = src.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
      if (m) {
        const url = safeUrl(m[2]);
        out += url == null ? escapeHtml(m[1]) : `<a href="${escapeHtml(url)}"${linkTarget(url)}>${renderInline(m[1], resolveMention)}</a>`;
        i += m[0].length;
        continue;
      }
    }
    if (src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2);
      if (end > 0) {
        out += `<strong>${renderInline(src.slice(i + 2, end), resolveMention)}</strong>`;
        i = end + 2;
        continue;
      }
    }
    if (src.startsWith('~~', i)) {
      const end = src.indexOf('~~', i + 2);
      if (end > 0) {
        out += `<del>${renderInline(src.slice(i + 2, end), resolveMention)}</del>`;
        i = end + 2;
        continue;
      }
    }
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

export function parseBlocks(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      const lang = fence[1] || '';
      blocks.push({
        type: ['mermaid', 'mmd'].includes(lang.toLowerCase()) ? 'mermaid' : 'code',
        lang,
        text: code.join('\n'),
      });
      continue;
    }

    if (/^<[a-zA-Z!/]/.test(line)) {
      const html = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i])) html.push(lines[i++]);
      blocks.push({ type: 'html', text: html.join('\n') });
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const parseRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) rows.push(parseRow(lines[i++]));
      blocks.push({ type: 'table', header, rows });
      continue;
    }

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
  const stack = [];
  let prevDepth = null;
  for (const item of items) {
    const tag = item.ordered ? 'ol' : 'ul';
    if (prevDepth === null) {
      html += `<${tag}>`;
      stack.push(tag);
    } else if (item.depth > prevDepth) {
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
.k-rel { border: 1px solid var(--line); border-radius: 4px; color: var(--fg); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.k-rel > a { color: inherit; text-decoration: none; padding: 0 5px 0 4px; }
.k-rel > a::after { content: "↗"; opacity: .42; font-size: .7em; margin-left: 3px; }
.k-rel:hover { border-color: var(--accent); color: var(--accent); }
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
.mention-wrap { display: inline; }
.mention-fields { display: none; }
.mention-wrap.open .mention-fields { display: inline-flex; gap: 8px; margin-left: 6px; padding-left: 7px; border-left: 1px solid var(--line); color: var(--muted); font-size: .85em; }
.mention-f-label { opacity: .65; margin-right: 3px; }
.mention-caret { border: 1px solid var(--line); background: none; border-radius: 4px; color: var(--muted); cursor: pointer; font-size: .65em; line-height: 1.4; padding: 0 3px; margin-left: 3px; transition: transform .1s; vertical-align: middle; }
.mention-caret svg { width: 12px; height: 12px; display: block; }
.mention-wrap.open .mention-caret { transform: rotate(180deg); }
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
  ev.preventDefault();
  const open = caret.closest('.mention-wrap').classList.toggle('open');
  caret.setAttribute('aria-expanded', String(open));
});
</script>
${body.includes('class="mermaid"') ? `<script src="/vendor/mermaid.min.js" onerror="document.querySelectorAll('pre.mermaid').forEach(p=>p.style.textAlign='left')"></script>
<script>if (window.mermaid) mermaid.initialize({ startOnLoad: true, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' });</script>` : ''}
${
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
