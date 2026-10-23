const FIELDS = [['minute', 0, 59], ['hour', 0, 23], ['day', 1, 31], ['month', 1, 12], ['weekday', 0, 7]];
const MINUTE = 60_000;
export const CATCH_UP_MS = 7 * 24 * 60 * MINUTE;

function parseField(name, src, lo, hi) {
  if (src === '*') return null;
  const out = new Set();
  for (const item of src.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(item);
    if (!m) throw new Error(`The ${name} field '${item}' is not a cron term: use *, a number, a-b, or a step like */5`);
    const step = m[3] ? Number(m[3]) : 1;
    const from = m[1] === '*' ? lo : Number(m[1]);
    const to = m[2] ? Number(m[2]) : m[1] === '*' ? hi : from;
    if (step < 1 || from < lo || to > hi || from > to) throw new Error(`The ${name} field '${item}' is out of range ${lo}-${hi}`);
    for (let v = from; v <= to; v += step) out.add(name === 'weekday' && v === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(expr) {
  const parts = String(expr ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) throw new Error(`A cron schedule has five fields (minute hour day month weekday), not ${parts.length}`);
  const cron = { text: parts.join(' ') };
  FIELDS.forEach(([name, lo, hi], i) => { cron[name] = parseField(name, parts[i], lo, hi); });
  return cron;
}

export function cronMatches(cron, at) {
  const fits = (name) => cron[name] === null || cron[name].has(at[name]);
  if (!fits('minute') || !fits('hour') || !fits('month')) return false;
  if (cron.day !== null && cron.weekday !== null) return fits('day') || fits('weekday');
  return fits('day') && fits('weekday');
}

const formatters = new Map();
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date, zone) {
  let fmt = formatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short' });
    formatters.set(zone, fmt);
  }
  const at = {};
  for (const { type, value } of fmt.formatToParts(date)) {
    if (type === 'weekday') at.weekday = WEEKDAYS[value];
    else if (type === 'minute' || type === 'hour' || type === 'day' || type === 'month') at[type] = Number(value);
  }
  return at;
}

export function dueBetween(cron, zone, since, until) {
  const from = Math.max(since.getTime(), until.getTime() - CATCH_UP_MS);
  const last = Math.floor(until.getTime() / MINUTE) * MINUTE;
  for (let t = last; t > from; t -= MINUTE) {
    const d = new Date(t);
    if (cronMatches(cron, zonedParts(d, zone))) return d;
  }
  return null;
}

export function armSchedules(tick, { every = MINUTE, setTimer = setInterval, clearTimer = clearInterval, log = console.error } = {}) {
  const timer = setTimer(() => {
    try { tick(); } catch (err) { log(`weave: schedule tick failed: ${err?.message ?? err}`); }
  }, every);
  timer?.unref?.();
  return { stop() { clearTimer(timer); } };
}
