export const PAINT_PROBE = `(() => {
  window.huePaint = (hue) => {
    const p = document.createElement('span');
    p.className = 'hue-' + hue;
    p.style.cssText = 'position:absolute;visibility:hidden;background-color:var(--fill);color:var(--text);border:1px solid var(--dot, transparent)';
    document.body.appendChild(p);
    const cs = getComputedStyle(p);
    const out = { fill: cs.backgroundColor, text: cs.color, dot: cs.borderTopColor };
    p.remove();
    return out;
  };
  window.paintOf = (node) => {
    const cs = getComputedStyle(node);
    return { fill: cs.backgroundColor, text: cs.color };
  };
})()`;

export function paintMisses(rows) {
  const misses = [];
  for (const r of rows) {
    if (r.got.fill !== r.want.fill) misses.push(`${r.where}: background ${r.got.fill}, want hue-${r.hue} fill ${r.want.fill}`);
    if (r.got.text !== r.want.text) misses.push(`${r.where}: text ${r.got.text}, want hue-${r.hue} text ${r.want.text}`);
  }
  return misses;
}
