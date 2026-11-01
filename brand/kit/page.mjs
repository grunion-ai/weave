const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const section = (readme, title) => (readme.split(`\n## ${title}\n`)[1] || '').split('\n## ')[0];
const tableRows = (text) => text.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---')).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const bullets = (text) => text.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));

const FAMILIES = [
  ['lockup', 'Lockups', 'Mark and wordmark from build-logos.mjs, the word outlined, placed as they are.'],
  ['badge', 'Badges', 'The sawtooth seal with the mark at the centre. Each treatment belongs on the ground named under it; on the wrong ground the ring disappears.'],
  ['poster', 'Posters', 'Link previews, social posts, banners and stories. The field is part of the file.'],
  ['pattern', 'Patterns', 'Contour fields and endless rope at 1200 × 800 for backgrounds, section breaks and all-over print.'],
  ['icon', 'Icon', 'The product and engineering starter category icon.'],
];
const groundClass = (g) => /#2563eb|brand blue/.test(g) ? 'g-blue' : /ink|night|dark/.test(g) ? 'g-dark' : /paper|print|die-cut/.test(g) ? 'g-paper' : /self-contained/.test(g) ? 'g-none' : 'g-light';

const asset = (a) => `<article class="asset" id="a-${a.id}">
<a class="figure ${groundClass(a.ground || '')}" href="${a.png}" target="_blank" rel="noopener"><img src="${a.png}" alt="${esc(a.name)}" width="${a.width * a.scale}" height="${a.height * a.scale}" loading="lazy"></a>
<div class="asset-head"><span class="code">${esc(a.code)}</span><h3>${esc(a.name)}</h3></div>
<dl class="meta">
<div><dt>File</dt><dd><code>${a.id}</code></dd></div>
<div><dt>Size</dt><dd>${a.width} × ${a.height}</dd></div>
<div><dt>PNG</dt><dd>${a.width * a.scale} × ${a.height * a.scale} <span class="scale">${a.scale}×</span></dd></div>
<div><dt>Ground</dt><dd>${esc(a.ground)}</dd></div>
<div><dt>Use</dt><dd>${esc(a.use.join('; '))}</dd></div>
</dl>${a.note ? `\n<p class="note">${esc(a.note)}</p>` : ''}
<div class="files"><a href="${a.svg}" target="_blank" rel="noopener">SVG</a><a href="${a.png}" target="_blank" rel="noopener">PNG</a></div>
</article>`;

const swatch = (hex, name) => `<div class="swatch"><i style="background:${hex}"></i><b>${esc(name)}</b><code>${hex}</code></div>`;

