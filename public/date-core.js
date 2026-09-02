/* The pure half of dates in the UI (2026-08-23): the display costume
   (mirrors the engine's, contract-tested), a month grid for the calendar
   popover, month/decade stepping, and the default-kind helpers for the
   field tray. Classic script + ESM in one file (nl-date.js pattern). */
(function (root) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DYNAMIC_DATE_DEFAULTS = ['today()', 'now()'];
  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const pad = (n) => String(n).padStart(2, '0');

  /* The costume moved to date-grain.js (2026-09-02) so the engine and the
     browser read ONE rule; these two keep their names for every caller.
     Same rule as ever: format the stored wall-clock parts, never the local
     zone's reading of them — and now, only the parts the grain stored. */
  const DG = () => root.weaveDateGrain;
  const formatDate = (iso, opts = {}) => DG().formatDate(iso, opts);
  const formatDateRange = (value, opts = {}) => DG().formatDateRange(value, opts);
  const legalFormats = (grain) => DG().legalFormats(grain);
  const toInstant = (localIso, zone) => DG().toInstant(localIso, zone);
  const fromInstant = (utcIso, zone) => DG().fromInstant(utcIso, zone);
  const partsOf = (value) => DG().partsOf(value);
  const storeOf = (grain, parts, time) => DG().storeOf(grain, parts, time);
  const coerce = (config, raw) => DG().coerce(config, raw);
  const DATE_FORMATS = ['iso', 'us', 'eu', 'long', 'short', 'month', 'quarter', 'ordinal', 'relative'];
  const CLOCKS = ['24h', '12h'];
  const ZONES = ['floating', 'fixed', 'instant'];
  const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  /* Sunday-first weeks (the native picker's layout) covering the month;
     leading/trailing days from the neighbours are flagged inMonth:false. */
  function calendarMonth(y, m) {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = first.getUTCDay();                    // Sun=0 … Sat=6
    const total = daysIn(y, m);
    const cells = [];
    const [py, pm] = shiftMonth(y, m, -1);
    const [ny, nm] = shiftMonth(y, m, 1);
    const pdays = daysIn(py, pm);
    for (let i = lead - 1; i >= 0; i--) cells.push({ iso: isoOf(py, pm, pdays - i), day: pdays - i, inMonth: false });
    for (let d = 1; d <= total; d++) cells.push({ iso: isoOf(y, m, d), day: d, inMonth: true });
    let nd = 1;
    while (cells.length % 7) cells.push({ iso: isoOf(ny, nm, nd), day: nd++, inMonth: false });
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  function shiftMonth(y, m, by) {
    const idx = (y * 12 + (m - 1)) + by;
    return [Math.floor(idx / 12), (idx % 12 + 12) % 12 + 1];
  }

  /* A 12-year window that starts on the decade, so 2026 sits in 2020…2031. */
  function decade(y) {
    const start = Math.floor(y / 10) * 10;
    return Array.from({ length: 12 }, (_, i) => start + i);
  }

  function splitIso(iso) {
    const [date, time = ''] = String(iso ?? '').split('T');
    return { date, time: time.slice(0, 5) };
  }
  const joinIso = (date, time) => (time ? `${date}T${time}` : date);

  function todayIso() {
    const d = new Date();
    return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  const defaultKind = (d) => (!d ? 'none' : DYNAMIC_DATE_DEFAULTS.includes(d) ? 'today' : 'specific');

  root.weaveDateCore = {
    MONTHS, MONTHS_LONG, WEEKDAYS, DYNAMIC_DATE_DEFAULTS,
    formatDate, formatDateRange, calendarMonth, shiftMonth, decade, splitIso, joinIso, todayIso, defaultKind,
    legalFormats, toInstant, fromInstant, partsOf, storeOf, coerce, DATE_FORMATS, CLOCKS, ZONES,
  };
})(globalThis);
