/* Column resize, the pure half (Issues #98, #100, #160).
   The grip in public/app.js reads the pointer and paints; the two numbers it
   needs come from here so they can be pressed without a browser.

   floor: the narrowest a column may go. A header must always show its own
   label — icon, text, sort arrow — plus the padding around it (the right pad
   is where the ⋮ menu sits), and never less than the engine's minimum.

   width: where the column is while the pointer is at x. The SAME number is
   painted on every move and persisted on release — one rounding, one
   floor — so what the reader sees during the drag is what the schema
   stores. A drag that painted one width and stored another is the jump. */
globalThis.WeaveColumnResize = {
  floor({ label = 0, padLeft = 0, padRight = 0, min = 0 } = {}) {
    return Math.max(min, Math.ceil(label + padLeft + padRight));
  },

  width({ base, startX, x, floor = 0 }) {
    return Math.max(floor, Math.round(base + x - startX));
  },
};