export function kitPage({ manifest, labels, colors: C, readme }, { standalone = true } = {}) {
  const { assets, badgeWords } = manifest;
  const recipes = tableRows(section(readme, 'Recipes')).filter((r) => r[0] !== 'Need');
  const rules = bullets(section(readme, 'Rules'));
  const families = FAMILIES.map(([key, title, lede]) => ({ key, title, lede, items: assets.filter((a) => a.family === key) }));
  const nav = families.map((f) => `<a href="#${f.key}">${f.title}</a>`).join('') + '<a href="#recipes">Recipes</a><a href="#palette">Palette</a><a href="#rules">Rules</a>';
  const style = `
:root { --bg: ${C.canvasL}; --panel: ${C.panelL}; --sunk: ${C.sunkL}; --line: ${C.divL}; --fg: ${C.ink}; --muted: #5a6474; --accent: ${C.blue}; --accent-ink: #ffffff; --g-light: ${C.panelL}; --g-paper: #f7f4ee; --g-dark: ${C.canvasD}; --g-blue: ${C.blue}; --show-light: block; --show-dark: none; --display: "Outfit", "Helvetica Neue", Arial, sans-serif; --body: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: ${C.canvasD}; --panel: ${C.panelD}; --sunk: ${C.sunkD}; --line: ${C.divD}; --fg: ${C.cream}; --muted: #98a1b1; --accent: ${C.sky}; --accent-ink: ${C.ink}; --show-light: none; --show-dark: block; color-scheme: dark } }
:root[data-theme="dark"] { --bg: ${C.canvasD}; --panel: ${C.panelD}; --sunk: ${C.sunkD}; --line: ${C.divD}; --fg: ${C.cream}; --muted: #98a1b1; --accent: ${C.sky}; --accent-ink: ${C.ink}; --show-light: none; --show-dark: block; color-scheme: dark }
* { box-sizing: border-box }
html { scroll-padding-top: 72px }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); padding-block: 0 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)) }
a { color: var(--accent) } a:focus-visible, .files a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
code { font-family: var(--mono); font-size: .92em }
.wrap { max-width: 1240px; margin: 0 auto }
.top { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; margin: 0 calc(-1 * max(16px, env(safe-area-inset-left, 0px))) 0 calc(-1 * max(16px, env(safe-area-inset-right, 0px))); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); background: color-mix(in srgb, var(--bg) 86%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line) }
.top .wrap { display: flex; align-items: center; gap: 24px; min-height: 60px; flex-wrap: wrap }
.top img { height: 26px; width: auto; display: block }
.top nav { display: flex; gap: 4px 18px; flex-wrap: wrap; margin-left: auto; font-size: 14px }
.top nav a { color: var(--fg); text-decoration: none; opacity: .78 } .top nav a:hover { opacity: 1; color: var(--accent) }
.hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 32px; align-items: center; padding-block: 56px 40px }
.eyebrow { font: 600 12px/1 var(--display); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin: 0 0 14px }
h1 { font: 600 clamp(38px, 6vw, 60px)/1.02 var(--display); letter-spacing: -.02em; margin: 0 0 16px; text-wrap: balance }
h2 { font: 600 28px/1.1 var(--display); letter-spacing: -.015em; margin: 0 0 6px; text-wrap: balance }
h3 { font: 600 17px/1.25 var(--display); margin: 0 }
.lede { max-width: 60ch; font-size: 17px; color: var(--muted); margin: 0 0 22px }
.stats { display: flex; flex-wrap: wrap; gap: 10px 28px; font-variant-numeric: tabular-nums }
.stats div { display: grid } .stats b { font: 600 26px/1.1 var(--display) } .stats span { font-size: 12.5px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase }
.hero-badge img { width: 220px; height: auto; display: block }
section { padding-block: 32px; border-top: 1px solid var(--line) }
.sec-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; margin-bottom: 20px }
.sec-head p { margin: 0; color: var(--muted); max-width: 70ch }
.sec-head .count { font: 500 13px/1 var(--mono); color: var(--muted); padding: 5px 9px; border: 1px solid var(--line); border-radius: 999px }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 20px }
.grid.wide { grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)) }
.asset { display: grid; gap: 12px; align-content: start; min-width: 0 }
.figure { display: flex; align-items: center; justify-content: center; aspect-ratio: 16 / 10; max-width: 100%; border-radius: 10px; border: 1px solid var(--line); padding: 10%; overflow: hidden }
.figure img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain }
.g-light { background: var(--g-light) } .g-paper { background: var(--g-paper) } .g-dark { background: var(--g-dark) } .g-blue { background: var(--g-blue) }
.g-none { padding: 0; background: var(--sunk) } .g-none img { width: 100%; height: 100% }
.asset-head { display: flex; align-items: center; gap: 10px; min-width: 0 }
.code { font: 600 12px/1 var(--mono); color: var(--accent-ink); background: var(--accent); padding: 5px 7px; border-radius: 6px; letter-spacing: .02em; flex: none }
.meta { margin: 0; display: grid; gap: 4px; font-size: 13.5px }
.meta div { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 10px } .meta dt { color: var(--muted); margin: 0 } .meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere }
.scale { font: 600 11px/1 var(--mono); color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 2px 4px; vertical-align: 1px }
.note { margin: 0; font-size: 13px; color: var(--muted) }
.files { display: flex; gap: 8px } .files a { font: 600 12.5px/1 var(--display); letter-spacing: .04em; text-decoration: none; color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 7px 11px; background: var(--panel) } .files a:hover { border-color: var(--accent); color: var(--accent) }
.table { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--panel) }
table { border-collapse: collapse; width: 100%; font-size: 14px; min-width: 640px }
th, td { text-align: left; padding: 10px 14px; border-top: 1px solid var(--line); vertical-align: top } th { border-top: 0; font: 600 12px/1 var(--display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted) }
.pairs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 16px; margin-bottom: 24px }
.pair { border-radius: 10px; padding: 18px; display: grid; gap: 10px; border: 1px solid var(--line) }
.pair p { margin: 0; font: 600 14px/1.3 var(--display) }
.pair svg { width: 96px; height: 32px; display: block }
.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 12px }
.swatch { display: grid; gap: 4px; font-size: 13px } .swatch i { display: block; height: 44px; border-radius: 8px; border: 1px solid var(--line) } .swatch b { font-weight: 600 } .swatch code { color: var(--muted) }
.rules { margin: 0; padding-left: 20px; max-width: 72ch } .rules li { margin-bottom: 8px }
pre { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; overflow-x: auto; font: 13px/1.5 var(--mono); margin: 0 }
footer { padding-block: 28px 0; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; color: var(--muted); font-size: 13px }
footer img { height: 40px; width: auto; display: block }
@media (max-width: 760px) { .hero { grid-template-columns: 1fr; padding-block: 36px 28px } .hero-badge { order: -1 } .hero-badge img { width: 150px } }
img.only-light, .only-light { display: var(--show-light) } img.only-dark, .only-dark { display: var(--show-dark) }
`;
  const mark = (a, b) => `<svg viewBox="8 14 32 20" aria-hidden="true"><path d="M12,20 C16,20 16,28 20,28 C24,28 24,20 28,20 C32,20 32,28 36,28" fill="none" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/><path d="M12,28 C16,28 16,20 20,20 C24,20 24,28 28,28 C32,28 32,20 36,20" fill="none" stroke="${b}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="6 9" stroke-dashoffset="2"/></svg>`;
  const body = `<header class="top"><div class="wrap">
<a href="#top" aria-label="weave"><img class="only-light" src="svg/lockup-light.svg" alt="weave" width="480" height="88"><img class="only-dark" src="svg/lockup-dark.svg" alt="weave" width="480" height="88"></a>
<nav>${nav}</nav>
</div></header>
<main class="wrap" id="top">
<div class="hero">
<div>
<p class="eyebrow">Marketing kit</p>
<h1>weave brand kit</h1>
<p class="lede">Every file is generated from the canonical mark, so the mark is never redrawn by hand. Take the SVG for web and print and the PNG for email and social uploads. Every PNG is at least 2× its stated size.</p>
<div class="stats"><div><b>${assets.length}</b><span>assets</span></div><div><b>${families.length}</b><span>families</span></div><div><b>2×</b><span>PNG floor</span></div><div><b>SVG</b><span>canonical</span></div></div>
</div>
<div class="hero-badge"><img class="only-light" src="png/badge-blue.png" alt="weave badge, blue" width="480" height="480"><img class="only-dark" src="png/badge-cream.png" alt="weave badge, cream" width="480" height="480"></div>
</div>
<section id="recipes">
<div class="sec-head"><h2>Pick by need</h2><p>The file to reach for first. Codes name the asset below.</p></div>
<div class="table"><table><thead><tr><th>Need</th><th>Use</th><th>Why</th></tr></thead><tbody>
${recipes.map((r) => `<tr><td>${inline(r[0])}</td><td>${inline(r[1])}</td><td>${inline(r[2])}</td></tr>`).join('\n')}
</tbody></table></div>
</section>
${families.map((f) => `<section id="${f.key}">
<div class="sec-head"><h2>${f.title}</h2><span class="count">${f.items.length}</span><p>${esc(f.lede)}</p></div>
<div class="grid${f.key === 'poster' || f.key === 'pattern' ? ' wide' : ''}">
${f.items.map(asset).join('\n')}
</div>
</section>`).join('\n')}
<section id="palette">
<div class="sec-head"><h2>Palette</h2><p>Strand pairs by ground, and the surfaces behind them. The badge ring reads <b>${esc(badgeWords.top)}</b> over <b>${esc(badgeWords.bottom)}</b>.</p></div>
<div class="pairs">
<div class="pair" style="background:${C.panelL};color:${C.ink}">${mark(C.blue, C.ink)}<p>Blue with ink on light</p><code>${C.blue} · ${C.ink}</code></div>
<div class="pair" style="background:${C.canvasD};color:${C.cream}">${mark(C.blue, C.sky)}<p>Blue with sky on dark</p><code>${C.blue} · ${C.sky}</code></div>
<div class="pair" style="background:${C.blue};color:${C.cream}">${mark(C.cream, C.ice)}<p>Cream with ice on brand blue</p><code>${C.cream} · ${C.ice}</code></div>
</div>
<div class="swatches">
${[[C.blue, 'Brand blue'], [C.sky, 'Sky'], [C.ink, 'Ink'], [C.cream, 'Cream'], [C.ice, 'Ice'], [C.canvasL, 'Canvas, light'], [C.panelL, 'Panel, light'], [C.sunkL, 'Sunk, light'], [C.divL, 'Divider, light'], [C.canvasD, 'Canvas, dark'], [C.panelD, 'Panel, dark'], [C.sunkD, 'Sunk, dark'], [C.divD, 'Divider, dark']].map(([h, n]) => swatch(h, n)).join('\n')}
</div>
</section>
<section id="rules">
<div class="sec-head"><h2>Rules</h2></div>
<ul class="rules">
${rules.map((r) => `<li>${inline(r).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}</li>`).join('\n')}
</ul>
</section>
<section id="rebuild">
<div class="sec-head"><h2>Rebuild</h2><p>SVGs, the manifest and this page come from one script; PNGs render through Chromium with Outfit loaded.</p></div>
<pre>${esc(manifest.regenerate)}
npm test -- --targeted test/brand-kit.test.mjs</pre>
</section>
<footer><img class="only-light" src="svg/badge-footer-light.svg" alt="${esc(labels.footer)}" width="156" height="40"><img class="only-dark" src="svg/badge-footer-dark.svg" alt="${esc(labels.footer)}" width="156" height="40"><span>Generated by build-kit.mjs from manifest.json. Every asset embeds the canonical mark file.</span></footer>
</main>`;
  const head = `<title>weave brand kit</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600&display=swap">
<style>${style}</style>`;
  if (!standalone) return `${head.replace('<title>weave brand kit</title>', '<title>weave brand kit</title>\n<meta name="claude:viewport-fit-sides" content="cover">')}\n${body}\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="svg/badge-small.svg">
${head}
</head>
<body>
${body}
</body>
</html>
`;
}
