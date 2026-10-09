(function (root) {
  const HUE_HEX = {
    slate: '',
    blue: '#4769eb',
    green: '#2ea043',
    amber: '#f59f00',
    red: '#e5484d',
    purple: '#8e4ec6',
    cyan: '#00a2c7',
    pink: '#d6409f',
    teal: '#12a594',
    orange: '#f76b15',
  };
  const HUES = Object.keys(HUE_HEX);

  const RAMP_ORDER = ['blue', 'green', 'amber', 'purple', 'red', 'cyan', 'orange', 'teal', 'pink'];

  const CATEGORIES = [
    { id: 'not-started', label: 'Not started', hue: 'slate', icon: '○' },
    { id: 'in-progress', label: 'In progress', hue: 'blue', icon: '◑' },
    { id: 'done', label: 'Done', hue: 'green', icon: '✓' },
    { id: 'canceled', label: 'Canceled', hue: 'red', icon: '✕' },
  ];
  const DEFAULT_CATEGORY = 'in-progress';

  const hueForIndex = (i) => {
    const n = Number(i);
    if (!Number.isFinite(n) || n < 0) return RAMP_ORDER[0];
    return RAMP_ORDER[Math.floor(n) % RAMP_ORDER.length];
  };

  const BY_HEX = new Map(
    Object.entries(HUE_HEX).filter(([, hex]) => hex).map(([name, hex]) => [hex.toLowerCase(), name]),
  );
  const hueFromHex = (hex) => BY_HEX.get(String(hex ?? '').trim().toLowerCase()) ?? 'slate';

  const HUE_ALIAS = { magenta: 'pink', neutral: 'slate' };

  function hueName(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) return 'slate';
    if (HUE_HEX[s] !== undefined) return s;
    return HUE_ALIAS[s] ?? BY_HEX.get(s);
  }

  function hueForName(name) {
    const s = String(name ?? '').trim();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return RAMP_ORDER[h % RAMP_ORDER.length];
  }

  function initialsFor(name) {
    const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  const categoryOrDefault = (c) =>
    (CATEGORIES.some((x) => x.id === c) ? c : DEFAULT_CATEGORY);

  const categoryHue = (c) =>
    (CATEGORIES.find((x) => x.id === categoryOrDefault(c)) ?? CATEGORIES[1]).hue;

  const stateHue = (s, c) => (s?.hue && hueName(s.hue)) || categoryHue(c ?? s?.category);

  root.chipCore = {
    HUES, HUE_HEX, HUE_ALIAS, RAMP_ORDER, CATEGORIES, DEFAULT_CATEGORY,
    hueForIndex, hueFromHex, hueName, hueForName, initialsFor, categoryOrDefault, categoryHue, stateHue,
  };
})(typeof window !== 'undefined' ? window : globalThis);
