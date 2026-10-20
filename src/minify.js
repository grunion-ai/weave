const WORD = /[\w$\\\u0080-\uffff]/;
const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function spaceNeeded(p, c, after) {
  if (p === '' || p === '\n' || p === '\r') return false;
  const pw = WORD.test(p);
  const cw = WORD.test(c);
  if (pw && cw) return true;
  if (p === '<' && c === '!') return true;
  if (/\d/.test(p) && c === '.') return true;
  if ((p === '+' || p === '-') && c === p) return true;
  if (p === '/' && (c === '/' || c === '*' || (cw && after === 'regex'))) return true;
  return false;
}

export function minifyJs(src) {
  const out = [];
  let last = '';
  const put = (text) => { out.push(text); last = text.at(-1); };
  let pending = false;
  let prev = null;
  let before = null;
  const stack = [];
  const n = src.length;
  let i = 0;
  const emit = (text) => {
    if (pending && spaceNeeded(last, text[0], prev)) put(' ');
    pending = false;
    put(text);
  };
  const template = () => {
    const start = i;
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') i += 2;
      else if (ch === '`') { put(src.slice(start, ++i)); prev = 'template'; return; }
      else if (ch === '$' && src[i + 1] === '{') { i += 2; put(src.slice(start, i)); stack.push('tpl'); prev = '{'; return; }
      else i++;
    }
    throw new Error('unterminated template literal');
  };
  const regexAllowed = () => prev === null || prev === 'kw'
    || (prev.length === 1 && !/[)\]}]/.test(prev) && !((prev === '+' || prev === '-') && before === prev));
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { pending = true; i++; continue; }
    if (c === '\n' || c === '\r') { put(c); pending = false; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
      pending = true;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      const breaks = src.slice(i, end).match(/\r?\n|\r/g);
      if (breaks) { put(breaks.join('')); pending = false; } else pending = true;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\n') throw new Error('unterminated string');
        j += src[j] === '\\' ? 2 : 1;
      }
      if (j >= n) throw new Error('unterminated string');
      emit(src.slice(i, j + 1));
      before = prev; prev = 'string';
      i = j + 1;
      continue;
    }
    if (c === '`') { emit('`'); i++; template(); continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && (inClass || src[j] !== '/')) {
        if (src[j] === '\n') throw new Error('unterminated regular expression');
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      emit(src.slice(i, j));
      before = prev; prev = 'regex';
      i = j;
      continue;
    }
    if (WORD.test(c)) {
      let j = i;
      while (j < n && WORD.test(src[j])) j += src[j] === '\\' ? 2 : 1;
      const word = src.slice(i, j);
      emit(word);
      const kind = KEYWORDS.has(word) && prev !== '.' ? 'kw' : 'word';
      before = prev; prev = kind;
      i = j;
      continue;
    }
    if (c === '}' && stack.at(-1) === 'tpl') {
      stack.pop();
      pending = false;
      put('}');
      i++;
      template();
      continue;
    }
    if (c === '{') stack.push('{');
    else if (c === '}') stack.pop();
    emit(c);
    before = prev; prev = c;
    i++;
  }
  if (stack.length) throw new Error('unbalanced braces');
  return out.join('');
}

const CSS_GLUE = new Set(['{', '}', ';', ',', '>']);

export function minifyCss(src) {
  const out = [];
  let p = '';
  let pending = false;
  let escaped = false;
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { pending = true; i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      i = end + 2;
      pending = true;
      continue;
    }
    let j = i + 1;
    if (c === '"' || c === "'") {
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      if (j >= n) throw new Error('unterminated string');
      j++;
    } else if (c === '\\') {
      const hex = /^[\da-f]{1,6}/i.exec(src.slice(j, j + 6));
      j += hex ? hex[0].length : 1;
    }
    if (pending && p && (escaped || !(CSS_GLUE.has(p) || CSS_GLUE.has(c) || p === ':' || p === '(' || c === ')'))) out.push(' ');
    pending = false;
    escaped = c === '\\';
    out.push(src.slice(i, j));
    p = src[j - 1];
    i = j;
  }
  return out.join('');
}

export function createMinified() {
  const known = new Map();
  return (full, { mtimeMs, size }, read) => {
    const hit = known.get(full);
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.body;
    const raw = read();
    let body = raw;
    try {
      const text = raw.toString('utf8');
      body = Buffer.from(full.endsWith('.css') ? minifyCss(text) : minifyJs(text));
    } catch {}
    known.set(full, { mtimeMs, size, body });
    return body;
  };
}
