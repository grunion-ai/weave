export const NUMERIC_AGGREGATES = ['sum', 'avg', 'min', 'max', 'median', 'stdev', 'range'];
export const COUNTING_AGGREGATES = ['count', 'filled', 'empty', 'distinct'];

const isBlank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const numbers = (vals) => vals.map((v) => (typeof v === 'number' ? v : Number(v))).filter((n, i) => Number.isFinite(n) && !isBlank(vals[i]) && typeof vals[i] !== 'boolean');
const flat = (vals) => vals.flatMap((v) => (Array.isArray(v) ? v : [v]));

function sorted(nums) { return [...nums].sort((a, b) => a - b); }

function quantile(sortedNums, q) {
  const n = sortedNums.length;
  if (!n) return null;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedNums[lo];
  return sortedNums[lo] + (sortedNums[hi] - sortedNums[lo]) * (pos - lo);
}

function stdev(nums) {
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const ss = nums.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(ss / (nums.length - 1));
}

function extreme(vals, pick) {
  const nums = numbers(vals);
  if (nums.length) return pick === 'min' ? Math.min(...nums) : Math.max(...nums);
  const strs = flat(vals).filter((v) => !isBlank(v)).map(String);
  if (!strs.length) return null;
  return strs.reduce((a, b) => ((pick === 'min' ? b < a : b > a) ? b : a));
}

export function aggregate(name, vals, { display = null, separator = ', ' } = {}) {
  switch (name) {
    case 'count': return vals.length;
    case 'filled': return vals.filter((v) => !isBlank(v)).length;
    case 'empty': return vals.filter((v) => isBlank(v)).length;
    case 'distinct': return new Set(flat(display ?? vals).filter((v) => !isBlank(v)).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)))).size;
    case 'sum': return numbers(vals).reduce((a, b) => a + b, 0);
    case 'avg': { const n = numbers(vals); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; }
    case 'median': return quantile(sorted(numbers(vals)), 0.5);
    case 'stdev': return stdev(numbers(vals));
    case 'min': return extreme(vals, 'min');
    case 'max': return extreme(vals, 'max');
    case 'range': { const n = numbers(vals); return n.length ? Math.max(...n) - Math.min(...n) : null; }
    case 'join': return flat(display ?? vals).filter((v) => !isBlank(v)).join(separator);
    default: throw new Error(`Unknown aggregate '${name}'`);
  }
}

export function describeNumbers(vals) {
  const nums = sorted(numbers(vals));
  if (!nums.length) return { n: 0, sum: 0, avg: null, median: null, min: null, max: null, p25: null, p75: null, range: null, stdev: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    n: nums.length,
    sum,
    avg: sum / nums.length,
    median: quantile(nums, 0.5),
    min: nums[0],
    max: nums[nums.length - 1],
    p25: quantile(nums, 0.25),
    p75: quantile(nums, 0.75),
    range: nums[nums.length - 1] - nums[0],
    stdev: stdev(nums),
  };
}

export function histogram(vals, bins = 10) {
  const nums = numbers(vals);
  if (!nums.length) return [];
  const min = Math.min(...nums), max = Math.max(...nums);
  if (min === max) return [{ from: min, to: max, count: nums.length }];
  const width = (max - min) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: min + i * width, to: i === bins - 1 ? max : min + (i + 1) * width, count: 0 }));
  for (const n of nums) out[Math.min(bins - 1, Math.floor((n - min) / width))].count++;
  return out;
}

export function distribution(vals) {
  const counts = new Map();
  for (const v of vals) {
    const items = isBlank(v) ? [null] : (Array.isArray(v) ? v : [v]);
    for (const it of items) {
      const key = isBlank(it) ? null : it;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value == null) - (b.value == null) || String(a.value).localeCompare(String(b.value)));
}
