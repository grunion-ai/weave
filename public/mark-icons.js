/* The marks, drawn (Issue #87, Kyle 2026-08-26).

   A mark used to be the Unicode character itself — '◔', '⟳' — rendered at the
   font size. A font gives each of those its own advance width and its own
   optical size, so a quarter-filled circle came out visibly smaller than a
   tick beside it, and the refresh glyph smaller still. No size scale can fix
   that: the box was the right size, the ink inside it was not.

   So every mark is a flat vector on the same 0 0 24 24 canvas as the vendored
   icon set, at the same weight, inheriting currentColor. The KEY IS THE
   CHARACTER — a row that stored '✓' three months ago keeps working and simply
   starts drawing. Nothing migrates.

   Since 2026-09-02 the set beside these is Lucide (stroke 2.0, moving), so the
   ring is 2.0 thick and every stroke is 2.0 — a mark sits level with the icon
   next to it. A mark Lucide also draws (tick, cross, flag, target…) takes the
   Lucide shape through `twin`, motion included; the six progress rings have no
   twin and stay here. Classic script + ESM in one file, the date-core
   pattern: the browser reads the global, node imports the same source. */
(function (root) {
  /* One ring, reused by the whole progress family. Outer r 9.4, inner r 7.4 —
     a 2.0 ring, the hole cut with evenodd rather than a second colour. */
  const RING = 'M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 1 0 0-18.8Zm0 2a7.4 7.4 0 1 1 0 14.8 7.4 7.4 0 1 1 0-14.8Z';
  /* Wedges start at twelve o'clock and sweep clockwise, r 5.4 — clear of the
     ring's inner edge, so the two never touch. */
  const fill = (d) => `<path fill-rule="evenodd" clip-rule="evenodd" d="${d}"/>`;
  const line = (d, w = 2) =>
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
    '\u25b6': '<path d="M8.4 5.3 18.4 12 8.4 18.7Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
    '\u26d3': line('M9.9 14.1a4.3 4.3 0 0 1 0-6.1l2.6-2.6a4.3 4.3 0 0 1 6.1 6.1l-1.3 1.3')
       + line('M14.1 9.9a4.3 4.3 0 0 1 0 6.1l-2.6 2.6a4.3 4.3 0 0 1-6.1-6.1l1.3-1.3'),
    '\u2301': fill('M13.9 2.4a.95.95 0 0 1 .92 1.17l-1.13 5.03h3.5a.95.95 0 0 1 .77 1.5l-7.9 11a.95.95 0 0 1-1.72-.72l1.13-5.03h-3.5a.95.95 0 0 1-.77-1.5l7.9-11a.95.95 0 0 1 .8-.45Z'),
    '\u25ce': fill(RING) + fill('M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 1 0 0-8.8Zm0 2.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 1 1 0-4.4Z'),

    // ---- chrome: controls, not values, but the same weight and box ----
    '⟳': line('M19.2 12a7.2 7.2 0 1 1-2.2-5.2') + line('M19.6 3.6v3.9h-3.9'),
    '⛶': line('M9.2 4.4H5.8a1.4 1.4 0 0 0-1.4 1.4v3.4M14.8 4.4h3.4a1.4 1.4 0 0 1 1.4 1.4v3.4M19.6 14.8v3.4a1.4 1.4 0 0 1-1.4 1.4h-3.4M9.2 19.6H5.8a1.4 1.4 0 0 1-1.4-1.4v-3.4'),
    '⧉': line('M9.2 9.2h8.2a2.2 2.2 0 0 1 2.2 2.2v8.2a2.2 2.2 0 0 1-2.2 2.2H9.2A2.2 2.2 0 0 1 7 19.6v-8.2a2.2 2.2 0 0 1 2.2-2.2Z')
       + line('M15.6 6.6v-.8a2.2 2.2 0 0 0-2.2-2.2H5.2A2.2 2.2 0 0 0 3 5.8v8.2a2.2 2.2 0 0 0 2.2 2.2H6'),
    '‹': line('M15 5.2 8.2 12l6.8 6.8'),
    '↑': line('M12 19.4V5.2M6.4 10.8 12 5.2l5.6 5.6'),
    '↓': line('M12 4.6v14.2M17.6 13.2 12 18.8l-5.6-5.6'),
    /* Iconly's only plus is `plus`, a filled rounded square, and beside a
       hairline pencil in the field menu it was the darkest thing on the panel
       (Kyle, 2026-08-27). A bare cross at the set's weight is what that row
       wanted, and the set did not have one. */
    '+': line('M12 5.4v13.2M5.4 12h13.2'),
  };

  /* Marks that carry meaning as LETTERS stay letters — ƒ is a function, Σ is a
     sum, B is bold. Drawing those as pictures would lose the meaning the
     letterform already carries, so they are deliberately absent here. */
  /* A mark Lucide also draws takes the Lucide shape — the registry names the
     twin, the drawing above stays as the fallback and as the vocabulary. */
  const twin = (ch) => root.weaveIconRegistry?.MARK_TWINS?.[String(ch)] ?? null;

  const has = (ch) => Object.prototype.hasOwnProperty.call(MARKS, String(ch));
  const markSvg = (ch) => (has(ch) ? MARKS[String(ch)] : null);

  root.WEAVE_MARKS = MARKS;
  root.weaveMarkIcons = { MARKS, has, markSvg, twin };
})(globalThis);
