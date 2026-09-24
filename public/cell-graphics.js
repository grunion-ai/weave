/* The drawing behind the rich cells — pure: numbers in, SVG markup out, no
   DOM. Classic script + ESM in one file (the view-core.js pattern): the
   browser reads the window global, node imports the same source for
   test/cell-graphics.test.mjs. app.js puts the markup in a grid cell, a chip
   segment or a card, beside the value's own text.

   The number display (Feature #230): a bar or a ring filled to the value's
   share of its scale, or a heat tint behind the text. The scale is the
   engine's (`scales` on a read): the column max, or a fixed number. Every
   graphic is aria-hidden — the text beside it is what a screen reader reads,
   so the graphic can never say something the value does not. */
(function (root) {
  const DISPLAYS = ['text', 'bar', 'ring', 'heat'];
  const isGraphic = (d) => d != null && d !== 'text' && DISPLAYS.includes(d);
  const r2 = (n) => Math.round(n * 100) / 100;

  /* The value over the scale, held to 0..1; null when there is no value. */
  function share(value, scale) {
    if (value == null || value === '') return null;
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    const s = Number(scale);
    if (!(s > 0)) return 0;
    return Math.min(1, Math.max(0, v / s));
  }

  const RING_R = 7;
  const RING_C = 2 * Math.PI * RING_R;
  const SVG = 'aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"';

  function meterSvg(display, frac) {
    const f = Math.min(1, Math.max(0, Number(frac) || 0));
    if (display === 'bar') {
      return `<svg class="cg cg-bar" viewBox="0 0 100 8" preserveAspectRatio="none" ${SVG}>`
        + '<rect class="cg-track" x="0" y="0" width="100" height="8" rx="2"/>'
        + `<rect class="cg-fill" x="0" y="0" width="${r2(f * 100)}" height="8" rx="2"/></svg>`;
    }
    if (display === 'ring') {
      return `<svg class="cg cg-ring" viewBox="0 0 18 18" ${SVG}>`
        + `<circle class="cg-track" cx="9" cy="9" r="${RING_R}" fill="none" stroke-width="3"/>`
        + `<circle class="cg-fill" cx="9" cy="9" r="${RING_R}" fill="none" stroke-width="3" stroke-linecap="${f > 0 && f < 1 ? 'round' : 'butt'}"`
        + ` stroke-dasharray="${r2(RING_C * f)} ${r2(RING_C)}" transform="rotate(-90 9 9)"/></svg>`;
    }
    if (display === 'heat') {
      // A floor so a cell on the scale reads as tinted at all; a ceiling so
      // the value's text stays legible on the hottest cell in both themes.
      return `<svg class="cg cg-heat" viewBox="0 0 10 10" preserveAspectRatio="none" ${SVG}>`
        + `<rect class="cg-fill" x="0" y="0" width="10" height="10" rx="1.5" fill-opacity="${r2(0.1 + 0.6 * f)}"/></svg>`;
    }
    return '';
  }

  /* The hover: the value, then its share of the scale when there is one. */
  function meterTitle(text, value, scale, scaleText) {
    const f = share(value, scale);
    if (f == null || !(Number(scale) > 0)) return String(text ?? '');
    return `${text} — ${Math.round((Number(value) / Number(scale)) * 100)}% of ${scaleText ?? scale}`;
  }

  root.weaveCellGraphics = { DISPLAYS, isGraphic, share, meterSvg, meterTitle };
})(globalThis);
