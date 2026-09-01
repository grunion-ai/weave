// Small safe formula evaluator for computed fields.
//
// Grammar (precedence low → high):
//   or      := and ('or' and)*
//   and     := cmp ('and' cmp)*
//   cmp     := sum (('='|'!='|'<'|'<='|'>'|'>=') sum)?
//   sum     := prod (('+'|'-') prod)*
//   prod    := unary (('*'|'/'|'%') unary)*
//   unary   := ('-'|'!') unary | atom
//   atom    := number | string | 'true' | 'false' | 'null'
//            | ident '(' args ')' | '[' field name ']' | ident | '(' or ')'
//
// Field references: [Field Name] (bracketed, any chars) or a bare identifier.
// Functions: if(c,a,b), concat(...), round(x,n?), abs, min, max, len, lower,
// upper, trim, contains(hay, needle), empty(x), today(), days(a,b), number(x),
// text(x).

const FUNCS = {
  if: (c, a, b) => (truthy(c) ? a : b),
  concat: (...xs) => xs.map((x) => (x == null ? '' : String(x))).join(''),
  round: (x, n = 0) => {
    const f = 10 ** n;
    return Math.round(Number(x) * f) / f;
  },
  abs: (x) => Math.abs(Number(x)),
  min: (...xs) => Math.min(...xs.map(Number)),
  max: (...xs) => Math.max(...xs.map(Number)),
  len: (x) => (x == null ? 0 : Array.isArray(x) ? x.length : String(x).length),
  lower: (x) => String(x ?? '').toLowerCase(),
  upper: (x) => String(x ?? '').toUpperCase(),
  trim: (x) => String(x ?? '').trim(),
  contains: (hay, needle) =>
    Array.isArray(hay)
      ? hay.includes(needle)
      : String(hay ?? '').toLowerCase().includes(String(needle ?? '').toLowerCase()),
  empty: (x) => x == null || x === '' || (Array.isArray(x) && x.length === 0),
  today: () => new Date().toISOString().slice(0, 10),
  now: () => new Date().toISOString(),
  days: (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000),
  // Date math (Feature #44). Units: days, weeks, months, years. dateadd
  // returns the value's own shape — a date in, a date out.
  dateadd: (date, n, unit = 'days') => {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    const u = String(unit).replace(/s$/, '');
    if (u === 'day') d.setUTCDate(d.getUTCDate() + Number(n));
    else if (u === 'week') d.setUTCDate(d.getUTCDate() + Number(n) * 7);
    else if (u === 'month') d.setUTCMonth(d.getUTCMonth() + Number(n));
    else if (u === 'year') d.setUTCFullYear(d.getUTCFullYear() + Number(n));
    else throw new Error(`Unknown date unit '${unit}'`);
    const iso = d.toISOString();
    return String(date).includes('T') ? iso : iso.slice(0, 10);
  },
  datediff: (a, b, unit = 'days') => {
    const ms = Date.parse(b) - Date.parse(a);
    if (Number.isNaN(ms)) return null;
    const u = String(unit).replace(/s$/, '');
    const per = { day: 86400000, week: 604800000, hour: 3600000, minute: 60000 }[u];
    if (!per) throw new Error(`Unknown date unit '${unit}'`);
    return Math.round(ms / per);
  },
  year: (d) => (d ? new Date(d).getUTCFullYear() : null),
  month: (d) => (d ? new Date(d).getUTCMonth() + 1 : null),
  day: (d) => (d ? new Date(d).getUTCDate() : null),
  number: (x) => Number(x),
  text: (x) => (x == null ? '' : String(x)),
};

function truthy(v) {
  return !(v == null || v === false || v === 0 || v === '');
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const push = (type, value) => tokens.push({ type, value });
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new Error('Unclosed [field] reference');
      push('field', src.slice(i + 1, end).trim());
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1, out = '';
      while (j < src.length && src[j] !== ch) {
        out += src[j] === '\\' ? src[++j] : src[j];
        j++;
      }
      if (j >= src.length) throw new Error('Unclosed string');
      push('string', out);
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = src.slice(i).match(/^[0-9]*\.?[0-9]+/);
      push('number', Number(m[0]));
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      push('ident', m[0]);
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '!=', '=='].includes(two)) {
      push('op', two === '==' ? '=' : two);
      i += 2;
      continue;
    }
    if ('=<>+-*/%(),!'.includes(ch)) {
      push('op', ch);
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' in formula`);
  }
  return tokens;
}

