export const MIN = 44;
export const SPAN = MIN - 1;
export const SHRINK = 2;
export const NOTE = '_';

export const SWEEP = (roots) => {
  const SEL = 'a[href], button, [role="button"], summary, input:not([type="hidden"]), select, textarea, .text-dressed, tbody tr.entity-row';
  const tops = roots.flatMap((r) => [...document.querySelectorAll(r)]);
  const inRoot = (n) => tops.some((t) => t.contains(n));
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height || !n.getClientRects().length) return false;
    const shut = n.closest('details:not([open])');
    if (n.disabled || (shut && n !== shut.querySelector(':scope > summary'))) return false;
    const cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  };
  const label = (n) => {
    const cls = [...n.classList].slice(0, 2).join('.');
    const name = (n.getAttribute('aria-label') || n.title || n.dataset.field || (n.textContent || '').trim().slice(0, 32) || '').replace(/\s+/g, ' ');
    return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${name}"`;
  };
  const kind = (n) => {
    const cls = [...n.classList].slice(0, 2).join('.');
    const name = (n.getAttribute('aria-label') || n.title || n.dataset.field || '').replace(/\s+/g, ' ').replace(/\d+/g, '#').trim().slice(0, 40);
    return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${name ? ` "${name}"` : ''}`;
  };
  const owns = (n, hit) => !!hit && (hit === n || n.contains(hit));
  const parked = (n, r) => {
    for (let p = n.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/auto|scroll/.test(cs.overflowY) && !/auto|scroll/.test(cs.overflowX)) continue;
      const b = p.getBoundingClientRect();
      if (r.top < b.top - 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.right > b.right + 1) return true;
    }
    return false;
  };
  const overlay = (n, hit) => {
    for (let p = hit; p && p !== document.documentElement; p = p.parentElement) {
      if (/fixed|sticky/.test(getComputedStyle(p).position)) return !p.contains(n);
    }
    return false;
  };
  const reach = (n, cx, cy, dx, dy) => {
    let far = 0;
    for (let d = 0.5; d <= 22; d += 0.5) {
      const x = cx + dx * d, y = cy + dy * d;
      if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) return 22;
      const hit = document.elementFromPoint(x, y);
      if (!owns(n, hit)) return overlay(n, hit) ? 22 : far;
      far = d;
    }
    return far;
  };
  const found = tops.flatMap((t) => [...t.querySelectorAll(SEL)]).filter(shown);
  const candidates = new Set(found);
  const out = [];
  for (const n of found) {
    const r = n.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
    if (parked(n, r)) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!owns(n, hit)) {
      if (!hit || !inRoot(hit) || overlay(n, hit)) continue;
      let up = hit;
      while (up && !candidates.has(up)) up = up.parentElement;
      if (up && up.contains(n)) continue;
      out.push({ label: label(n), kind: kind(n), left: 0, right: 0, up: 0, down: 0, over: label(hit) });
      continue;
    }
    out.push({
      label: label(n), kind: kind(n),
      left: reach(n, cx, cy, -1, 0), right: reach(n, cx, cy, 1, 0),
      up: reach(n, cx, cy, 0, -1), down: reach(n, cx, cy, 0, 1),
    });
  }
  return out;
};

export const keyOf = (state, kind) => `${state} | ${kind}`;

export function tally(seen) {
  const out = {};
  for (const c of seen) {
    const now = c.over ? [0, 0] : [c.left + c.right, c.up + c.down];
    const was = out[c.kind];
    out[c.kind] = was ? [Math.min(was[0], now[0]), Math.min(was[1], now[1])] : now;
  }
  return out;
}

export const short = ([across, down]) => across < SPAN || down < SPAN;

export function record(state, sizes) {
  return Object.fromEntries(Object.entries(sizes).filter(([, s]) => short(s)).map(([kind, s]) => [keyOf(state, kind), s]).sort(([a], [b]) => (a < b ? -1 : 1)));
}

const floorOf = (was) => (was >= SPAN ? SPAN : was - SHRINK);

export function judge(state, sizes, section) {
  const shrunk = [];
  const loose = [];
  for (const [kind, now] of Object.entries(sizes)) {
    const was = section[keyOf(state, kind)] ?? [MIN, MIN];
    if (now[0] < floorOf(was[0]) || now[1] < floorOf(was[1])) shrunk.push({ kind, was, now });
  }
  const mine = `${state} | `;
  for (const [key, was] of Object.entries(section)) {
    if (!key.startsWith(mine)) continue;
    const kind = key.slice(mine.length);
    const now = sizes[kind];
    if (!now) loose.push({ kind, was, now: null });
    else if (!short(now) || now[0] > was[0] + SHRINK || now[1] > was[1] + SHRINK) loose.push({ kind, was, now });
  }
  return { shrunk, loose };
}

export const statesIn = (section) => [...new Set(Object.keys(section).filter((k) => k !== NOTE).map((k) => k.split(' | ')[0]))];

export function splitList(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && !depth) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function touchFloor(css) {
  const m = css.match(/@media \(pointer: coarse\) \{\s*:root \{ --wv-hit: ([\d.]+px); \}\s*:where\(([\s\S]*?)\):not\(([^)]*)\) \{([^}]*)\}/);
  return m && { hit: m[1], targets: splitList(m[2]), optOuts: splitList(m[3]), body: m[4].trim() };
}
