globalThis.WeaveEditorLib = {
  ICON_TOKEN: /:([a-z0-9][a-z0-9-]*):/g,

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

  cellActivation(type) {
    return {
      text: 'focus-input', number: 'focus-input', url: 'focus-input',
      email: 'focus-input', key: 'focus-input',
      date: 'focus-input',
      select: 'open-picker', multiselect: 'open-picker', workflow: 'open-picker',
      relation: 'open-button', attachments: 'open-button', files: 'open-button',
      checkbox: 'toggle', toggle: 'toggle',
      rating: 'rate',
      formula: 'none', rollup: 'none', lookup: 'none', count: 'none',
      document: 'none', field: 'none',
    }[type] ?? (type ? 'focus-input' : 'none');
  },

  urlParts(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    let u;
    try { u = new URL(value.trim()); } catch { return null; }
    if (/^(javascript|data|vbscript|blob|file):$/i.test(u.protocol)) return null;
    const external = u.protocol === 'http:' || u.protocol === 'https:';
    if (external && !u.host) return null;
    if (external) {
      const rest = (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
      return { href: u.href, host: u.host, rest, external };
    }
    const raw = value.trim();
    const cut = raw.search(/[?#]/);
    return { href: u.href, host: cut < 0 ? raw : raw.slice(0, cut), rest: cut < 0 ? '' : raw.slice(cut), external };
  },

  docKind(text) {
    const src = String(text ?? '').trim();
    if (!src) return null;
    if (/^(?:<!doctype\s+html|<html[\s>])/i.test(src)) return 'html';
    if (/^[{[]/.test(src)) {
      try { JSON.parse(src); return 'json'; } catch {}
    }
    if (/^(?:graph|flowchart)\s+(?:TB|TD|BT|RL|LR)\b|^(?:sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?)\b|^(?:gantt|pie|mindmap|timeline|journey|gitGraph)(?=\s+(?:title|showData)\b|\s*\n)/.test(src)) return 'mmd';
    return 'md';
  },

  docViewMode(declared, text) {
    if (declared === 'html') return 'app';
    if (declared === 'code') return 'code';
    const kind = this.docKind(text);
    return kind === 'html' ? 'app' : kind === 'mmd' ? 'diagram' : kind === 'json' ? 'code' : 'markdown';
  },

  docChipKind(declared, text) {
    if (!String(text ?? '').trim()) return null;
    if (declared === 'html' || declared === 'code') return declared;
    return this.docKind(text);
  },

  docPreview(md, { lines: budget = 3 } = {}) {
    const src = String(md ?? '');
    const kind = this.docKind(src);
    if (!kind) return { kind: null, lines: [], label: '' };
    if (kind === 'html') {
      const title = src.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
      return { kind, lines: [], label: title || 'HTML page' };
    }
    if (kind === 'json') {
      let shape = '';
      try {
        const v = JSON.parse(src.trim());
        shape = Array.isArray(v) ? `${v.length} items` : `${Object.keys(v).length} keys`;
      } catch {}
      return { kind, lines: [], label: shape ? `JSON model · ${shape}` : 'JSON model' };
    }
    if (kind === 'mmd') {
      const word = src.trim().match(/^\w+/)?.[0] ?? 'mermaid';
      return { kind, lines: [], label: `${word} diagram` };
    }
    const out = [];
    let fenced = false;
    for (const raw of src.split('\n')) {
      if (out.length >= budget) break;
      const line = raw.trim();
      if (/^(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      if (!line) continue;
      if (/^(?:[-*_]\s*){3,}$/.test(line)) continue;
      if (line.startsWith('|')) continue;
      const text = line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\[[ xX]\]\s+/, '')
        .trim();
      if (text) out.push(text);
    }
    return { kind, lines: out, label: '' };
  },

  inlineTokens(md, accept = null) {
    const src = String(md ?? '');
    if (!src) return [];
    const RULES = [
      [/^\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/, (m) => ({ text: (m[2] ?? m[1]).trim(), mark: 'ref' })],
      [new RegExp('^' + this.ICON_TOKEN.source), (m) => { const icon = accept?.(m[1]) ?? null; return icon ? { text: m[1], mark: 'icon', icon } : null; }],
      [/^\[([^\]\n]+)\]\([^)\s]*\)/, (m) => ({ text: m[1], mark: 'link' })],
      [/^\*\*(\S|\S[^*\n]*\S)\*\*/, (m) => ({ text: m[1], mark: 'strong' })],
      [/^__(\S|\S[^_\n]*\S)__/, (m) => ({ text: m[1], mark: 'strong' })],
      [/^~~(\S|\S[^~\n]*\S)~~/, (m) => ({ text: m[1], mark: 'strike' })],
      [/^`(\S|\S[^`\n]*\S)`/, (m) => ({ text: m[1], mark: 'code' })],
      [/^\*(\S|\S[^*\n]*\S)\*/, (m) => ({ text: m[1], mark: 'em' })],
      [/^_(\S|\S[^_\n]*\S)_(?!\w)/, (m) => ({ text: m[1], mark: 'em' })],
    ];
    const out = [];
    let plain = '';
    const flush = () => { if (plain) { out.push({ text: plain, mark: null }); plain = ''; } };
    for (let i = 0; i < src.length;) {
      const rest = src.slice(i);
      const hit = RULES.map(([re, make]) => [re.exec(rest), make]).find(([m]) => m);
      const tok = hit && !(hit[0][0][0] === '_' && /\w$/.test(plain)) ? hit[1](hit[0]) : null;
      if (tok) {
        flush();
        out.push(tok);
        i += hit[0][0].length;
      } else {
        plain += src[i];
        i += 1;
      }
    }
    flush();
    return out;
  },

  MERMAID_HEAD: /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph)\b/,
  SHELL_HEAD: /^\s*(npm|npx|yarn|pnpm|git|curl|wget|cd|ls|mkdir|rm|cp|mv|brew|apt|apt-get|sudo|docker|kubectl|node|deno|python3?|pip3?|make|bash|sh|zsh|ssh|scp|export|echo|cat|grep|sed|awk|tar|open)\s/,

  detectCodeLanguage(text) {
    const body = String(text ?? '').trim();
    if (body.length < 8) return null;
    const lines = body.split('\n');

    if (/^[[{]/.test(body)) {
      try { JSON.parse(body); return 'json'; } catch {}
    }
    if (/^</.test(body) && /<\/[a-zA-Z][\w-]*>|\/>/.test(body)) return 'xml';
    if (/^(diff --git |@@ |[+-]{3} )/.test(body)) return 'diff';
    if (this.MERMAID_HEAD.test(body)) return null;
    if (/^\s*(select|insert|update|delete|create|alter|drop|with)\b/i.test(body)
      && /\b(from|into|table|set|values|where)\b/i.test(body)) return 'sql';
    if (/^\s*[$#]\s+\S/.test(body) || this.SHELL_HEAD.test(lines[0])) return 'bash';
    if (/^\s*(def|class)\s+\w+[^\n]*:\s*$/m.test(body)
      || /^\s*(from\s+[\w.]+\s+)?import\s+\w+/m.test(body)) return 'python';
    if (/[.#@]?[\w-]+\s*\{[^{}]*[\w-]+\s*:[^{}]+\}/.test(body)
      && !/\b(function|const|let|var|return)\b|=>/.test(body)) return 'css';
    const jsSignals = [
      /\b(const|let|var)\s+[\w$]+\s*=/, /\bfunction\s*[\w$]*\s*\(/, /=>/,
      /\b(import|export)\b[^\n]*\bfrom\b/, /\bclass\s+[\w$]+/, /\breturn\b/,
    ].filter((re) => re.test(body)).length;
    if (jsSignals >= 2 || /^\s*(const|let|var)\s+[\w$]+\s*=[^\n]*;\s*$/m.test(body)) return 'javascript';
    if (lines.length >= 2
      && lines.every((l) => !l.trim() || /^(\s*-\s|\s*#|\s*[\w.$-]+\s*:(\s|$))/.test(l))
      && /^\s*[\w.$-]+\s*:/m.test(body)) return 'yaml';
    return null;
  },

  REF_SKIP_SELECTOR: 'pre, code, .vditor-ir__marker, .vditor-ir__preview',

  railSpec(headings) {
    if (!Array.isArray(headings) || headings.length < 3) return [];
    return headings.map((h) => ({
      level: h.level,
      text: h.text,
      width: Math.max(6, 20 - h.level * 3),
    }));
  },

  currentSection(tops, line) {
    let current = tops.length ? 0 : -1;
    tops.forEach((top, i) => { if (top <= line + 1) current = i; });
    return current;
  },

  scrollBoxIndex(boxes) {
    return (Array.isArray(boxes) ? boxes : []).findIndex((b) =>
      /^(auto|scroll|overlay)$/.test(b?.overflowY ?? '')
      && b.scrollHeight > b.clientHeight + 1);
  },

  scrollTopFor({
    scrollTop = 0, scrollHeight = 0, viewTop = 0, viewHeight = 0,
    targetTop = 0, targetHeight = 0, block = 'start', padding = 0, bottom = 0,
  } = {}) {
    const toTop = scrollTop + (targetTop - viewTop) - padding;
    if (block === 'nearest') {
      const above = targetTop < viewTop + padding;
      const below = targetTop + targetHeight > viewTop + viewHeight - bottom;
      if (!above && !below) return scrollTop;
      if (below && !above) {
        return Math.min(Math.max(
          scrollTop + (targetTop + targetHeight) - (viewTop + viewHeight - bottom), 0),
        Math.max(0, scrollHeight - viewHeight));
      }
    }
    return Math.min(Math.max(toTop, 0), Math.max(0, scrollHeight - viewHeight));
  },

  foldRange(blocks, i) {
    const out = [];
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[j] != null && blocks[j] <= blocks[i]) break;
      out.push(j);
    }
    return out;
  },

  isTitleEcho(heading, name) {
    const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    return norm(name) !== '' && norm(heading) === norm(name);
  },

  BLOCK_KINDS: {
    text: ['', 'Text'],
    h1: ['# ', 'Heading'],
    h2: ['## ', 'Heading'],
    h3: ['### ', 'Heading'],
    h4: ['#### ', 'Heading'],
    h5: ['##### ', 'Heading'],
    h6: ['###### ', 'Heading'],
    bullet: ['- ', 'List item'],
    number: ['1. ', 'List item'],
    task: ['- [ ] ', 'To do'],
    quote: ['> ', 'Quote'],
  },
  BLOCK_MARKER_RE: /\u2063block:([a-z0-9]+)\u2063/,
  blockMarker(kind) {
    return `\u2063block:${kind}\u2063`;
  },

  liveMathElements(root) {
    const found = [...(root ?? globalThis.document).querySelectorAll('.language-math')];
    return {
      length: found.length,
      forEach(fn) {
        for (const node of found) if (node.parentElement) fn(node);
      },
    };
  },

  TASK_BOX_RE: /^(\s*(?:[-*+]|\d+[.)]) )\[([ xX])\] {1,2}(?=\S)/,
  normalizeTaskBoxes(md) {
    const src = String(md ?? '');
    if (!src) return src;
    let fenced = false;
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:```|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
      if (fenced) continue;
      lines[i] = lines[i].replace(this.TASK_BOX_RE, (m, lead, box) => `${lead}[${box === ' ' ? ' ' : 'x'}] `);
    }
    return lines.join('\n');
  },
  lineWords(line) {
    const [, , rest] = String(line ?? '').trimEnd().match(/^(\s*)(.*)$/);
    return rest
      .replace(/^(?:>\s?)+/, '')
      .replace(/^(?:#{1,6}|(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?)(?:\s+|$)/, '')
      .trim();
  },
  convertLine(line, kind) {
    const src = String(line ?? '');
    const spec = this.BLOCK_KINDS[kind];
    if (!spec) return src;
    const [, indent] = src.trimEnd().match(/^(\s*)(.*)$/);
    return `${indent}${spec[0]}${this.lineWords(src) || spec[1]}`;
  },

  convertMarkedLine(md) {
    const src = String(md ?? '');
    const hit = src.match(this.BLOCK_MARKER_RE);
    if (!hit) return null;
    const lines = src.split('\n');
    let at = lines.findIndex((l) => l.includes(hit[0]));
    const cut = lines[at].indexOf(hit[0]);
    const before = lines[at].slice(0, cut);
    const after = lines[at].slice(cut + hit[0].length);
    const line = before.trim() ? before.replace(/[ \u00a0]$/, '') + after : before + after.trimStart();
    const fenced = lines.slice(0, at).filter((l) => /^\s*(?:```|~~~)/.test(l)).length % 2 === 1;
    if (fenced || /^\s*\|/.test(line)) {
      lines[at] = line.trimEnd();
      return { md: lines.join('\n'), line: -1, select: '' };
    }
    const spec = this.BLOCK_KINDS[hit[1]];
    const select = spec && !this.lineWords(line) ? spec[1] : '';
    lines[at] = this.convertLine(line, hit[1]);
    if (!/^(?:bullet|number|task)$/.test(hit[1])) {
      if (lines[at + 1]?.trim()) lines.splice(at + 1, 0, '');
      if (lines[at - 1]?.trim()) { lines.splice(at, 0, ''); at += 1; }
    }
    return { md: lines.join('\n'), line: at, select };
  },
};
