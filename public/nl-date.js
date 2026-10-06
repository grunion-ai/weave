(function (root) {
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function parseNaturalDate(input, now = new Date(), { dayFirst = false } = {}) {
    let t = String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t) return null;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    t = t.replace(/^(\d{4}-\d{1,2}-\d{1,2})[t ]\d{1,2}:\d{2}.*$/, '$1');
    const year = (y) => (y == null ? today.getFullYear() : String(y).length === 2 ? 2000 + Number(y) : Number(y));
    let m;
    if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return iso(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if ((m = t.match(/^(\d{1,2})([-/.])(\d{1,2})(?:\2(\d{2,4}))?$/))) {
      const a = Number(m[1]); const b = Number(m[3]);
      const dayFirstHere = m[2] === '.' ? true : (dayFirst ? true : a > 12);
      const [mo, d] = dayFirstHere && b <= 12 ? [b, a] : [a, b];
      return iso(new Date(year(m[4]), mo - 1, d));
    }
    if (t === 'today') return iso(today);
    if (t === 'tomorrow' || t === 'tmrw') return iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
    if (t === 'yesterday') return iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

    if ((m = t.match(/^in (\d+) (day|week|month|year)s?$/))) {
      const n = Number(m[1]);
      const d = new Date(today);
      if (m[2] === 'day') d.setDate(d.getDate() + n);
      if (m[2] === 'week') d.setDate(d.getDate() + n * 7);
      if (m[2] === 'month') d.setMonth(d.getMonth() + n);
      if (m[2] === 'year') d.setFullYear(d.getFullYear() + n);
      return iso(d);
    }

    if ((m = t.match(/^(next |last )?([a-z]+)$/)) && DAYS.some((d) => d.startsWith(m[2]))) {
      const target = DAYS.findIndex((d) => d.startsWith(m[2]));
      const d = new Date(today);
      let diff = (target - d.getDay() + 7) % 7;
      if (m[1] === 'last ') diff = diff === 0 ? -7 : diff - 7;
      else if (diff === 0 || m[1] === 'next ') diff = diff === 0 ? 7 : diff;
      d.setDate(d.getDate() + diff);
      return iso(d);
    }

    t = t.replace(/,/g, ' ').replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/\s+/g, ' ').trim();
    const monthIdx = (w) => MONTHS.findIndex((mo) => mo.startsWith(w.slice(0, 3)));
    if ((m = t.match(/^([a-z]{3,9}) (\d{4})$/)) && monthIdx(m[1]) >= 0) return iso(new Date(Number(m[2]), monthIdx(m[1]), 1));
    if ((m = t.match(/^(\d{4}) ([a-z]{3,9}) (\d{1,2})$/)) && monthIdx(m[2]) >= 0) return iso(new Date(Number(m[1]), monthIdx(m[2]), Number(m[3])));
    if ((m = t.match(/^([a-z]{3,}) (\d{1,2})(?:,? (\d{4}))?$/)) && monthIdx(m[1]) >= 0) {
      return iso(new Date(m[3] ? Number(m[3]) : today.getFullYear(), monthIdx(m[1]), Number(m[2])));
    }
    if ((m = t.match(/^(\d{1,2}) ([a-z]{3,})(?:,? (\d{4}))?$/)) && monthIdx(m[2]) >= 0) {
      return iso(new Date(m[3] ? Number(m[3]) : today.getFullYear(), monthIdx(m[2]), Number(m[1])));
    }

    const fallback = new Date(t);
    return Number.isNaN(fallback.getTime()) ? null : iso(fallback);
  }

  root.parseNaturalDate = parseNaturalDate;
})(typeof window !== 'undefined' ? window : globalThis);
