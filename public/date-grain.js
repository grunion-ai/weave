(function (root) {
  const PARTS = ['year', 'month', 'day'];
  const DATE_FORMATS = ['iso', 'us', 'eu', 'long', 'short', 'month', 'quarter', 'ordinal', 'relative'];
  const CLOCKS = ['24h', '12h'];
  const DEFAULT_FORMAT = 'long';
  const DEFAULT_CLOCK = '12h';
  const ZONES = ['floating', 'fixed', 'instant'];
  const NEEDS = { month: ['month'], quarter: ['month'], ordinal: ['day'], relative: ['year'] };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const ordinal = (d) => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');
  const daysIn = (y, m) => new Date(Date.UTC(y ?? 2000, m, 0)).getUTCDate();

  const GRAIN_SHAPE = 'grain is a list of parts, e.g. ["year","month"] for a month or ["year"] for a year; parts are year, month, day';
  function normalizeGrain(grain) {
    if (grain == null) return null;
    if (typeof grain !== 'object') throw new Error(GRAIN_SHAPE);
    const list = Array.isArray(grain) ? grain.map(String) : PARTS.filter((p) => grain[p]);
    for (const p of list) if (!PARTS.includes(p)) throw new Error(`Unknown grain part '${p}' (year, month, day)`);
    const canon = PARTS.filter((p) => list.includes(p));
    if (canon.length === 3) return null;
    if (canon.includes('year') && canon.includes('day') && !canon.includes('month')) {
      throw new Error('A grain of year and day needs the month between them (year, year·month, year·month·day, month·day, month, day)');
    }
    return canon;
  }
  const grainOf = (config) => (config && config.grain != null ? normalizeGrain(config.grain) ?? PARTS : PARTS);
  const has = (grain, part) => grain.includes(part);

  function legalFormats(grain) {
    const g = grain == null ? PARTS : Array.isArray(grain) ? grain : PARTS.filter((p) => grain[p]);
    if (!g.length) return [];
    return DATE_FORMATS.filter((f) => (NEEDS[f] ?? []).every((p) => g.includes(p)));
  }
  function formatProblem(grain, format) {
    if (format == null || format === 'iso') return grain.length ? null : (format === 'iso' ? null : null);
    if (!DATE_FORMATS.includes(format)) return `Invalid date format '${format}' (${DATE_FORMATS.join(', ')})`;
    if (!grain.length) return `A time-of-day field has no date parts for a '${format}' format to dress`;
    const missing = (NEEDS[format] ?? []).filter((p) => !grain.includes(p));
    if (missing.length) return `'${format}' needs a ${missing.join(' and a ')} the grain does not store`;
    return null;
  }

  function partsOf(value) {
    const s = String(value ?? '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/))) {
      return { y: +m[1], m: +m[2], d: +m[3], t: m[4] != null ? `${pad2(+m[4])}:${m[5]}` : null, z: m[6] ?? null };
    }
    if ((m = s.match(/^(\d{4})-(\d{2})$/))) return { y: +m[1], m: +m[2], d: null, t: null, z: null };
    if ((m = s.match(/^(\d{4})$/))) return { y: +m[1], m: null, d: null, t: null, z: null };
    if ((m = s.match(/^--(\d{2})-(\d{2})$/))) return { y: null, m: +m[1], d: +m[2], t: null, z: null };
    if ((m = s.match(/^--(\d{2})$/))) return { y: null, m: +m[1], d: null, t: null, z: null };
    if ((m = s.match(/^---(\d{2})$/))) return { y: null, m: null, d: +m[1], t: null, z: null };
    if ((m = s.match(/^T?(\d{1,2}):(\d{2})(?::\d{2})?$/))) return { y: null, m: null, d: null, t: `${pad2(+m[1])}:${m[2]}`, z: null };
    return null;
  }
  function storeOf(grain, parts, time) {
    const { y, m, d, t } = parts;
    const date = has(grain, 'year') && has(grain, 'month') && has(grain, 'day') ? `${y}-${pad2(m)}-${pad2(d)}`
      : has(grain, 'year') && has(grain, 'month') ? `${y}-${pad2(m)}`
      : has(grain, 'year') ? String(y)
      : has(grain, 'month') && has(grain, 'day') ? `--${pad2(m)}-${pad2(d)}`
      : has(grain, 'month') ? `--${pad2(m)}`
      : has(grain, 'day') ? `---${pad2(d)}`
      : '';
    if (!time || !t) return date;
    return date ? `${date}T${t}` : t;
  }
  function coerce(config, raw) {
    const grain = grainOf(config);
    const time = !!config.time;
    let parts = partsOf(raw);
    if (!parts && grain.length === 1 && /^\d{1,4}$/.test(String(raw).trim())) {
      const n = Number(raw);
      parts = grain[0] === 'year' ? { y: n, m: null, d: null, t: null } : grain[0] === 'month' ? { y: null, m: n, d: null, t: null } : { y: null, m: null, d: n, t: null };
    }
    if (!parts) throw new Error(`'${raw}' is not a valid date for this field`);
    for (const p of grain) {
      if (parts[p[0]] == null) throw new Error(`'${raw}' has no ${p}, and this field stores one`);
    }
    if (time && !parts.t) throw new Error(`'${raw}' carries no time of day, and this field stores one`);
    if (has(grain, 'month') && (parts.m < 1 || parts.m > 12)) throw new Error(`'${raw}' names month ${parts.m}; a month is 1 to 12`);
    if (has(grain, 'day') && (parts.d < 1 || parts.d > (has(grain, 'month') ? daysIn(has(grain, 'year') ? parts.y : null, parts.m) : 31))) {
      throw new Error(`'${raw}' names day ${parts.d}, which that month does not have`);
    }
    if (time) {
      const [h, mi] = parts.t.split(':').map(Number);
      if (h > 23 || mi > 59) throw new Error(`'${raw}' is not a time of day`);
    }
    return storeOf(grain, parts, time);
  }

  const ZONE_CAP = 128;
  const CANON = new Map();
  const WALL = new Map();
  const ABBR = new Map();
  const bounded = (cache, key, make) => {
    let v = cache.get(key);
    if (v === undefined) {
      v = make();
      if (cache.size >= ZONE_CAP) cache.clear();
      cache.set(key, v);
    }
    return v;
  };
  const canonZone = (zone) => bounded(CANON, zone, () => new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone);
  const kept = (cache, zone, make) => {
    const z = canonZone(zone);
    return bounded(cache, z, () => make(z));
  };
  function wallIn(date, zone) {
    const f = kept(WALL, zone, (z) => new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, t: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, z: null };
  }
  const zoneAbbr = (date, zone) => kept(ABBR, zone, (z) => new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'short' }))
    .formatToParts(date).find((x) => x.type === 'timeZoneName')?.value ?? zone;
  function isZone(zone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
  }
  const asUtcMs = ({ y, m, d, t }) => { const [h, mi] = (t ?? '00:00').split(':').map(Number); return Date.UTC(y, m - 1, d, h, mi); };
  function toInstant(localIso, zone) {
    const parts = partsOf(localIso);
    if (!parts || parts.y == null) return null;
    const guess = asUtcMs(parts);
    let utc = guess - (asUtcMs(wallIn(new Date(guess), zone)) - guess);
    utc = guess - (asUtcMs(wallIn(new Date(utc), zone)) - utc);
    const w = wallIn(new Date(utc), 'UTC');
    return `${w.y}-${pad2(w.m)}-${pad2(w.d)}T${w.t}Z`;
  }
  function fromInstant(utcIso, zone) {
    const ms = Date.parse(utcIso);
    if (Number.isNaN(ms)) return null;
    const w = wallIn(new Date(ms), zone);
    return `${w.y}-${pad2(w.m)}-${pad2(w.d)}T${w.t}`;
  }
  function coerceInstant(raw) {
    const s = String(raw ?? '').trim();
    const parts = partsOf(s);
    if (!parts || parts.y == null || !parts.t) return null;
    const ms = Date.parse(parts.z ? s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : s + 'Z');
    if (Number.isNaN(ms)) return null;
    const w = wallIn(new Date(ms), 'UTC');
    return `${w.y}-${pad2(w.m)}-${pad2(w.d)}T${w.t}Z`;
  }

  function dateText(parts, grain, style, padOn, now) {
    const hy = has(grain, 'year') && parts.y != null;
    const hm = has(grain, 'month') && parts.m != null;
    const hd = has(grain, 'day') && parts.d != null;
    if (!hy && !hm && !hd) return '';
    const { y: Y, m: M, d: D } = parts;
    const num = (n) => (padOn ? pad2(n) : String(n));
    switch (style) {
      case 'us':
        if (hm && hd && hy) return `${num(M)}/${num(D)}/${Y}`;
        if (hm && hy) return `${num(M)}/${Y}`;
        if (hm && hd) return `${num(M)}/${num(D)}`;
        return hy ? String(Y) : hm ? num(M) : num(D);
      case 'eu':
        if (hd && hm && hy) return `${num(D)}.${num(M)}.${Y}`;
        if (hm && hy) return `${num(M)}.${Y}`;
        if (hd && hm) return `${num(D)}.${num(M)}.`;
        return hy ? String(Y) : hm ? `${num(M)}.` : `${num(D)}.`;
      case 'long':
      case 'short': {
        const dropYear = style === 'short' && hy && Y === now.getFullYear();
        const yTail = hy && !dropYear ? `, ${Y}` : '';
        if (hm && hd) return `${MON[M - 1]} ${D}${yTail}`;
        if (hm) return hy && !dropYear ? `${MON[M - 1]} ${Y}` : MON[M - 1];
        if (hd) return `the ${ordinal(D)}${yTail}`;
        return String(Y);
      }
      case 'month': return hy ? `${MON_LONG[M - 1]} ${Y}` : MON_LONG[M - 1];
      case 'quarter': return `Q${Math.ceil(M / 3)}${hy ? ' ' + Y : ''}`;
      case 'ordinal':
        if (hm && hd) return `${MON_LONG[M - 1]} ${ordinal(D)}${hy ? ', ' + Y : ''}`;
        return `the ${ordinal(D)}`;
      case 'relative': return relativeText(parts, hd, hm, now);
      default:
        return [hy ? String(Y) : null, hm ? pad2(M) : null, hd ? pad2(D) : null].filter(Boolean).join('-');
    }
  }
  function relativeText(parts, hd, hm, now) {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    if (hd && hm) {
      const days = Math.round((Date.UTC(parts.y, parts.m - 1, parts.d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
      if (Math.abs(days) < 7) return rtf.format(days, 'day');
      if (Math.abs(days) < 31) return rtf.format(Math.round(days / 7), 'week');
      if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30.4), 'month');
      return rtf.format(Math.round(days / 365), 'year');
    }
    if (hm) {
      const months = (parts.y * 12 + parts.m) - (now.getFullYear() * 12 + now.getMonth() + 1);
      return Math.abs(months) < 12 ? rtf.format(months, 'month') : rtf.format(Math.round(months / 12), 'year');
    }
    return rtf.format(parts.y - now.getFullYear(), 'year');
  }
  function parseClock(text) {
    const s = String(text ?? '').toLowerCase();
    let m = s.match(/(?:^|[^\d:])(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?![\d:])/) || s.match(/(?:^|[^\d:])(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.)(?![\d:])/);
    if (!m) return null;
    let h = Number(m[1]);
    const mi = Number(m[2] || 0);
    const ap = (m[3] || '').replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return `${pad2(h)}:${pad2(mi)}`;
  }
  function clockText(hhmm, clock) {
    const [h, mi] = hhmm.split(':').map(Number);
    if (clock !== '12h') return `${pad2(h)}:${pad2(mi)}`;
    return `${h % 12 === 0 ? 12 : h % 12}:${pad2(mi)} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  function elapsedText(start, end) {
    const a = partsOf(start), b = partsOf(end);
    if (!a || !b || !a.t || !b.t) return '';
    let mins;
    if (a.y != null && b.y != null) mins = Math.round((asUtcMs(b) - asUtcMs(a)) / 60000);
    else {
      const [h1, m1] = a.t.split(':').map(Number), [h2, m2] = b.t.split(':').map(Number);
      mins = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (mins < 0) mins += 1440;
    }
    if (mins < 0) return '';
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    const bits = [];
    if (d) bits.push(`${d}d`);
    if (h) bits.push(`${h}h`);
    if (m || !bits.length) bits.push(`${m}m`);
    return bits.join(' ');
  }

  function formatDate(value, c = {}) {
    if (value == null || value === '') return '';
    const now = c.now ?? new Date();
    const grain = grainOf(c);
    const time = !!c.time;
    let parts = partsOf(value);
    if (!parts) return String(value);
    let tag = '';
    if (time && parts.t && c.zone === 'instant') {
      const zone = c.viewerZone ?? 'UTC';
      const ms = Date.parse(parts.z ? String(value) : String(value) + 'Z');
      if (!Number.isNaN(ms)) { parts = wallIn(new Date(ms), zone); tag = ' ' + zoneAbbr(new Date(ms), zone); }
    } else if (time && parts.t && c.zone === 'fixed' && c.zoneName) {
      tag = ' ' + zoneAbbr(new Date(parts.y != null ? asUtcMs(parts) : now.getTime()), c.zoneName);
    }
    const date = dateText(parts, grain, c.format ?? DEFAULT_FORMAT, !!c.pad, now);
    const clock = time && parts.t ? clockText(parts.t, c.clock ?? DEFAULT_CLOCK) : '';
    return (date && clock ? `${date} ${clock}` : date || clock) + (clock ? tag : '');
  }
  function formatDateRange(value, c = {}) {
    if (!value) return '';
    const { start, end } = value;
    if (!start && !end) return '';
    let text;
    if ((c.format ?? DEFAULT_FORMAT) === 'long' && !c.time && start && end && String(start).slice(0, 4) === String(end).slice(0, 4) && grainOf(c).length === 3) {
      text = `${formatDate(start, c).replace(`, ${String(start).slice(0, 4)}`, '')} – ${formatDate(end, c)}`;
    } else {
      text = `${start ? formatDate(start, c) : ''} – ${end ? formatDate(end, c) : ''}`.trim();
    }
    if (c.elapsed && c.time && start && end) {
      const span = elapsedText(start, end);
      if (span) text += ` · ${span}`;
    }
    return text;
  }
  function rangeKey(value) {
    if (!value) return null;
    const { start, end } = value;
    if (start == null && end == null) return null;
    return `${start ?? ''}/${end ?? '\uffff'}`;
  }

  root.weaveDateGrain = {
    PARTS, DATE_FORMATS, CLOCKS, DEFAULT_FORMAT, DEFAULT_CLOCK, ZONES, NEEDS, MON, MON_LONG,
    normalizeGrain, grainOf, legalFormats, formatProblem,
    partsOf, storeOf, coerce, coerceInstant, isZone, toInstant, fromInstant, wallIn, zoneAbbr,
    formatDate, formatDateRange, clockText, parseClock, elapsedText, ordinal, rangeKey,
    ZONE_CAP, zoneCaches: () => ({ canon: CANON.size, wall: WALL.size, abbr: ABBR.size }),
  };
})(globalThis);
