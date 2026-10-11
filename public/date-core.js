(function (root) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DYNAMIC_DATE_DEFAULTS = ['today()', 'now()'];
  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const pad = (n) => String(n).padStart(2, '0');

  const DG = () => root.weaveDateGrain;
  const formatDate = (iso, opts = {}) => DG().formatDate(iso, opts);
  const formatDateRange = (value, opts = {}) => DG().formatDateRange(value, opts);
  const legalFormats = (grain) => DG().legalFormats(grain);
  const toInstant = (localIso, zone) => DG().toInstant(localIso, zone);
  const fromInstant = (utcIso, zone) => DG().fromInstant(utcIso, zone);
  const partsOf = (value) => DG().partsOf(value);
  const storeOf = (grain, parts, time) => DG().storeOf(grain, parts, time);
  const coerce = (config, raw) => DG().coerce(config, raw);
  const grainOf = (config) => DG().grainOf(config);
  const parseClock = (text) => DG().parseClock(text);
  const DATE_FORMATS = ['iso', 'us', 'eu', 'long', 'short', 'month', 'quarter', 'ordinal', 'relative'];
  const CLOCKS = ['24h', '12h'];
  const ZONES = ['floating', 'fixed', 'instant'];
  const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function calendarMonth(y, m) {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = first.getUTCDay();
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

  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  function relativeOrShort(iso, now = new Date()) {
    const d = new Date(iso);
    if (iso == null || iso === '' || Number.isNaN(d.getTime())) return { text: '', title: '' };
    const title = d.toLocaleString([], { dateStyle: 'long', timeStyle: 'medium' });
    const sec = (now.getTime() - d.getTime()) / 1000;
    const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
    const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const short = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    let text;
    if (sec < 60 && sec > -60) text = 'just now';
    else if (sec > 0 && sec < 3600) text = `${Math.floor(sec / 60)} min ago`;
    else if (days === 0) text = `Today ${clock}`;
    else if (days === 1) text = 'Yesterday';
    else if (d.getFullYear() === now.getFullYear()) text = short;
    else text = `${short}, ${d.getFullYear()}`;
    return { text, title };
  }

  root.weaveDateCore = {
    MONTHS, MONTHS_LONG, WEEKDAYS, DYNAMIC_DATE_DEFAULTS,
    formatDate, formatDateRange, relativeOrShort, calendarMonth, shiftMonth, decade, splitIso, joinIso, todayIso, defaultKind,
    legalFormats, toInstant, fromInstant, partsOf, storeOf, coerce, grainOf, parseClock, DATE_FORMATS, CLOCKS, ZONES,
    get DEFAULT_FORMAT() { return DG().DEFAULT_FORMAT; }, get DEFAULT_CLOCK() { return DG().DEFAULT_CLOCK; },
  };
})(globalThis);
