/* The drawing behind the rich cells — pure: numbers in, SVG markup out, no
   DOM. Classic script + ESM in one file (the view-core.js pattern): the
   browser reads the window global, node imports the same source for
   test/cell-graphics.test.mjs. app.js puts the markup in a grid cell, a chip
   segment or a card, beside the value's own text.

   The number display (Feature #230), the rating's icons (Feature #231) and
   the sparkline (Feature #232).
   The number display: a bar or a ring filled to the value's
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

  /* The rating (Feature #231): how many of the `max` icons are filled, and
     the words a screen reader hears. A lookup or a rollup can hand over a
     fraction (an average of 3.5); the icons round it, the API keeps it. */
  function ratingParts(value, max) {
    const m = Number.isInteger(max) && max > 0 ? max : 5;
    if (value == null || value === '' || !Number.isFinite(Number(value))) return { filled: 0, max: m, label: `unrated, of ${m}` };
    const filled = Math.min(m, Math.max(0, Math.round(Number(value))));
    return { filled, max: m, label: `${filled} of ${m}` };
  }
  /* Clicking the nth icon sets n; clicking the one that is the value clears it. */
  const ratingClick = (current, n) => (Number(current) === n ? 0 : n);

  /* The sparkline (Feature #232): a formula's list drawn as a line, columns
     or win/loss bars. The newest SPARK_CAP points are drawn — a series is
     read left to right, oldest first — and the hover lists every value. A
     blank slot is a gap in the line and an empty column. */
  const SPARK_CAP = 60;
  const SPARK_W = 80, SPARK_H = 18, PAD = 1.5;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  function sparkPoints(values, cap = SPARK_CAP) {
    const list = Array.isArray(values) ? values : [];
    return { shown: list.slice(-cap), total: list.length, capped: list.length > cap };
  }
  const fmt = (v) => (isNum(v) ? String(Math.round(v * 100) / 100) : '–');
  function sparkTitle(values, cap = SPARK_CAP) {
    const { total, capped } = sparkPoints(values, cap);
    const list = (Array.isArray(values) ? values : []).map(fmt).join(', ');
    return capped ? `${list}\n(drawing the last ${cap} of ${total})` : list;
  }
  function sparkLabel(values) {
    const nums = (Array.isArray(values) ? values : []).filter(isNum);
    if (!nums.length) return 'no values';
    return `${nums.length} value${nums.length === 1 ? '' : 's'}, last ${fmt(nums[nums.length - 1])}, low ${fmt(Math.min(...nums))}, high ${fmt(Math.max(...nums))}`;
  }
  function sparkSvg(style, values, { cap = SPARK_CAP } = {}) {
    const pts = sparkPoints(values, cap).shown;
    const nums = pts.filter(isNum);
    if (!nums.length) return '';
    const n = pts.length;
    const open = `<svg class="cg cg-spark cg-spark-${style}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" ${SVG}>`;
    const slot = (SPARK_W - 2 * PAD) / n;
    if (style === 'winloss') {
      const mid = SPARK_H / 2, h = mid - PAD, w = Math.max(1, slot * 0.7);
      const bars = pts.map((v, i) => (isNum(v) && v !== 0
        ? `<rect class="cg-fill cg-${v > 0 ? 'win' : 'loss'}" x="${r2(PAD + i * slot + (slot - w) / 2)}" y="${r2(v > 0 ? PAD : mid)}" width="${r2(w)}" height="${r2(h)}"/>`
        : '')).join('');
      return `${open}<line class="cg-track" x1="0" x2="${SPARK_W}" y1="${mid}" y2="${mid}"/>${bars}</svg>`;
    }
    const lo = Math.min(...nums), hi = Math.max(...nums);
    if (style === 'column') {
      // Columns stand on zero when the series crosses it, else on its floor.
      const base = Math.min(0, lo), top = Math.max(0, hi);
      const span = top - base || 1;
      const y = (v) => PAD + (1 - (v - base) / span) * (SPARK_H - 2 * PAD);
      const zero = y(Math.min(Math.max(0, base), top));
      const w = Math.max(1, slot * 0.7);
      return open + pts.map((v, i) => {
        if (!isNum(v)) return '';
        const yv = y(v);
        const h = Math.max(1, Math.abs(zero - yv));
        return `<rect class="cg-fill${v < 0 ? ' cg-neg' : ''}" x="${r2(PAD + i * slot + (slot - w) / 2)}" y="${r2(Math.min(yv, zero))}" width="${r2(w)}" height="${r2(h)}"/>`;
      }).join('') + '</svg>';
    }
    // line
    const span = hi - lo;
    const x = (i) => (n === 1 ? SPARK_W / 2 : PAD + (i * (SPARK_W - 2 * PAD)) / (n - 1));
    const y = (v) => (span ? PAD + (1 - (v - lo) / span) * (SPARK_H - 2 * PAD) : SPARK_H / 2);
    if (nums.length === 1) {
      const i = pts.findIndex(isNum);
      return `${open}<circle class="cg-dot" cx="${r2(x(i))}" cy="${r2(y(pts[i]))}" r="1.8"/></svg>`;
    }
    let d = '', pen = false;
    pts.forEach((v, i) => {
      if (!isNum(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${r2(x(i))} ${r2(y(v))}`;
      pen = true;
    });
    const last = pts.length - 1 - [...pts].reverse().findIndex(isNum);
    return `${open}<path class="cg-fill" d="${d}" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
      + `<circle class="cg-dot" cx="${r2(x(last))}" cy="${r2(y(pts[last]))}" r="1.8"/></svg>`;
  }

  root.weaveCellGraphics = { DISPLAYS, isGraphic, share, meterSvg, meterTitle, ratingParts, ratingClick, SPARK_CAP, sparkPoints, sparkTitle, sparkLabel, sparkSvg };
})(globalThis);
