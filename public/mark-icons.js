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
  const has = (ch) => Object.prototype.hasOwnProperty.call(MARKS, String(ch));
  const markSvg = (ch) => (has(ch) ? MARKS[String(ch)] : null);

  root.WEAVE_MARKS = MARKS;
  root.weaveMarkIcons = { MARKS, has, markSvg };
})(globalThis);
