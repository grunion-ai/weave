export function inkOn(node, prop = 'color') {
  const parse = (c) => {
    const m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) { const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [r, g, b, a]; }
    const k = c.match(/^color\(srgb ([^)]+)\)/);
    if (k) { const [r, g, b, a = 1] = k[1].split(/[ /]+/).filter(Boolean).map((v, i) => (i < 3 ? Number(v) * 255 : Number(v))); return [r, g, b, a]; }
    return [0, 0, 0, 0];
  };
  const layers = [];
  for (let n = node; n; n = n.parentElement) {
    const bg = parse(getComputedStyle(n).backgroundColor);
    if (bg[3] > 0) layers.push(bg);
    if (bg[3] >= 1) break;
  }
  let base = [255, 255, 255];
  for (const [r, g, b, a] of layers.reverse()) base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
  const ink = parse(getComputedStyle(node)[prop]).slice(0, 3);
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [hi, lo] = [lum(ink), lum(base)].sort((x, y) => y - x);
  return { ink: ink.map(Math.round), base: base.map(Math.round), ratio: (hi + 0.05) / (lo + 0.05) };
}
