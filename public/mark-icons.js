/* The marks, drawn (Issue #87, Kyle 2026-08-26).

   A mark used to be the Unicode character itself — '◔', '⟳' — rendered at the
   font size. A font gives each of those its own advance width and its own
   optical size, so a quarter-filled circle came out visibly smaller than a
   tick beside it, and the refresh glyph smaller still. No size scale can fix
   that: the box was the right size, the ink inside it was not.

   So every mark is a flat vector on the same 0 0 24 24 canvas as the vendored
   Iconly set, at the same weight, inheriting currentColor. The KEY IS THE
   CHARACTER — a row that stored '✓' three months ago keeps working and simply
   starts drawing. Nothing migrates.

   Ring thickness is 2.5 and stroke width 2.6, which puts a stroked mark at the
   same density as a filled Iconly glyph beside it. Classic script + ESM in one file, the date-core
   pattern: the browser reads the global, node imports the same source. */
(function (root) {
  /* One ring, reused by the whole progress family. Outer r 9.4, inner r 6.9 —
     the hole is cut with evenodd rather than a second colour. */
  const RING = 'M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 1 0 0-18.8Zm0 2.5a6.9 6.9 0 1 1 0 13.8 6.9 6.9 0 1 1 0-13.8Z';
  /* Wedges start at twelve o'clock and sweep clockwise, r 5.4 — clear of the
     ring's inner edge, so the two never touch. */
  const fill = (d) => `<path fill-rule="evenodd" clip-rule="evenodd" d="${d}"/>`;
  const line = (d, w = 2.6) =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  const MARKS = {
    // ---- progress: the family no flat icon set draws ----
    '○': fill(RING),
    '◔': fill(`${RING}M12 12V6.6A5.4 5.4 0 0 1 17.4 12Z`),
    '◐': fill(`${RING}M12 12V17.4A5.4 5.4 0 0 1 12 6.6Z`),
    '◑': fill(`${RING}M12 12V6.6A5.4 5.4 0 0 1 12 17.4Z`),
    '◕': fill(`${RING}M12 12V6.6A5.4 5.4 0 1 1 6.6 12Z`),
    '●': fill('M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 1 0 0-18.8Z'),
    // ---- outcome ----
    '✓': line('M5.4 12.7 9.9 17.2 18.6 6.9'),
    '✕': line('M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5'),
    '⏸': '<rect x="7.3" y="4.1" width="3.7" height="15.8" rx="1.5"/><rect x="13" y="4.1" width="3.7" height="15.8" rx="1.5"/>',
    // ---- attention ----
    '⚑': fill('M6.5 3a1.3 1.3 0 0 1 1.3 1.3v16.4a1.3 1.3 0 0 1-2.6 0V4.3A1.3 1.3 0 0 1 6.5 3Z')
       + fill('M9.4 4.5h8.7c1 0 1.6 1.1 1 1.9l-2 2.7 2 2.7c.6.8 0 1.9-1 1.9H9.4Z'),
    '★': fill('M12 3.3a1 1 0 0 1 .9.6l2.3 4.7 5.2.8a1 1 0 0 1 .6 1.7l-3.8 3.7.9 5.2a1 1 0 0 1-1.5 1.1L12 18.6l-4.6 2.5a1 1 0 0 1-1.5-1.1l.9-5.2-3.8-3.7a1 1 0 0 1 .6-1.7l5.2-.8 2.3-4.7a1 1 0 0 1 .9-.6Z'),
    '!': '<rect x="10.7" y="4.2" width="2.6" height="10.6" rx="1.3"/><circle cx="12" cy="18.5" r="1.7"/>',
    '?': line('M8.7 8.9a3.4 3.4 0 1 1 3.9 3.5v1.9') + '<circle cx="12.4" cy="18.5" r="1.7"/>',
    '→': line('M4.6 12h13.6M12.8 6.6 18.2 12l-5.4 5.4'),

    // ---- accepted 2026-08-26 (Kyle: blocked, link, running, automation,
    // target). Drawn to the same weights and passing the same painted-extent
    // gate as the originals. ----
    '\u2298': fill(RING) + line('M7.3 16.7 16.7 7.3'),
    '\u25b6': '<path d="M8.4 5.3 18.4 12 8.4 18.7Z" fill="currentColor" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>',
    '\u26d3': line('M9.9 14.1a4.3 4.3 0 0 1 0-6.1l2.6-2.6a4.3 4.3 0 0 1 6.1 6.1l-1.3 1.3')
       + line('M14.1 9.9a4.3 4.3 0 0 1 0 6.1l-2.6 2.6a4.3 4.3 0 0 1-6.1-6.1l1.3-1.3'),
    '\u2301': fill('M13.9 2.4a.95.95 0 0 1 .92 1.17l-1.13 5.03h3.5a.95.95 0 0 1 .77 1.5l-7.9 11a.95.95 0 0 1-1.72-.72l1.13-5.03h-3.5a.95.95 0 0 1-.77-1.5l7.9-11a.95.95 0 0 1 .8-.45Z'),
    '\u25ce': fill(RING) + fill('M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 1 0 0-8.8Zm0 2.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4Z'),

    // ---- chrome: controls, not values, but the same weight and box ----
    '⟳': line('M19.2 12a7.2 7.2 0 1 1-2.2-5.2') + line('M19.6 3.6v3.9h-3.9'),
    '⛶': line('M9.2 4.4H5.8a1.4 1.4 0 0 0-1.4 1.4v3.4M14.8 4.4h3.4a1.4 1.4 0 0 1 1.4 1.4v3.4M19.6 14.8v3.4a1.4 1.4 0 0 1-1.4 1.4h-3.4M9.2 19.6H5.8a1.4 1.4 0 0 1-1.4-1.4v-3.4'),
    '⧉': line('M9.2 9.2h8.2a2.2 2.2 0 0 1 2.2 2.2v8.2a2.2 2.2 0 0 1-2.2 2.2H9.2A2.2 2.2 0 0 1 7 19.6v-8.2a2.2 2.2 0 0 1 2.2-2.2Z')
       + line('M15.6 6.6v-.8a2.2 2.2 0 0 0-2.2-2.2H5.2A2.2 2.2 0 0 0 3 5.8v8.2a2.2 2.2 0 0 0 2.2 2.2H6'),
    '‹': line('M14.6 5.6 8.2 12l6.4 6.4'),
    '↑': line('M12 19.4V5.2M6.4 10.8 12 5.2l5.6 5.6'),
    '↓': line('M12 4.6v14.2M17.6 13.2 12 18.8l-5.6-5.6'),
  };

  /* Marks that carry meaning as LETTERS stay letters — ƒ is a function, Σ is a
     sum, B is bold. Drawing those as pictures would lose the meaning the
     letterform already carries, so they are deliberately absent here. */
  /* ---------- our own flat icons ----------
     Iconly free is a closed set of 101 and money was the thinnest corner of
     it: a wallet, a shopping cart and a discount rosette, with no way to draw
     an invoice or a rate. These six fill that in, on the same canvas at the
     same weights, and they live in the SAME `iconly:` namespace so there is
     one value form rather than two. The vendored set is resolved first, so if
     Iconly ever ships a real `card` it wins and nothing stored has to move. */
  const WEAVE_ICONS = {
    /* The two currency signs are drawn, not typed. A letterform normally
       stays a letter — that is why ƒ and Σ are absent from the marks — but a
       currency sign in an icon picker is not doing a letter's job in a
       sentence; it is standing for money on a table header. Drawn, it holds
       the size and weight of everything beside it instead of taking the
       font's. £ and ¥ are the same shape work if they are ever wanted. */
    dollar: line('M12 3.2v17.6')
          + line('M16.6 7.8a3.7 3.7 0 0 0-3.7-2.6h-1.5a3.7 3.7 0 0 0 0 7.4h2.3a3.7 3.7 0 0 1 0 7.4h-1.6a3.7 3.7 0 0 1-3.7-2.6'),
    euro: line('M18.4 6.9a7.1 7.1 0 1 0 0 10.2')
        + line('M4.4 10.5h9.2') + line('M4.4 13.8h9.2'),
  card: line('M5.4 5.4h13.2a3 3 0 0 1 3 3v7.2a3 3 0 0 1-3 3H5.4a3 3 0 0 1-3-3V8.4a3 3 0 0 1 3-3Z')
      + line('M2.4 10.4h19.2'),
  coins: line('M12 3.6c4.5 0 8.1 1.3 8.1 2.9s-3.6 2.9-8.1 2.9S3.9 8.1 3.9 6.5 7.5 3.6 12 3.6Z')
       + line('M3.9 6.9v4.7c0 1.6 3.6 2.9 8.1 2.9s8.1-1.3 8.1-2.9V6.9')
       + line('M3.9 11.9v4.7c0 1.6 3.6 2.9 8.1 2.9s8.1-1.3 8.1-2.9v-4.7'),
  invoice: line('M5.2 3.2h13.6v16.4l-2.27-1.7-2.27 1.7-2.26-1.7-2.27 1.7-2.27-1.7-2.26 1.7Z')
         + line('M8.6 8.2h6.8') + line('M8.6 12h6.8'),
  bank: line('M2.9 9.8 12 4.2l9.1 5.6') + line('M5.6 11.2v7.2') + line('M9.9 11.2v7.2')
      + line('M14.1 11.2v7.2') + line('M18.4 11.2v7.2') + line('M2.9 20.2h18.2'),
  trend: line('M3.2 16.6 9.3 10.5l3.5 3.5 7.9-7.9') + line('M15.3 6.1h5.4v5.4'),
  percent: line('M5.6 18.4 18.4 5.6')
         + line('M8.1 5.1a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z')
         + line('M15.9 12.9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z'),
  };

  /* ---------- correcting the vendored set (Kyle, 2026-08-26: "bug looks too
     small") ----------
     Iconly's own icons do not all fill the canvas. Measured across all 101,
     the median long axis is 20 of 24; five draw far short of it — the four
     `arrow-*2` variants at 12, and `bug` at 14 — so they read as small beside
     any neighbour. The vendor file is pinned and gets overwritten on update,
     so the correction lives here: a uniform scale about the centre, taking
     each one up to the size its siblings already are. */
  const ICON_SCALE = {
    bug: 1.42,             // 14.05 -> 20, the median
    'arrow-down2': 1.5,    // 12 -> 18, matching arrow-down and arrow-down3
    'arrow-up2': 1.5,
    'arrow-left2': 1.5,
    'arrow-right2': 1.5,
  };
  const scaleFor = (name) => ICON_SCALE[name] ?? null;
  /* Wraps inner markup so the scale rides on the geometry, not on the box —
     the icon still occupies exactly the same square. */
  const scaled = (name, markup) => {
    const s = scaleFor(name);
    return s ? `<g transform="translate(12 12) scale(${s}) translate(-12 -12)">${markup}</g>` : markup;
  };

  /* ---------- what the picker stops offering (Kyle, 2026-08-26) ----------
     Twenty-three near-duplicates. Sixteen are arrows: the plain four say the
     direction, and `2`, `3`, `circle` and `square` were four more ways to say
     the same one. The other seven are a second drawing of an icon already in
     the set. Hidden from the PICKER only — the vendor data stays, so a row
     that stored one of these keeps rendering it. */
  const ICON_HIDDEN = new Set([
    'arrow-down2', 'arrow-down3', 'arrow-downcircle', 'arrow-downsquare',
    'arrow-up2', 'arrow-up3', 'arrow-upcircle', 'arrow-upsquare',
    'arrow-left2', 'arrow-left3', 'arrow-leftcircle', 'arrow-leftsquare',
    'arrow-right2', 'arrow-right3', 'arrow-rightcircle', 'arrow-rightsquare',
    'filter2', 'image2', 'voice2', 'bag2', 'moresquare', 'infosquare', 'timesquare',
  ]);
  const offered = (names) => names.filter((n) => !ICON_HIDDEN.has(n));

  const has = (ch) => Object.prototype.hasOwnProperty.call(MARKS, String(ch));
  const markSvg = (ch) => (has(ch) ? MARKS[String(ch)] : null);

  root.WEAVE_MARKS = MARKS;
  root.WEAVE_ICONS = WEAVE_ICONS;
  root.weaveMarkIcons = { MARKS, has, markSvg, ICON_SCALE, scaleFor, scaled, WEAVE_ICONS, ICON_HIDDEN, offered };
})(globalThis);
