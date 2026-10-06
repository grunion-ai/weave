export const PALETTE = {
  blue: "#2563eb",
  sky: "#60a5fa",
  ink: "#0c1b33",
  cream: "#e0dcd4",
  ice: "#bcd3ff",
  white: "#ffffff",
};

export function rope(n, pitch, amp = 4) {
  const p = pitch, x0 = 24 - (n * p) / 2, yT = 24 - amp, yB = 24 + amp;
  const seg = (x, yf, yt) => `C${x + p / 2},${yf} ${x + p / 2},${yt} ${x + p},${yt}`;
  let a = `M${x0},${yT}`, b = `M${x0},${yB}`;
  for (let k = 0; k < n; k++) {
    const x = x0 + k * p;
    a += " " + seg(x, k % 2 ? yB : yT, k % 2 ? yT : yB);
    b += " " + seg(x, k % 2 ? yT : yB, k % 2 ? yB : yT);
  }
  const overs = [];
  for (let k = 1; k < n; k += 2) {
    const x = x0 + k * p;
    overs.push(`M${x},${yB} ` + seg(x, yB, yT));
  }
  return { a, b, overs };
}

export const H3 = rope(3, 8);

export const px = n => String(+n.toFixed(2)).replace(/\.0+$/, "");
export const stroke = (d, color, w, extra = "", kids = "") =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${px(w)}" stroke-linecap="round"${extra}` +
  (kids ? `>${kids}</path>` : `/>`);

export function markParts({ c1, c2, sw = 3.5, id = "w", r = H3, kids = {} }) {
  const gw = sw + 2.5;
  const region = 'maskUnits="userSpaceOnUse" x="-24" y="-24" width="96" height="96"';
  const defs =
    `<mask id="${id}A" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
    stroke(r.b, "#000", gw, "", kids.maskB || "") + `</mask>` +
    `<mask id="${id}B" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
    r.overs.map(o => stroke(o, "#000", gw, "", kids.maskOver || "")).join("") + `</mask>`;
  const body =
    stroke(r.a, c1, sw, ` mask="url(#${id}A)"`, kids.a || "") +
    stroke(r.b, c2, sw, ` mask="url(#${id}B)"`, kids.b || "") +
    r.overs.map(o => stroke(o, c1, sw, "", kids.over || "")).join("");
  return { defs, body };
}
