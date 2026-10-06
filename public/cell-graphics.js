(function (root) {
  const DISPLAYS = ['text', 'bar', 'ring', 'heat'];
  const COLORS = ['ink', 'icon', 'accent'];
  const colorOf = (c) => (COLORS.includes(c) ? c : 'ink');
  const colorClass = (c) => `cg-c-${colorOf(c)}`;
  const ICON_HUES = { star: 'amber', heart: 'rose', zap: 'violet', flame: 'orange' };
  const ratingHue = (icon) => ICON_HUES[String(icon ?? 'lucide:star').replace(/^lucide:/, '')] ?? 'accent';
  const isGraphic = (d) => d != null && d !== 'text' && DISPLAYS.includes(d);
  const r2 = (n) => Math.round(n * 100) / 100;

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

  const BAR_TRACK = 80, RING_PX = 16;
  const RING_STROKE = r2(2.5 * 18 / RING_PX);
  function meterSvg(display, frac) {
    const f = Math.min(1, Math.max(0, Number(frac) || 0));
    if (display === 'bar') {
      return `<svg class="cg cg-bar" viewBox="0 0 100 7.5" ${SVG}>`
        + '<rect class="cg-track" x="0" y="0" width="100" height="7.5" rx="3.75"/>'
        + (f > 0 ? `<rect class="cg-fill" x="0" y="0" width="${r2(f * 100)}" height="7.5" rx="3.75"/>` : '<rect class="cg-fill" x="0" y="0" width="0" height="7.5"/>')
        + '</svg>';
    }
    if (display === 'ring') {
      return `<svg class="cg cg-ring" viewBox="0 0 18 18" ${SVG}>`
        + `<circle class="cg-track" cx="9" cy="9" r="${RING_R}" fill="none" stroke-width="${RING_STROKE}"/>`
        + `<circle class="cg-fill" cx="9" cy="9" r="${RING_R}" fill="none" stroke-width="${RING_STROKE}" stroke-linecap="${f > 0 && f < 1 ? 'round' : 'butt'}"`
        + ` stroke-dasharray="${r2(RING_C * f)} ${r2(RING_C)}" transform="rotate(-90 9 9)"/></svg>`;
    }
    if (display === 'heat') {
      return `<svg class="cg cg-heat" viewBox="0 0 10 10" preserveAspectRatio="none" ${SVG}>`
        + `<rect class="cg-fill" x="0" y="0" width="10" height="10" fill-opacity="${r2(0.08 + 0.32 * f)}" style="--cg-f:${Math.round(f * 100)}%"/></svg>`;
    }
    return '';
  }

  function meterTitle(text, value, scale, scaleText) {
    const f = share(value, scale);
    if (f == null || !(Number(scale) > 0)) return String(text ?? '');
    return `${text} — ${Math.round((Number(value) / Number(scale)) * 100)}% of ${scaleText ?? scale}`;
  }

  function ratingParts(value, max) {
    const m = Number.isInteger(max) && max > 0 ? max : 5;
    if (value == null || value === '' || !Number.isFinite(Number(value))) return { filled: 0, max: m, label: `unrated, of ${m}` };
    const filled = Math.min(m, Math.max(0, Math.round(Number(value))));
    return { filled, max: m, label: `${filled} of ${m}` };
  }
  const ratingClick = (current, n) => (Number(current) === n ? 0 : n);

  const SPARK_CAP = 60;
  const SPARK_W = 80, SPARK_H = 18, PAD = 2;
  const WL_BLOCK = 5, DOT_R = 2;
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
      const mid = SPARK_H / 2, h = WL_BLOCK, w = Math.max(1, slot * 0.7);
      const bars = pts.map((v, i) => (isNum(v) && v !== 0
        ? `<rect class="cg-fill cg-${v > 0 ? 'win' : 'loss'}" x="${r2(PAD + i * slot + (slot - w) / 2)}" y="${r2(v > 0 ? mid - 1 - h : mid + 1)}" width="${r2(w)}" height="${h}" rx="1"/>`
        : '')).join('');
      return `${open}<line class="cg-track" x1="0" x2="${SPARK_W}" y1="${mid}" y2="${mid}"/>${bars}</svg>`;
    }
    const lo = Math.min(...nums), hi = Math.max(...nums);
    if (style === 'column') {
      const base = Math.min(0, lo), top = Math.max(0, hi);
      const span = top - base || 1;
      const y = (v) => PAD + (1 - (v - base) / span) * (SPARK_H - 2 * PAD);
      const zero = y(Math.min(Math.max(0, base), top));
      const w = Math.max(1, slot * 0.7);
      return open + pts.map((v, i) => {
        if (!isNum(v)) return '';
        const yv = y(v);
        const h = Math.max(1, Math.abs(zero - yv));
        return `<rect class="cg-fill${v < 0 ? ' cg-neg' : ''}" x="${r2(PAD + i * slot + (slot - w) / 2)}" y="${r2(Math.min(yv, zero))}" width="${r2(w)}" height="${r2(h)}" rx="1.5"/>`;
      }).join('') + '</svg>';
    }
    const span = hi - lo;
    const x = (i) => (n === 1 ? SPARK_W / 2 : PAD + (i * (SPARK_W - 2 * PAD)) / (n - 1));
    const y = (v) => (span ? PAD + (1 - (v - lo) / span) * (SPARK_H - 2 * PAD) : SPARK_H / 2);
    if (nums.length === 1) {
      const i = pts.findIndex(isNum);
      return `${open}<circle class="cg-dot" cx="${r2(x(i))}" cy="${r2(y(pts[i]))}" r="${DOT_R}"/></svg>`;
    }
    let d = '', pen = false;
    pts.forEach((v, i) => {
      if (!isNum(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${r2(x(i))} ${r2(y(v))}`;
      pen = true;
    });
    const last = pts.length - 1 - [...pts].reverse().findIndex(isNum);
    return `${open}<path class="cg-fill" d="${d}" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
      + `<circle class="cg-dot" cx="${r2(x(last))}" cy="${r2(y(pts[last]))}" r="${DOT_R}"/></svg>`;
  }

  root.weaveCellGraphics = { DISPLAYS, COLORS, colorOf, colorClass, ratingHue, BAR_TRACK, RING_PX, SPARK_W, SPARK_H, isGraphic, share, meterSvg, meterTitle, ratingParts, ratingClick, SPARK_CAP, sparkPoints, sparkTitle, sparkLabel, sparkSvg };
})(globalThis);
