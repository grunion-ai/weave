/* Pure logic behind the chip system (design review 2026-08-24, set E at 4px
   with no pointer fill). Three tiers carry the whole row:

     value    a filled tint, no border   — the value was chosen from a set
     pointer  a 1px outline plus ↗       — clicking goes somewhere
     computed a glyph, then the value    — not yours to type

   Only the value tier spends colour, and it spends it out of one ten-hue
   ramp rather than whatever hex an author happened to pick. That is what
   lives here: the ramp, the rotation a new option walks, the migration from
   the seven hexes options already store, the hash that gives a colleague the
   same avatar colour in every table, and the four state categories left after
   'other' was retired.

   Classic script + ESM in one file, same pattern as nl-date.js and
   field-dialog-core.js: the browser reads the window global, node imports the
   same source (test/chip-system.test.mjs). */
(function (root) {
  /* Every hue resolves to one hex. The first seven are exactly the values
     public/field-dialog-core.js already ships as OPTION_COLORS, so migrating a
     stored option is a rename and never a nearest-colour guess — the contract
     test pins that. teal and orange are new; slate is the resting colour an
     uncoloured option falls back to, which is why it has no hex. */
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

  /* What a new option gets before anyone decides anything. Slate is absent on
     purpose: it means "nobody chose", so handing it out automatically would
     make an unset option indistinguishable from a deliberately grey one. */
  const RAMP_ORDER = ['blue', 'green', 'amber', 'purple', 'red', 'cyan', 'orange', 'teal', 'pink'];

  /* A category owns its colour — status has to mean the same thing in every
     table, so this is the one part of the ramp an author cannot repaint. The
     glyphs are drawn from field-dialog-core's STATE_ICONS. */
  const CATEGORIES = [
    { id: 'not-started', hue: 'slate', icon: '○' },
    { id: 'in-progress', hue: 'blue', icon: '◑' },
    { id: 'done', hue: 'green', icon: '✓' },
    { id: 'canceled', hue: 'red', icon: '✕' },
  ];
  const DEFAULT_CATEGORY = 'in-progress';

  const hueForIndex = (i) => {
    const n = Number(i);
    if (!Number.isFinite(n) || n < 0) return RAMP_ORDER[0];
    return RAMP_ORDER[Math.floor(n) % RAMP_ORDER.length];
  };

  /* Stored options hold a hex. Read it back as a ramp name; anything we do not
     recognise rests on slate rather than reintroducing a loose colour. */
  const BY_HEX = new Map(
    Object.entries(HUE_HEX).filter(([, hex]) => hex).map(([name, hex]) => [hex.toLowerCase(), name]),
  );
  const hueFromHex = (hex) => BY_HEX.get(String(hex ?? '').trim().toLowerCase()) ?? 'slate';

  /* An avatar's colour is hashed from the name, so the same colleague is the
     same colour everywhere without anyone configuring it. Nine hues means two
     people sometimes collide — the initials still separate them, and a photo
     removes the question. */
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

  /* 'other' was retired on 2026-08-24 — a purple escape hatch no seeded
     workflow used. Anything still stored as it was describing in-progress. */
  const categoryOrDefault = (c) =>
    (CATEGORIES.some((x) => x.id === c) ? c : DEFAULT_CATEGORY);

  const categoryHue = (c) =>
    (CATEGORIES.find((x) => x.id === categoryOrDefault(c)) ?? CATEGORIES[1]).hue;

  root.chipCore = {
    HUES, HUE_HEX, RAMP_ORDER, CATEGORIES, DEFAULT_CATEGORY,
    hueForIndex, hueFromHex, hueForName, initialsFor, categoryOrDefault, categoryHue,
  };
})(typeof window !== 'undefined' ? window : globalThis);
