export const BUDGET_FILE = 'test/click-budget.json';

export const clickKey = (journey, cell) => `${journey}|${cell}`;

const clicks = (n) => `${n} click${n === 1 ? '' : 's'}`;

export function judge(key, n, budget) {
  if (!(key in budget)) return `${key} has no click budget: add "${key}": ${n} to ${BUDGET_FILE}`;
  const cap = budget[key];
  if (n > cap) return `${key} took ${clicks(n)}, budget ${cap}: an action that takes more clicks is refused. Remove the extra click, or raise clicks["${key}"] in ${BUDGET_FILE} and write why under raised["${key}"]`;
  if (n < cap) return `${key} took ${clicks(n)}, budget ${cap}: lower clicks["${key}"] in ${BUDGET_FILE} to ${n} in this change so the saving holds`;
  return null;
}

export function unexplainedRaises(before, after) {
  const was = before?.clicks ?? {};
  const why = after.raised ?? {};
  return Object.entries(after.clicks)
    .filter(([k, n]) => k in was && n > was[k])
    .filter(([k]) => !String(why[k] ?? '').trim() || why[k] === before?.raised?.[k])
    .map(([k, n]) => `${k} rose from ${was[k]} to ${n} clicks with no reason: write one under raised["${k}"]`);
}

export async function countClicks(page) {
  let n = 0;
  await page.exposeBinding('__wvClick', () => { n += 1; });
  await page.addInitScript(() => addEventListener('pointerdown', (e) => {
    if (e.isTrusted && e.isPrimary && e.button === 0) window.__wvClick();
  }, true));
  return { reset() { n = 0; }, get count() { return n; } };
}
