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

  root.weavePhoneRow = { SLOTS, LONG_FORM, KEYS, defaults, resolve, slotOf, rows, setSlot, moveChip, compact };
})(typeof window !== 'undefined' ? window : globalThis);
