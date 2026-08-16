// Zero-dependency markdown renderer for entity documents.
// Supports: headings, paragraphs, bold, italic, strikethrough, inline code,
// links, images, fenced code blocks, blockquotes, hr, ordered/unordered lists
// (with nesting by 2-space indent), tables, task lists, and entity mentions
// of the form [[Table#123]] or [[Table#123|label]].

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
  const src = String(text);
  while (i < src.length) {
    // Entity mention [[Db#12]] or [[Db#12|label]]
    if (src.startsWith('[[', i)) {
      const end = src.indexOf(']]', i);
      if (end > 0) {
        const inner = src.slice(i + 2, end);
        const [ref, label] = inner.split('|');
        const m = ref.match(/^(.+)#(\d+)$/);
        if (m && resolveMention) {
          const resolved = resolveMention(m[1].trim(), m[2]);
          if (resolved) {
            out += `<a class="mention" href="${escapeHtml(resolved.href)}">${escapeHtml(label ?? resolved.label)}</a>`;
            i = end + 2;
            continue;
          }
        }
        out += `<span class="mention broken">${escapeHtml(inner)}</span>`;
        i = end + 2;
        continue;
      }
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
  return out;
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
:root { --fg: #1a1d23; --muted: #6b7280; --line: #e5e7eb; --accent: #4f46e5; --bg: #ffffff; --soft: #f6f7f9; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e5e7eb; --muted: #9ca3af; --line: #30343c; --accent: #818cf8; --bg: #111318; --soft: #1a1d23; }
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 760px; padding: 48px 24px; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.5em; }
h1:first-child { margin-top: 0; }
.doc-meta { color: var(--muted); font-size: 13px; margin-bottom: 2em; border-bottom: 1px solid var(--line); padding-bottom: 1em; }
a { color: var(--accent); }
a.mention { background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; text-decoration: none; }
.mention.broken { color: var(--muted); border: 1px dashed var(--line); border-radius: 4px; padding: 0 4px; }
code { background: var(--soft); border-radius: 4px; padding: 1px 5px; font-size: 0.9em; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
pre { background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid var(--line); margin: 1em 0; padding: 2px 0 2px 16px; color: var(--muted); }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
th { background: var(--soft); }
hr { border: none; border-top: 1px solid var(--line); margin: 2em 0; }
img { max-width: 100%; }
pre.mermaid { background: var(--bg); border: 1px dashed var(--line); text-align: center; }
@media print { .pagebreak { page-break-after: always; break-after: page; } }
</style>
</head>
<body>
<div class="doc-meta">${escapeHtml(subtitle)}</div>
${body}
${body.includes('class="mermaid"') ? `<script src="/vendor/mermaid.min.js" onerror="document.querySelectorAll('pre.mermaid').forEach(p=>p.style.textAlign='left')"></script>
<script>if (window.mermaid) mermaid.initialize({ startOnLoad: true, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' });</script>` : ''}
</body>
</html>`;
}
