(function (root) {
  const SLOTS = ['lead', 'chips', 'off'];
  const LONG_FORM = ['document', 'view'];
  const KEYS = ['lead', 'chips', 'labels', 'wrap'];

  const eligible = (f) => !!f && f.role !== 'name';

  function defaults(fields, shown = []) {
    const by = new Map(fields.map((f) => [f.name, f]));
    const lead = fields.find((f) => f.type === 'workflow' && eligible(f))?.name ?? null;
    const chips = shown.filter((n) => n !== lead && eligible(by.get(n)) && !LONG_FORM.includes(by.get(n).type));
    return { lead, chips: [...new Set(chips)], labels: false, wrap: false };
  }

  function resolve(fields, shown, saved) {
    if (!saved) return defaults(fields, shown);
    const by = new Map(fields.map((f) => [f.name, f]));
    const lead = eligible(by.get(saved.lead)) ? saved.lead : null;
    const chips = [...new Set(saved.chips ?? [])].filter((n) => n !== lead && eligible(by.get(n)));
    return { lead, chips, labels: !!saved.labels, wrap: !!saved.wrap };
  }

  const slotOf = (cfg, name) => (cfg.lead === name ? 'lead' : cfg.chips.includes(name) ? 'chips' : 'off');

  function rows(fields, cfg) {
    const pool = fields.filter(eligible);
    const by = new Map(pool.map((f) => [f.name, f]));
    const picked = [cfg.lead, ...cfg.chips].map((n) => by.get(n)).filter(Boolean);
    const off = pool.filter((f) => slotOf(cfg, f.name) === 'off');
    return [...picked, ...off].map((f) => ({ name: f.name, type: f.type, slot: slotOf(cfg, f.name) }));
  }

  function setSlot(cfg, name, slot) {
    if (!SLOTS.includes(slot)) throw new Error(`a phone row slot is lead, chips or off — got ${JSON.stringify(slot)}`);
    const chips = cfg.chips.filter((n) => n !== name);
    const lead = cfg.lead === name ? null : cfg.lead;
    if (slot === 'lead') return { ...cfg, lead: name, chips };
    if (slot === 'chips') return { ...cfg, lead, chips: [...chips, name] };
    return { ...cfg, lead, chips };
  }

  function moveChip(cfg, name, to) {
    const chips = cfg.chips.filter((n) => n !== name);
    if (chips.length === cfg.chips.length) return cfg;
    chips.splice(Math.max(0, Math.min(to, chips.length)), 0, name);
    return { ...cfg, chips };
  }

  function compact(cfg) {
    return { lead: cfg.lead ?? null, chips: [...cfg.chips], ...(cfg.labels ? { labels: true } : {}), ...(cfg.wrap ? { wrap: true } : {}) };
  }

  const TAP = {
    workflow: 'picker', select: 'picker', multiselect: 'picker', relation: 'picker',
    checkbox: 'toggle', toggle: 'toggle', date: 'date', number: 'value', text: 'value', url: 'value', email: 'value',
  };
  const tapAction = (type) => TAP[type] ?? null;

  const HIT = 44;
  const REACH = 8;
  const AXES = [['left', 'right'], ['top', 'bottom']];

  function grow(lo, hi, min, max) {
    const pad = Math.max(REACH, (HIT - (hi - lo)) / 2);
    let a = lo - pad, b = hi + pad;
    if (b - a >= max - min) return [Math.max(a, min), Math.min(b, max)];
    if (a < min) { b += min - a; a = min; }
    if (b > max) { a -= b - max; b = max; }
    return [a, b];
  }

  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const shortSide = (b) => Math.min(b.right - b.left, b.bottom - b.top);

  function split(a, b, ra, rb) {
    const cuts = AXES.map(([lo, hi]) => {
      const first = ra[hi] <= rb[lo];
      const [l, h, rl, rh] = first ? [a, b, ra, rb] : [b, a, rb, ra];
      const gap = rh[lo] - rl[hi];
      if (gap < 0) return null;
      const mid = (rl[hi] + rh[lo]) / 2;
      const nl = { ...l, [hi]: Math.min(l[hi], mid) }, nh = { ...h, [lo]: Math.max(h[lo], mid) };
      return { gap, score: Math.min(shortSide(nl), shortSide(nh)), apply: () => { l[hi] = nl[hi]; h[lo] = nh[lo]; } };
    }).filter(Boolean);
    cuts.sort((x, y) => y.score - x.score || y.gap - x.gap)[0]?.apply();
  }

  function hitBoxes(row, rects) {
    const boxes = rects.map((r) => {
      const [left, right] = grow(r.left, r.right, row.left, row.right);
      const [top, bottom] = grow(r.top, r.bottom, row.top, row.bottom);
      return { left, top, right, bottom };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i], boxes[j])) split(boxes[i], boxes[j], rects[i], rects[j]);
    }
    return boxes;
  }

  root.weavePhoneRow = { SLOTS, LONG_FORM, KEYS, HIT, defaults, resolve, slotOf, rows, setSlot, moveChip, compact, tapAction, hitBoxes };
})(typeof window !== 'undefined' ? window : globalThis);
