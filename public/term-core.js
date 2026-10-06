(function (root) {
  const GROUPS = [
    ['General', ['record', 'item', 'entry', 'row', 'asset', 'document', 'note', 'idea', 'goal']],
    ['People', ['person', 'contact', 'member', 'user', 'employee', 'candidate', 'applicant', 'student', 'guest', 'volunteer']],
    ['Sales & CRM', ['customer', 'client', 'lead', 'prospect', 'deal', 'opportunity', 'account', 'partner', 'vendor']],
    ['Work', ['task', 'project', 'milestone', 'deliverable', 'request', 'shift']],
    ['Product & engineering', ['feature', 'issue', 'bug', 'ticket', 'release', 'run', 'experiment', 'test', 'session']],
    ['Finance & legal', ['invoice', 'contract', 'expense', 'payment', 'transaction', 'order', 'grant', 'subscription']],
    ['Content', ['article', 'post', 'story', 'book', 'video', 'page']],
    ['Events', ['event', 'meeting', 'interview', 'attendee', 'booking']],
    ['Inventory', ['product', 'listing', 'location', 'device']],
  ].map(([name, terms]) => ({ name, terms }));

  const IRREGULAR = { person: 'people' };
  const DEFAULT = Object.freeze({ singular: 'record', plural: 'records' });
  const MAX = 32;

  function pluralize(s) {
    const w = String(s).trim().toLowerCase();
    if (IRREGULAR[w]) return IRREGULAR[w];
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
    if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
    return w + 's';
  }

  function normalize(term) {
    if (!term || typeof term !== 'object') throw new Error('A term is { singular, plural } (e.g. { singular: "deal" })');
    const clean = (v, what) => {
      if (typeof v !== 'string') throw new Error(`The ${what} term must be a short word (e.g. "deal")`);
      const s = v.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!s || s.length > MAX || /[\n\r]/.test(s)) throw new Error(`The ${what} term must be 1–${MAX} characters`);
      return s;
    };
    const singular = clean(term.singular, 'singular');
    const plural = term.plural == null || !String(term.plural).trim() ? pluralize(singular) : clean(term.plural, 'plural');
    return { singular, plural };
  }

  function resolve(config) {
    const t = config && config.term;
    if (!t || !t.singular) return { ...DEFAULT, set: false };
    return { singular: t.singular, plural: t.plural || pluralize(t.singular), set: true };
  }

  function count(n, term) {
    const t = term && term.singular ? term : DEFAULT;
    return `${n} ${n === 1 ? t.singular : (t.plural || pluralize(t.singular))}`;
  }

  function cap(s) { s = String(s ?? ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function options() {
    return GROUPS.flatMap((g) => g.terms.map((t) => ({ id: t, label: cap(t), group: g.name })));
  }

  root.WeaveTerm = { GROUPS, DEFAULT, MAX, pluralize, normalize, resolve, count, cap, options };
})(globalThis);