export function evaluate(expression, getField) {
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expectOp = (v) => {
    const t = next();
    if (!t || t.type !== 'op' || t.value !== v) throw new Error(`Expected '${v}'`);
  };

  function parseOr() {
    let left = parseAnd();
    while (peek()?.type === 'ident' && peek().value === 'or') {
      next();
      const right = parseAnd();
      left = truthy(left) || truthy(right);
    }
    return left;
  }
  function parseAnd() {
    let left = parseCmp();
    while (peek()?.type === 'ident' && peek().value === 'and') {
      next();
      const right = parseCmp();
      left = truthy(left) && truthy(right);
    }
    return left;
  }
  function parseCmp() {
    const left = parseSum();
    const t = peek();
    if (t?.type === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(t.value)) {
      next();
      const right = parseSum();
      switch (t.value) {
        case '=': return left === right || String(left) === String(right);
        case '!=': return !(left === right || String(left) === String(right));
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
      }
    }
    return left;
  }
  function parseSum() {
    let left = parseProd();
    while (peek()?.type === 'op' && ['+', '-'].includes(peek().value)) {
      const op = next().value;
      const right = parseProd();
      if (op === '+') {
        left = typeof left === 'string' || typeof right === 'string'
          ? String(left ?? '') + String(right ?? '')
          : Number(left) + Number(right);
      } else {
        left = Number(left) - Number(right);
      }
    }
    return left;
  }
  function parseProd() {
    let left = parseUnary();
    while (peek()?.type === 'op' && ['*', '/', '%'].includes(peek().value)) {
      const op = next().value;
      const right = parseUnary();
      left = op === '*' ? Number(left) * Number(right)
        : op === '/' ? Number(left) / Number(right)
        : Number(left) % Number(right);
    }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (t?.type === 'op' && t.value === '-') { next(); return -Number(parseUnary()); }
    if (t?.type === 'op' && t.value === '!') { next(); return !truthy(parseUnary()); }
    return parseAtom();
  }
  function parseAtom() {
    const t = next();
    if (!t) throw new Error('Unexpected end of formula');
    if (t.type === 'number' || t.type === 'string') return t.value;
    if (t.type === 'field') return getField(t.value);
    if (t.type === 'ident') {
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      if (peek()?.type === 'op' && peek().value === '(') {
        next();
        const args = [];
        if (!(peek()?.type === 'op' && peek().value === ')')) {
          args.push(parseOr());
          while (peek()?.type === 'op' && peek().value === ',') {
            next();
            args.push(parseOr());
          }
        }
        expectOp(')');
        const fn = FUNCS[t.value.toLowerCase()];
        if (!fn) throw new Error(`Unknown function '${t.value}'`);
        return fn(...args);
      }
      return getField(t.value);
    }
    if (t.type === 'op' && t.value === '(') {
      const v = parseOr();
      expectOp(')');
      return v;
    }
    throw new Error(`Unexpected token in formula`);
  }

  const result = parseOr();
  if (pos !== tokens.length) throw new Error('Trailing tokens in formula');
  return result;
}

// Static validation for authoring surfaces (dialog, REST, MCP): parse and
// resolve names without a real row. Field references are checked against
// `fieldNames`; values are stubbed, so this catches syntax errors, unknown
// functions and unknown fields — not data-dependent runtime results.
export function check(expression, fieldNames = []) {
  if (!String(expression ?? '').trim()) return { ok: false, error: 'Formula is empty' };
  const known = new Set([...fieldNames, 'PublicId']);
  try {
    evaluate(expression, (name) => {
      if (!known.has(name)) throw new Error(`Unknown field '${name}'`);
      return 0;
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
