export const BUDGET_FILE = 'test/render-budget.json';

export const RUNS = 3;

export function judgeRenders(key, n, budget) {
  if (!Number.isFinite(n)) return `${key} read no render count: the flicker probe did not load`;
  const count = Math.ceil(n);
  if (!(key in budget)) return `${key} has no render budget: add "${key}": ${count} to ${BUDGET_FILE}`;
  if (count > budget[key]) return `${key} rendered in ${count} frames, budget ${budget[key]}: batch the DOM writes into fewer frames, or raise renders["${key}"] in ${BUDGET_FILE} and write why under raised["${key}"]`;
  return null;
}
