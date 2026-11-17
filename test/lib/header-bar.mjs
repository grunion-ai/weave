import { settled } from './browser.mjs';

const NAMES = ['table-search', 'table-view-btn', 'activity-btn', 'eye-btn', 'table-share-btn', 'dots-btn', 'pose-btn', 'dock-close'];

export const bar = (page, scope) => page.evaluate(([scope, names]) => {
  const half = (v) => Math.round(v * 2) / 2;
  const row = document.querySelector(`${scope} .view-header .crumb-row`);
  const header = row.closest('.view-header').getBoundingClientRect();
  const seen = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && n.getBoundingClientRect().width > 1.5;
  const tools = [...row.querySelectorAll(':scope > .crumb-actions > *, :scope > .dl-wrap')]
    .map((n) => (n.classList.contains('dl-wrap') ? n.querySelector('button') : n)).filter(seen);
  const items = tools.map((n) => {
    const r = n.getBoundingClientRect();
    const glyph = (n.classList.contains('table-search') ? n.querySelector('.table-search-btn') : n).querySelector('svg')?.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(14, r.width / 2), r.top + r.height / 2);
    return {
      name: names.find((c) => n.classList.contains(c)) ?? (/^Close/.test(n.getAttribute('aria-label') ?? '') ? 'close' : n.className),
      w: half(r.width), h: half(r.height), left: half(r.left), right: half(r.right), top: half(r.top),
      icon: glyph ? [half(glyph.width), half(glyph.height)] : null,
      inside: r.left >= header.left - 0.5 && r.right <= header.right + 0.5,
      reachable: !!hit && (hit === n || n.contains(hit)),
    };
  }).sort((a, b) => a.left - b.left);
  const rowBox = row.getBoundingClientRect();
  const copy = row.querySelector('.crumb-copy');
  const copyBox = seen(copy) ? copy.getBoundingClientRect() : null;
  const copyIcon = copyBox ? copy.querySelector('svg').getBoundingClientRect() : null;
  const title = document.querySelector(`${scope} :is(.view-title, .name-edit)`);
  return {
    tight: row.classList.contains('crumb-row-tight'),
    row: { h: half(rowBox.height), right: half(rowBox.right), padRight: parseFloat(getComputedStyle(row).paddingRight) },
    order: items.map((i) => i.name),
    items: Object.fromEntries(items.map((i) => [i.name, i])),
    gaps: items.slice(1).map((it, i) => half(it.left - items[i].right)),
    fromRight: Object.fromEntries(items.map((i) => [i.name, half(rowBox.right - i.right)])),
    copy: copyBox ? { w: half(copyBox.width), h: half(copyBox.height), icon: half(copyIcon.width), inside: copyBox.left >= header.left - 0.5 && copyBox.right <= header.right + 0.5 } : null,
    folded: !!row.querySelector('.crumb-more'),
    crumbsShown: [...row.querySelectorAll('.crumb-path > .crumb-slot')].filter(seen).length,
    titleTop: title ? half(title.getBoundingClientRect().top) : null,
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, [scope, NAMES]);

export const paintOf = async (locator) => {
  await settled(locator);
  return locator.evaluate(readPaint);
};
const readPaint = (n) => {
  const cs = getComputedStyle(n);
  const clear = (c) => c === 'transparent' || /,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  return {
    border: parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && !clear(cs.borderTopColor) ? cs.borderTopColor : 'none',
    fill: clear(cs.backgroundColor) ? 'none' : cs.backgroundColor,
    shadow: cs.boxShadow,
    color: cs.color,
  };
};
export const tokenPaint = (page, declarations) => page.evaluate((declarations) => {
  const probe = document.createElement('span');
  probe.style.cssText = declarations;
  document.querySelector('#main').append(probe);
  const cs = getComputedStyle(probe);
  const out = { fill: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
  probe.remove();
  return out;
}, declarations);

export const menuLabels = async (page, scope, { on = '.crumb-row .dots-btn', button = 'left' } = {}) => {
  await page.click(`${scope} .view-header ${on}`, { button });
  await page.waitForSelector('.chip-pop.wv-menu[role="menu"] [role^="menuitem"]');
  const labels = await page.locator('.chip-pop.wv-menu .wv-menu-label, .chip-pop.wv-menu .hold-label').allTextContents();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.chip-pop.wv-menu', { state: 'detached' });
  return labels.map((l) => l.trim());
};
