/* Pure logic for the unified field dialog (design review 2026-08-22, A+E):
   the dialog's state object, the canonical {type, config} definition the
   code pane shows, and a client-side mirror of the engine's config
   validation so the pane can flag errors before the request is made. The
   server's normaliser stays the truth — this mirror only repeats its
   messages verbatim (test/field-dialog-core.test.mjs pins them to source).
   Classic script + ESM in one file, same pattern as nl-date.js: the browser
   reads the window global, node imports the same source. */
(function (root) {
  // Grid types mirror engine DEFINABLE_TYPES; lookup/rollup are the computed
  // extras with their own config pickers. formula is deliberately NOT a grid
  // tile — any field can be a formula, so it is a toggle in the dialog.
  const FIELD_TYPES = [
    { id: 'text', label: 'text', icon: 'Aa' },
    { id: 'number', label: 'number', icon: '#' },
    { id: 'date', label: 'date', icon: 'lucide:calendar' },
    { id: 'daterange', label: 'range', icon: 'lucide:calendar-range' },
    { id: 'checkbox', label: 'checkbox', icon: 'lucide:square-check' },
    { id: 'toggle', label: 'toggle', icon: '⏻' },
    { id: 'url', label: 'url', icon: 'lucide:link' },
    { id: 'email', label: 'email', icon: '@' },
    { id: 'select', label: 'select', icon: 'lucide:chevron-down' },
    { id: 'multiselect', label: 'multi', icon: 'lucide:list' },
    { id: 'workflow', label: 'workflow', icon: 'lucide:refresh-cw' },
    { id: 'document', label: 'document', icon: 'lucide:file-text' },
    { id: 'field', label: 'field', icon: 'lucide:sliders-horizontal' },
    { id: 'key', label: 'key', icon: '✱' },
    { id: 'attachments', label: 'files', icon: 'lucide:folder' },
    { id: 'relation', label: 'relation', icon: 'lucide:arrow-left-right', relation: true },
    { id: 'lookup', label: 'lookup', icon: 'lucide:arrow-up-right', computed: true },
    { id: 'rollup', label: 'rollup', icon: 'Σ', computed: true },
    // The chip and the card: minted on every table, never created here —
    // the dialog only configures the pair (Kyle, 2026-09-04).
    { id: 'view', label: 'view', icon: 'lucide:layout-grid', computed: true, minted: true },
  ];

  /* The function catalog the formula builder draws its chips from — and the
     card a chip shows on hover, focus or tap (design review 2026-09-01,
     direction A). The name list is contract-tested against FUNCS in
     src/formula.js; every entry carries its grammar group, a one-sentence
     doc and an example that parses (test/field-dialog-core.test.mjs). The
     vocabulary serves the same list verbatim, so an agent reads the card a
     person hovers. */
  const FORMULA_GROUPS = ['logic', 'text', 'number', 'date'];
  const FORMULA_FUNCTIONS = [
    { name: 'if', group: 'logic', sig: 'if(cond, then, else)', doc: 'Pick then when cond is truthy, else otherwise. Empty, 0, false and "" are falsy.', example: 'if([Amount] > 10000, "major", "minor")' },
    { name: 'empty', group: 'logic', sig: 'empty(x)', doc: 'True when x is null, an empty string or an empty list.', example: 'empty([Close Date])' },
    { name: 'contains', group: 'logic', sig: 'contains(hay, needle)', doc: 'True when the text holds needle (case-insensitive), or the list holds the item.', example: 'contains([Tags], "urgent")' },
    { name: 'concat', group: 'text', sig: 'concat(a, b, …)', doc: 'Join every argument into one string; nulls read as empty.', example: 'concat([Name], " — ", [Stage])' },
    { name: 'upper', group: 'text', sig: 'upper(text)', doc: 'The text in upper case.', example: 'upper([Stage])' },
    { name: 'lower', group: 'text', sig: 'lower(text)', doc: 'The text in lower case.', example: 'lower([Name])' },
    { name: 'trim', group: 'text', sig: 'trim(text)', doc: 'The text without leading or trailing whitespace.', example: 'trim([Name])' },
    { name: 'len', group: 'text', sig: 'len(x)', doc: 'How many characters the text has, or how many items the list has.', example: 'len([Name])' },
    { name: 'text', group: 'text', sig: 'text(x)', doc: 'Any value as a string; null becomes "".', example: 'text([Amount])' },
    { name: 'round', group: 'number', sig: 'round(x, places)', doc: 'Round x to places decimals (0 when omitted).', example: 'round([Amount] / 3, 2)' },
    { name: 'abs', group: 'number', sig: 'abs(x)', doc: 'The distance of x from zero.', example: 'abs([Amount] - 5000)' },
    { name: 'min', group: 'number', sig: 'min(a, b, …)', doc: 'The smallest of the numbers given.', example: 'min([Amount], 1000)' },
    { name: 'max', group: 'number', sig: 'max(a, b, …)', doc: 'The largest of the numbers given.', example: 'max([Amount], 0)' },
    { name: 'number', group: 'number', sig: 'number(x)', doc: 'Any value as a number; text that is not numeric becomes NaN.', example: 'number([Stage])' },
    { name: 'today', group: 'date', sig: 'today()', doc: "Today's date as YYYY-MM-DD, read from the engine clock.", example: 'today()' },
    { name: 'now', group: 'date', sig: 'now()', doc: 'The current instant as an ISO timestamp.', example: 'now()' },
    { name: 'days', group: 'date', sig: 'days(from, to)', doc: 'Whole days from one date to the other; negative when to is earlier.', example: 'days([Start], [End])' },
    { name: 'dateadd', group: 'date', sig: 'dateadd(date, n, unit)', doc: 'Shift a date by n days, weeks, months or years. A date in, a date out.', example: 'dateadd([Close Date], 2, "weeks")' },
    { name: 'datediff', group: 'date', sig: 'datediff(a, b, unit)', doc: 'Whole units from a to b: days, weeks, hours or minutes.', example: 'datediff([Close Date], today(), "days")' },
    { name: 'year', group: 'date', sig: 'year(date)', doc: 'The year of a date, or of a partial date that holds one.', example: 'year([Close Date])' },
    { name: 'month', group: 'date', sig: 'month(date)', doc: 'The month of a date, 1 to 12.', example: 'month([Close Date])' },
    { name: 'day', group: 'date', sig: 'day(date)', doc: 'The day of the month, 1 to 31.', example: 'day([Close Date])' },
  ];
  // The chips in grammar order: one row per group, if leading logic.
  function formulaFunctionGroups() {
    return FORMULA_GROUPS.map((group) => ({ group, fns: FORMULA_FUNCTIONS.filter((f) => f.group === group) }));
  }

  /* The field chips: every field but the one being edited (a formula that
     reads itself never converges, and the engine refuses it). A field a
     formula cannot read stays listed with the reason, greyed — a silent
     absence reads as a bug. */
  const FORMULA_UNREADABLE = {
    document: "document fields don't compute — a formula reads values, not prose",
    attachments: "attachment fields don't compute — a formula reads values, not files",
  };
  function formulaFieldChoices(fields, selfName = null) {
    return fields
      .filter((f) => f.name !== selfName)
      .map((f) => ({ name: f.name, type: f.type, token: formulaFieldToken(f.name), excluded: FORMULA_UNREADABLE[f.type] ?? null }));
  }

  // Mirror of the engine's TYPE_MIGRATIONS (contract-tested): what an
  // existing field may become. The tray shows the field's own type plus
  // these — never a move the engine would refuse.
  const TYPE_MIGRATIONS = {
    text: ['number', 'key', 'url', 'email', 'select', 'multiselect', 'date', 'formula'],
    formula: ['text'],
    number: ['text'],
    url: ['text'],
    email: ['text'],
    key: ['text'],
    date: ['text'],
    checkbox: ['toggle', 'text'],
    toggle: ['checkbox', 'text'],
    select: ['multiselect', 'workflow', 'text'],
    multiselect: ['select', 'text'],
    workflow: ['select'],
  };
  /* The one word for a type, for anywhere a field has to say what it is —
     the field menu's title line names the field and then this. FIELD_TYPES
     already carries the label the type grid prints, so there is no second
     list to drift; a computed type that has no tile ('formula') falls back
     to its own id, which is already the word. */
  function typeLabel(type) {
    if (!type) return '';
    return (FIELD_TYPES.find((t) => t.id === type) ?? {}).label ?? String(type);
  }

  /* Grid tiles to offer: every type for a new field; for an existing one its
     current type first, then the compatible migrations in matrix order.
     Computed types (formula/lookup/rollup/relation) have no tile set — their
     type is fixed. */
  function typeChoices(existingType) {
    if (!existingType) return FIELD_TYPES.filter((t) => !t.minted);
    const byId = Object.fromEntries(FIELD_TYPES.map((t) => [t.id, t]));
    const self = byId[existingType];
    if (!self || self.computed) return [];
    if (self.relation) return [self];
    // formula is the ƒ toggle, never a grid tile — a computed target never draws here.
    return ([self, ...(TYPE_MIGRATIONS[existingType] ?? []).map((id) => byId[id]).filter(Boolean)]).filter((t) => t && !t.computed);
  }

  /* The form's state after picking a migration target: whatever config can
     carry over does (options <-> states), so the categories/colors can be
     tuned before the save; the old default is dropped — it was a value of
     the old type. The engine derives anything left empty (text -> select
     builds its options from the values present). */
  /* Reorder by drag: the item at `from` lands at `to`. */
  function moveItem(list, from, to) {
    const out = list.slice();
    const [it] = out.splice(from, 1);
    out.splice(to, 0, it);
    return out;
  }

  function migrateState(state, toType) {
    const next = { ...blankState(toType), options: [], states: [] };
    const from = state.type;
    if ((toType === 'select' || toType === 'multiselect') && (from === 'select' || from === 'multiselect')) {
      next.options = (state.options ?? []).map((o) => ({ ...o }));
    } else if ((toType === 'select' || toType === 'multiselect') && from === 'workflow') {
      next.options = (state.states ?? []).map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name, color: '' }));
    } else if (toType === 'workflow' && from === 'select') {
      next.states = (state.options ?? []).map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name, category: 'in-progress' }));
    }
    return next;
  }

  // Four since 2026-08-24: 'other' was retired with the chip system. The
  // engine migrates anything still stored under it to in-progress.
  const STATE_CATEGORIES = ['not-started', 'in-progress', 'done', 'canceled'];
  // Glyphs a state may wear in its chip; '' = none.
  // Kyle accepted five more on 2026-08-26; they sit with the meanings they
  // belong to rather than in a pile at the end.
  const STATE_ICONS = ['', '○', '◔', '◑', '◕', '●', '▶', '✓', '✕', '⏸', '⊘', '⚑', '★', '!', '?', '◎', '→', '⛓', '⌁'];
  /* What each mark is FOR, so a picker can be searched by word rather than
     by recognising a glyph (Issue #87). */
  const STATE_ICON_LABELS = {
    '○': 'empty · not started', '◔': 'a quarter done', '◑': 'half done', '◕': 'three quarters done',
    '●': 'full', '✓': 'tick · done · complete', '✕': 'cross · cancelled', '⏸': 'paused · on hold',
    '⚑': 'flag', '★': 'star', '!': 'urgent', '?': 'question · unknown', '→': 'arrow · next',
    '▶': 'running', '⊘': 'blocked', '◎': 'target · milestone',
    '⛓': 'link · related', '⌁': 'automation',
  };

  /* One catalogue for every icon an author picks: a space, a table, a select
     option, a workflow state. The marks lead because they carry progress and
     outcome — a quarter-filled circle is not in any flat set — and the whole
     flat set follows. `flat` is the vendored icon names; the caller owns the
     set so this stays pure. */
  /* ---------- one set of categories (Kyle, 2026-08-29) ----------
     A grid needs somewhere to break, and "marks" versus "flat set" was never a
     distinction a person picking an icon cares about. The drawn marks and the
     vendored names sort into the same eleven groups, marks first inside each
     because they say a state where the flat icons name a thing.

     The category rides on each choice as `hint`, which pickerCore already
     ranks against — so typing 'money' finds the whole group without a second
     search path, and the grid groups on the same field. */
  const WEAVE_CATEGORIES = [
    { name: 'status', marks: ['○', '◔', '◐', '◑', '◕', '●', '▶', '✓', '✕', '⏸', '⊘', '⚑', '★', '!', '?', '◎'],
      flat: ['triangle-alert', 'info', 'square-x', 'square-check', 'shield-check', 'shield-x', 'file-x', 'file-minus', 'bug'] },
    { name: 'people', marks: [], flat: ['user', 'users', 'users-round', 'user-plus', 'briefcase', 'heart', 'user-cog', 'award'] },
    { name: 'documents', marks: [], flat: ['file-text', 'file', 'file-plus', 'file-up', 'file-down', 'folder', 'bookmark',
             'pencil', 'square-pen', 'upload', 'download', 'paperclip', 'archive', 'copy', 'clipboard', 'history'] },
    { name: 'writing', marks: [], flat: ['pilcrow', 'heading', 'bold', 'italic', 'strikethrough', 'list', 'list-ordered', 'list-indent-decrease', 'list-indent-increase',
             'quote', 'code', 'code-xml', 'braces', 'table', 'minus', 'corner-down-left', 'hash', 'link', 'workflow'] },
  { name: 'data', marks: ['⛓', '⌁'], flat: ['chart-bar', 'chart-pie', 'activity', 'layout-grid', 'funnel', 'search', 'scan', 'sliders-horizontal',
             'compass', 'arrow-left-right', 'list-filter', 'kanban', 'list-checks', 'chart-column', 'layers', 'blocks', 'route', 'gauge', 'terminal', 'cpu'] },
    { name: 'money', marks: [], flat: ['dollar-sign', 'euro', 'credit-card', 'coins', 'receipt', 'landmark', 'trending-up',
             'percent', 'wallet', 'shopping-cart', 'shopping-bag', 'badge-percent', 'ticket', 'ticket-check'] },
    { name: 'time', marks: [], flat: ['calendar', 'calendar-range', 'clock', 'timer'] },
    { name: 'messages', marks: [], flat: ['mail', 'message-circle', 'send', 'bell', 'phone', 'phone-call', 'phone-missed', 'phone-off', 'bell-ring', 'message-square', 'radio', 'wifi'] },
    { name: 'media', marks: [], flat: ['camera', 'image', 'play', 'video', 'mic', 'volume-2', 'volume-1', 'volume-x'] },
    { name: 'access', marks: [], flat: ['lock', 'lock-open', 'key-round', 'log-in', 'log-out', 'eye', 'eye-off', 'key', 'key-square', 'id-card'] },
    { name: 'arrows', marks: ['→'], flat: ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right',
             'circle-arrow-up', 'circle-arrow-down', 'circle-arrow-left', 'circle-arrow-right', 'square-arrow-up', 'square-arrow-down', 'square-arrow-left', 'square-arrow-right', 'arrow-up-right'] },
  ];
  /* The inventory (Kyle, 2026-09-02): every icon weave offers, across the
     tool, is one of these groups — Lucide shapes chosen for what a space, a
     table, an option or a state is likely to be called, not the whole of an
     open-source library. The vendored set is built FROM these lists (plus the
     twins a legacy value resolves to), so the picker, the vocabulary and the
     files cannot drift apart. 'other' stays last and is also the fallback: a
     name typed by hand that no group claims is still drawn and still offered
     rather than dropped, because a missing icon is worse than one filed
     loosely. */
  const ICON_CATEGORIES = [
    ...WEAVE_CATEGORIES,
    { name: 'other', marks: ['+'], flat: ['house', 'map-pin', 'star', 'gamepad-2', 'settings', 'plus', 'trash-2', 'ellipsis', 'refresh-cw', 'undo', 'redo', 'sparkles', 'lightbulb', 'rocket', 'cloud-upload', 'cloud-download', 'battery', 'maximize-2',
             'ellipsis-vertical', 'grip-vertical', 'sun', 'moon', 'sun-moon'] },
  ];
  /* Every name the curated groups offer, in group order — what the generator
     vendors and what `weave vocabulary icons` lists. */
  const ICON_INVENTORY = ICON_CATEGORIES.flatMap((g) => g.flat);

  const CATEGORY_OF = new Map();
  for (const g of ICON_CATEGORIES) {
    for (const m of g.marks) CATEGORY_OF.set(m, g.name);
    for (const f of g.flat) CATEGORY_OF.set(`lucide:${f}`, g.name);
  }
  const FALLBACK_CATEGORY = ICON_CATEGORIES[ICON_CATEGORIES.length - 1].name;
  /* A curated group wins; then the icon's own Lucide category, from the
     registry or from a caller that has it; then the fallback. */
  const categoryOf = (id, catOf = null) => {
    const curated = CATEGORY_OF.get(id);
    if (curated) return curated;
    const name = /^lucide:(.+)$/.exec(String(id))?.[1];
    const own = name && catOf?.(name);
    return own && ICON_CATEGORIES.some((g) => g.name === own) ? own : FALLBACK_CATEGORY;
  };

  /* Choices, in category order, ready to draw as a grid. The empty 'No icon'
     control is left out: it is not an icon and belongs beside the grid, not
     inside a category. */
  function iconGroups(choices) {
    const by = new Map();
    for (const c of choices) {
      if (!c.id) continue;
      if (!by.has(c.hint)) by.set(c.hint, []);
      by.get(c.hint).push(c);
    }
    return ICON_CATEGORIES
      .map((g) => ({ name: g.name, items: by.get(g.name) ?? [] }))
      .filter((g) => g.items.length);
  }

  function iconChoices(flat = [], catOf = null) {
    const mark = (g) => ({ id: g, label: STATE_ICON_LABELS[g] ?? g, mark: g, hint: categoryOf(g) });
    const flatOf = (n) => ({ id: `lucide:${n}`, label: n, lucide: n, hint: categoryOf(`lucide:${n}`, catOf) });
    const order = (a, b) => {
      const ai = ICON_CATEGORIES.findIndex((g) => g.name === a.hint);
      const bi = ICON_CATEGORIES.findIndex((g) => g.name === b.hint);
      return ai - bi;
    };
    return [
      { id: '', label: 'No icon' },
      ...[...STATE_ICONS.filter(Boolean).map(mark), ...flat.map(flatOf)].sort(order),
    ];
  }

  const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'join', 'median', 'stdev', 'distinct', 'filled', 'empty', 'range'];
  const NUMBER_FORMATS = ['number', 'currency', 'percent', 'compact'];
  // ISO 4217 codes offered in the picker (any valid code types in too).
  const CURRENCIES = [
    ['USD', 'US dollar'], ['EUR', 'Euro'], ['MXN', 'Mexican peso'], ['CNY', 'Chinese yuan'], ['JPY', 'Japanese yen'],
    ['RUB', 'Russian ruble'], ['CAD', 'Canadian dollar'], ['GBP', 'British pound'], ['AUD', 'Australian dollar'], ['CHF', 'Swiss franc'],
    ['INR', 'Indian rupee'], ['BRL', 'Brazilian real'], ['SGD', 'Singapore dollar'], ['HKD', 'Hong Kong dollar'], ['SEK', 'Swedish krona'],
  ].map(([id, name]) => ({ id, label: `${id} — ${name}` }));
  // Mirrors date-grain.js (contract-tested): the styles, and the two axes a
  // time of day adds. A style needing a part the grain does not store is not
  // offered — legalFormats() is the list the tray draws.
  const DATE_FORMATS = ['iso', 'us', 'eu', 'long', 'short', 'month', 'quarter', 'ordinal', 'relative'];
  const CLOCKS = ['24h', '12h'];
  const ZONES = ['floating', 'fixed', 'instant'];
  const DG = () => root.weaveDateGrain;
  const legalFormats = (grain) => DG().legalFormats(grain);
  const DOCUMENT_KINDS = ['markdown', 'html', 'code'];
  // Mirrors the engine's CREDENTIAL_KINDS / KEYSTORES (contract-tested).
  const CREDENTIAL_KINDS = ['apikey', 'token', 'password', 'id', 'pair'];
  const KEYSTORES = ['local', '1password', 'aws-sm', 'google-sm', 'cloudflare', 'apple-passwords'];
  const CARDINALITIES = ['many-to-one', 'one-to-many', 'many-to-many', 'one-to-one'];
  const MAX_DEPTH = 4;
  const DEFAULTABLE = ['text', 'number', 'date', 'daterange', 'checkbox', 'toggle', 'url', 'email', 'select', 'multiselect'];
  // Mirrors the engine's VIEW_SHAPES / DESCRIPTION_SIZES (source-gated).
  const VIEW_SHAPES = ['chip', 'card'];
  const DESCRIPTION_SIZES = ['none', 'small', 'medium', 'large'];
  const blankView = (shape = 'chip') => (shape === 'card'
    ? { shape: 'card', link: true, state: true, description: 'small', fields: null }
    : { shape: 'chip', link: false, state: true, description: 'none', fields: null });
  // Radix-soft swatches for select/multiselect options; '' = neutral chip.
  const OPTION_COLORS = ['', '#4769eb', '#2ea043', '#f59f00', '#e5484d', '#8e4ec6', '#00a2c7', '#d6409f'];

  const blankState = (type = 'text') => ({
    type,
    computed: false,          // false | 'formula' — any field can be a formula
    expression: '',
    options: [],              // [{name, color}]
    states: [],               // [{name, category, default}]
    number: { format: 'number', unit: '', currency: 'USD', decimals: null, separator: false, accounting: false },
    date: { grain: { year: true, month: true, day: true }, format: DG().DEFAULT_FORMAT, time: false, clock: DG().DEFAULT_CLOCK, zone: 'floating', zoneName: '', pad: false, elapsed: false },
    depth: 1,
    multiple: true,           // attachments: one file or many
    kind: 'markdown',         // document: markdown | html | code
    toggle: { on: 'On', off: 'Off' }, // toggle: the two state labels
    relation: { targetDb: '', cardinality: 'many-to-one', inverseName: '' },
    relationField: '',
    // A rollup rolls up through a relation, or — on the Spaces registry —
    // over a whole table (Issue #222). A table named here is the second
    // mode; empty is the first, so the mode needs no key of its own.
    via: '',
    where: null,
    targetField: '',
    aggregate: 'count',
    default: '',
    view: blankView(),    // view: the chip/card config, whole
  });

  /* A range default rides the dialog state as JSON text — '{"start":…,"end":…}'
     — and is the object again on the way out. Anything else (the old free
     text, half a range) is no default at all. */
  function rangeDefault(raw) {
    if (raw && typeof raw === 'object') return raw.start && raw.end ? { start: raw.start, end: raw.end } : null;
    try {
      const r = JSON.parse(String(raw ?? ''));
      return r && r.start && r.end ? { start: r.start, end: r.end } : null;
    } catch { return null; }
  }

  function typedDefault(type, raw) {
    const s = String(raw ?? '').trim();
    if (!s || !DEFAULTABLE.includes(type)) return undefined;
    if (type === 'daterange') return rangeDefault(s) ?? undefined;
    if (type === 'checkbox' || type === 'toggle') return ['true', 'yes', '1'].includes(s.toLowerCase());
    if (type === 'number') return Number(s);
    if (type === 'multiselect') return s.split(',').map((x) => x.trim()).filter(Boolean);
    return s;
  }

  /* Dialog state -> canonical {type, config}. Emits the same minimal shape
     the engine normaliser would store, so the code pane shows truth. */
  /* The number costume: decimals/separator always; then currency (ISO code)
     OR a free-text unit, never both — a currency field's formatting is its
     own (Kyle, 2026-08-23). Shared by number fields and formula results. */
  function numberCostume(n = {}) {
    const config = {};
    if (n.format && n.format !== 'number') config.format = n.format;
    if (n.format === 'currency' || n.format === 'compact') {
      if (n.currency && String(n.currency).trim()) config.currency = String(n.currency).trim().toUpperCase();
    } else if (n.unit && String(n.unit).trim()) config.unit = String(n.unit).trim();
    if (n.decimals != null && n.decimals !== '') config.decimals = Number(n.decimals);
    // Compact groups on its own; accounting is a currency convention.
    if (n.separator && n.format !== 'compact') config.separator = true;
    if (n.accounting && n.format === 'currency') config.accounting = true;
    return config;
  }

  /* The date grain + costume, canonical-minimal like the engine stores it:
     the full grain, a floating clock and the date-grain defaults (long,
     12h) all say nothing. */
  function dateCostume(d = {}, type = 'date') {
    const config = {};
    const g = d.grain ?? { year: true, month: true, day: true };
    const parts = ['year', 'month', 'day'].filter((p) => g[p]);
    if (parts.length < 3) config.grain = parts;
    if (d.format && d.format !== DG().DEFAULT_FORMAT) config.format = d.format;
    if (d.pad && ['us', 'eu'].includes(d.format)) config.pad = true;
    if (d.time) {
      config.time = true;
      if (d.clock && d.clock !== DG().DEFAULT_CLOCK) config.clock = d.clock;
      if (d.zone && d.zone !== 'floating') {
        config.zone = d.zone;
        if (d.zone === 'fixed' && d.zoneName) config.zoneName = d.zoneName;
      }
      if (d.elapsed && type === 'daterange') config.elapsed = true;
    }
    return config;
  }
  function definitionFromState(state) {
    if (state.computed === 'formula') {
      return { type: 'formula', config: { expression: state.expression ?? '', ...numberCostume(state.number) } };
    }
    const t = state.type;
    const config = {};
    if (t === 'select' || t === 'multiselect') {
      config.options = (state.options ?? []).map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name, color: o.color ?? '' }));
    } else if (t === 'workflow') {
      // No default flag: the engine takes the first state (the list's order
      // is the selector's order). Icons ride along when set.
      config.states = (state.states ?? []).map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name, category: s.category ?? 'in-progress', ...(s.icon ? { icon: s.icon } : {}) }));
    } else if (t === 'number') {
      Object.assign(config, numberCostume(state.number));
    } else if (t === 'date' || t === 'daterange') {
      Object.assign(config, dateCostume(state.date, t));
    } else if (t === 'field') {
      config.depth = state.depth ?? 1;
    } else if (t === 'text') {
      if (state.literal) config.literal = true;
    } else if (t === 'attachments') {
      if (state.multiple === false) config.multiple = false;
    } else if (t === 'document') {
      if (state.kind && state.kind !== 'markdown') config.kind = state.kind;
    } else if (t === 'key') {
      // Both always stated: a credential column whose kind is implicit reads
      // as an API key, and an SSN column silently doing that is the mistake
      // worth spending two JSON keys to prevent (Feature #143).
      config.kind = state.credential?.kind ?? 'apikey';
      config.keystore = state.credential?.keystore ?? 'local';
    } else if (t === 'relation') {
      // Not an addField config: the addRelation payload, sent to /relations.
      // A target set (2+ tables) makes a one-way polymorphic relation — no
      // inverse to name, so the inverse rides only the single-target shape.
      if (state.relation?.targetDbs?.length > 1) {
        config.targetDbs = [...state.relation.targetDbs];
        config.cardinality = state.relation?.cardinality ?? 'many-to-one';
      } else {
        config.targetDb = state.relation?.targetDb ?? '';
        config.cardinality = state.relation?.cardinality ?? 'many-to-one';
        if (state.relation?.inverseName) config.inverseName = state.relation.inverseName;
      }
    } else if (t === 'lookup') {
      config.relationField = state.relationField;
      config.targetField = state.targetField;
    } else if (t === 'view') {
      const v = state.view ?? blankView();
      Object.assign(config, { shape: v.shape, link: !!v.link, state: !!v.state, description: v.description ?? 'none', fields: Array.isArray(v.fields) ? v.fields.slice() : null });
    } else if (t === 'toggle') {
      const tg = state.toggle ?? {};
      config.on = String(tg.on ?? '').trim() || 'On';
      config.off = String(tg.off ?? '').trim() || 'Off';
    } else if (t === 'rollup') {
      // The space rollup (Issue #222): `via` names the table it reads and
      // there is no relation to cross. The engine takes the relation when
      // both are sent, so only one is ever written.
      if (state.via) config.via = state.via;
      else config.relationField = state.relationField;
      config.aggregate = state.aggregate ?? 'count';
      if (config.aggregate !== 'count' && state.targetField) config.targetField = state.targetField;
      // No editor writes a filter yet; a column that has one keeps it.
      if (state.via && state.where) config.where = state.where;
    }
    const dflt = typedDefault(t, state.default);
    if (dflt !== undefined) config.default = dflt;
    if (state.term && state.term.singular) config.term = { ...state.term };
    return { type: t, config };
  }

  /* Canonical {type, config} -> dialog state (for edit mode and for code
     pane edits flowing back into the form). */
  function stateFromDefinition(def) {
    const state = blankState(def.type);
    const c = def.config ?? {};
    if (c.term && c.term.singular) state.term = { ...c.term };
    if (def.type === 'formula') {
      state.type = 'text'; // grid shows a neutral tile behind the toggle
      state.computed = 'formula';
      state.expression = c.expression ?? '';
      state.number = { format: c.format ?? 'number', unit: c.unit ?? '', currency: c.currency ?? 'USD', decimals: c.decimals ?? null, separator: !!c.separator };
      return state;
    }
    if (def.type === 'view') {
      state.view = { ...blankView(c.shape), ...c, fields: Array.isArray(c.fields) ? c.fields.slice() : null };
      return state;
    }
    if (def.type === 'select' || def.type === 'multiselect') {
      state.options = (c.options ?? []).map((o) => (typeof o === 'string' ? { name: o, color: '' } : { ...(o.id ? { id: o.id } : {}), name: o.name, color: o.color ?? '' }));
    } else if (def.type === 'workflow') {
      state.states = (c.states ?? []).map((s) => (typeof s === 'string'
        ? { name: s, category: 'in-progress', default: false }
        : { ...(s.id ? { id: s.id } : {}), name: s.name, category: s.category ?? 'in-progress', ...(s.icon ? { icon: s.icon } : {}) }));
    } else if (def.type === 'number') {
      state.number = { format: c.format ?? 'number', unit: c.unit ?? '', currency: c.currency ?? 'USD', decimals: c.decimals ?? null, separator: !!c.separator, accounting: !!c.accounting };
    } else if (def.type === 'date' || def.type === 'daterange') {
      const parts = c.grain ?? ['year', 'month', 'day'];
      state.date = {
        grain: { year: parts.includes('year'), month: parts.includes('month'), day: parts.includes('day') },
        format: c.format ?? DG().DEFAULT_FORMAT, time: !!c.time, clock: c.clock ?? DG().DEFAULT_CLOCK, zone: c.zone ?? 'floating',
        zoneName: c.zoneName ?? '', pad: !!c.pad, elapsed: !!c.elapsed,
      };
    } else if (def.type === 'field') {
      state.depth = c.depth ?? 1;
    } else if (def.type === 'text') {
      state.literal = !!c.literal;
    } else if (def.type === 'toggle') {
      state.toggle = { on: c.on ?? 'On', off: c.off ?? 'Off' };
    } else if (def.type === 'attachments') {
      state.multiple = c.multiple !== false;
    } else if (def.type === 'document') {
      state.kind = c.kind ?? 'markdown';
    } else if (def.type === 'key') {
      state.credential = { kind: c.kind ?? 'apikey', keystore: c.keystore ?? 'local' };
    } else if (def.type === 'relation') {
      state.relation = { targetDb: c.targetDb ?? '', cardinality: c.cardinality ?? 'many-to-one', inverseName: c.inverseName ?? '' };
    } else if (def.type === 'lookup' || def.type === 'rollup') {
      state.relationField = c.relationField ?? '';
      state.targetField = c.targetField ?? '';
      state.aggregate = c.aggregate ?? 'count';
      if (def.type === 'rollup') { state.via = c.via ?? ''; state.where = c.where ?? null; }
    }
    if (c.default !== undefined && c.default !== null) {
      state.default = Array.isArray(c.default) ? c.default.join(', ')
        : typeof c.default === 'object' ? JSON.stringify(c.default) : String(c.default);
    }
    return state;
  }

  const serializeDefinition = (state) => JSON.stringify(definitionFromState(state), null, 2);

  /* Client mirror of the engine's config validation — same messages, so the
     code pane's errors match what the server would say. */
  function parseDefinition(text) {
    let def;
    try { def = JSON.parse(text); } catch (e) { return { ok: false, error: e.message }; }
    if (!def || typeof def !== 'object' || typeof def.type !== 'string') {
      return { ok: false, error: 'A field definition must be an object of { type, config }' };
    }
    const known = FIELD_TYPES.map((t) => t.id).concat('formula');
    if (!known.includes(def.type)) {
      return { ok: false, error: `'${def.type}' is not a type this dialog can create (use ${known.join(', ')})` };
    }
    const c = def.config ?? {};
    if (typeof c !== 'object' || Array.isArray(c)) return { ok: false, error: 'config must be an object' };
    const fail = (error) => ({ ok: false, error });
    if (def.type === 'number') {
      if (c.format != null && !NUMBER_FORMATS.includes(c.format)) return fail(`Invalid number format '${c.format}' (${NUMBER_FORMATS.join(', ')})`);
      if (c.decimals != null && (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 6)) return fail(`Decimals must be 0..6, got '${c.decimals}'`);
      if (c.format === 'compact' && c.separator) return fail('Compact groups on its own; a separator has nothing to add');
      if (c.accounting && c.format !== 'currency') return fail('Accounting negatives need format currency');
    }
    if (def.type === 'date' || def.type === 'daterange') {
      let grain;
      try { grain = DG().normalizeGrain(c.grain); } catch (e) { return fail(e.message); }
      const parts = grain ?? ['year', 'month', 'day'];
      if (!parts.length && !c.time) return fail('A grain with no date parts must keep a time of day');
      if (c.format != null) { const problem = DG().formatProblem(parts, c.format); if (problem) return fail(problem); }
      if (c.clock != null && !CLOCKS.includes(c.clock)) return fail(`Invalid clock '${c.clock}' (${CLOCKS.join(', ')})`);
      if (c.clock != null && !c.time) return fail('A clock needs a time of day');
      if (c.zone != null && !ZONES.includes(c.zone)) return fail(`Invalid zone '${c.zone}' (${ZONES.join(', ')})`);
      if (c.zone != null && !c.time) return fail('A zone needs a time of day');
      if (c.zone === 'fixed' && !c.zoneName) return fail('A fixed zone needs a zoneName (an IANA name: America/Los_Angeles, Europe/Berlin…)');
      if (c.zone === 'fixed' && c.zoneName && !DG().isZone(c.zoneName)) return fail(`'${c.zoneName}' is not a time zone`);
      if (c.elapsed && def.type !== 'daterange') return fail('elapsed belongs to a range');
      if (c.elapsed && !c.time) return fail('elapsed needs a time of day at both ends');
    }
    if (def.type === 'field') {
      const depth = c.depth ?? 1;
      if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) return fail(`Definition depth must be 1..${MAX_DEPTH}, got '${depth}'`);
    }
    if (def.type === 'select' || def.type === 'multiselect') {
      if (c.options != null && !Array.isArray(c.options)) return fail('options must be an array');
    }
    if (def.type === 'workflow') {
      const states = c.states ?? [];
      if (!Array.isArray(states) || states.length === 0) return fail('Workflow field needs at least one state');
      for (const s of states) {
        const cat = typeof s === 'string' ? 'in-progress' : (s.category ?? 'in-progress');
        if (!STATE_CATEGORIES.includes(cat)) return fail(`Invalid state category '${cat}' (use ${STATE_CATEGORIES.join(', ')})`);
      }
    }
    if (def.type === 'formula' && !(typeof c.expression === 'string' && c.expression.trim())) {
      return fail('Formula field needs an expression');
    }
    if (def.type === 'rollup' && c.aggregate != null && !AGGREGATES.includes(c.aggregate)) {
      return fail(`Invalid aggregate '${c.aggregate}' (use ${AGGREGATES.join(', ')})`);
    }
    if (def.type === 'view') {
      if (!VIEW_SHAPES.includes(c.shape)) return fail(`A view is a chip or a card, not '${c.shape}'`);
      if (c.description != null && !DESCRIPTION_SIZES.includes(c.description)) return fail(`description is one of ${DESCRIPTION_SIZES.join(', ')}`);
      if (c.fields !== undefined && c.fields !== null && !Array.isArray(c.fields)) return fail('fields is a list of field names, or null for the first few');
      for (const k of ['link', 'state']) if (c[k] != null && typeof c[k] !== 'boolean') return fail(`${k} is true or false`);
    }
    if (def.type === 'key') {
      if (c.kind != null && !CREDENTIAL_KINDS.includes(c.kind)) return fail(`Invalid credential kind '${c.kind}' (${CREDENTIAL_KINDS.join(', ')})`);
      if (c.keystore != null && !KEYSTORES.includes(c.keystore)) return fail(`Invalid keystore '${c.keystore}' (${KEYSTORES.join(', ')})`);
    }
    return { ok: true, def: { type: def.type, config: c } };
  }

  /* The exact token the formula language accepts for a field name (Issue
     #128). A bare identifier only parses when it looks like one AND cannot
     be read as something else — a keyword, or a function name the parser
     would treat as a call. Everything else rides in [brackets], which the
     tokenizer takes verbatim to the first ']'. A name containing ']' cannot
     be bracketed and has no formula spelling at all — the chip still inserts
     the bracketed form, and the expression preview shows the parse error. */
  const FORMULA_KEYWORDS = ['or', 'and', 'true', 'false', 'null'];
  function formulaFieldToken(name) {
    const bareSafe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      && !FORMULA_KEYWORDS.includes(name.toLowerCase())
      && !FORMULA_FUNCTIONS.some((fn) => fn.name === name);
    return bareSafe ? name : `[${name}]`;
  }

  /* Autocomplete (design review 2026-09-01, direction D): chips are
     discovery, typing is speed. Given the text and the caret: an open
     bracket offers this table's readable fields, two or more letters offer
     functions — both from the lists the chips draw from, prefix-ranked.
     formulaApply rewrites the word under the caret with the pick and says
     where the caret lands (inside a call's parens). Pure; the popover in
     app.js only draws what this returns. */
  function formulaSuggest(text, caret, fields, selfName = null) {
    const before = String(text ?? '').slice(0, caret);
    const none = { kind: null, start: caret, end: caret, items: [] };
    const lb = before.lastIndexOf('[');
    if (lb >= 0 && before.indexOf(']', lb) < 0) {
      const prefix = before.slice(lb + 1).toLowerCase();
      const items = formulaFieldChoices(fields, selfName)
        .filter((f) => !f.excluded && f.name.toLowerCase().startsWith(prefix))
        .map((f) => ({ label: `[${f.name}]`, insert: `[${f.name}]`, detail: f.type, caretBack: 0 }));
      return items.length ? { kind: 'field', start: lb, end: caret, items } : none;
    }
    const word = before.match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0];
    if (!word || word.length < 2) return none;
    const prefix = word.toLowerCase();
    const items = FORMULA_FUNCTIONS
      .filter((fn) => fn.name.startsWith(prefix))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((fn) => ({ label: `${fn.name}()`, insert: `${fn.name}()`, detail: fn.sig, caretBack: 1 }));
    return items.length ? { kind: 'function', start: caret - word.length, end: caret, items } : none;
  }
  function formulaApply(text, suggestion, item) {
    const next = String(text ?? '').slice(0, suggestion.start) + item.insert + String(text ?? '').slice(suggestion.end);
    return { text: next, caret: suggestion.start + item.insert.length - (item.caretBack ?? 0) };
  }

  /* The agent panel (design review 2026-09-01, direction C): the calls an
     agent would make for what the dialog just built — check until ok:true,
     save, read a cell back — as CLI lines and the MCP tool sequence, from
     what the dialog knows (table, field, expression). Static text: a human
     copies it; the panel that could not express what the dialog did would
     mean a browser-only gate slipped past the agent-surface suite. */
  const shq = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
  // A placeholder (<name>) stays bare: it is for the reader to replace.
  const arg = (v) => (/^[A-Za-z0-9_./#-]+$|^<[a-z]+>$/.test(v) ? v : shq(v));
  function agentRecipe({ table, field, expression, edit = false }) {
    const expr = (expression ?? '').trim() || '<expression>';
    const name = (field ?? '').trim() || '<name>';
    const t = arg(table);
    const cfg = shq(JSON.stringify({ expression: expr }));
    const cli = [
      { note: 'check until ok:true (previews on a real row)', cmd: 'weave formula check ' + t + ' ' + shq(expr) + (edit ? ' --exclude-field ' + arg(name) : '') },
      { note: 'save — an invalid expression is rejected with the same error',
        cmd: edit ? 'weave field update ' + t + ' ' + arg(name) + ' --config ' + cfg : 'weave field add ' + t + ' ' + arg(name) + ' formula --config ' + cfg },
      { note: 'verify the cell', cmd: 'weave get ' + t + '#1' },
    ];
    const mcp = ['weave_check_formula', edit ? 'weave_update_field' : 'weave_add_field', 'weave_get_entity'];
    const text = cli.map((l, i) => '# ' + (i + 1) + ' · ' + l.note + '\n' + l.cmd).join('\n') + '\n# MCP: ' + mcp.join(' → ');
    return { cli, mcp, text };
  }

  /* The fold-back: the schema flattens a field's config onto the field view,
     and the tray reads {type, config} — so reopening a column means folding
     the flat view back into the canonical definition. Without it every
     existing credential column reopened claiming to be a local API key —
     which is the one wrong answer for an SSN column. */
  function definitionFromFieldView(f) {
    const c = {};
    if (f.type === 'select' || f.type === 'multiselect') c.options = f.optionsFull ?? (f.options ?? []).map((n) => ({ name: n, color: '' }));
    if (f.type === 'workflow') c.states = f.states ?? [];
    if (f.type === 'number' || f.type === 'formula') for (const k of ['format', 'unit', 'currency', 'decimals', 'separator', 'accounting']) { if (f[k] != null) c[k] = f[k]; }
    if (f.type === 'date' || f.type === 'daterange') for (const k of ['grain', 'format', 'time', 'clock', 'zone', 'zoneName', 'pad', 'elapsed']) { if (f[k] != null) c[k] = f[k]; }
    if (f.type === 'formula') c.expression = f.expression ?? '';
    if (f.type === 'field') c.depth = f.depth ?? 1;
    if (f.type === 'text' && f.literal) c.literal = true;
    if (f.type === 'attachments') c.multiple = f.multiple !== false;
    if (f.type === 'toggle') { c.on = f.on ?? 'On'; c.off = f.off ?? 'Off'; }
    if (f.type === 'document' && f.kind) c.kind = f.kind;
    if (f.type === 'key') { c.kind = f.kind ?? 'apikey'; c.keystore = f.keystore ?? 'local'; }
    /* The schema spells a rollup's RELATION `via` and its whole TABLE
       `viaTable`; the definition spells the table `via` and has no word for
       the relation but `relationField`. So the space rollup folds back on
       viaTable, and only what is left is the relation kind (Issue #222). */
    if (f.type === 'rollup' && f.viaTable) {
      c.via = f.viaTable;
      c.targetField = f.targetField ?? '';
      c.aggregate = f.aggregate;
      if (f.where) c.where = f.where;
    } else if (f.type === 'lookup' || f.type === 'rollup') { c.relationField = f.via ?? ''; c.targetField = f.targetField ?? ''; c.aggregate = f.aggregate; }
    if (f.type === 'view') Object.assign(c, { shape: f.shape ?? f.role, link: !!f.link, state: !!f.state, description: f.description ?? 'none', fields: Array.isArray(f.fields) ? f.fields.slice() : null });
    if (f.default !== undefined) c.default = f.default;
    if (f.term) c.term = { ...f.term };
    return { type: f.type, config: c };
  }

  /* The PATCH body per type. The engine merges config keys, so clearing a
     number/date costume key means sending an explicit null — the canonical
     minimal def omits defaults, which would silently keep the old value. */
  function editPatchConfig(existing, def, state) {
    const c = def.config;
    const patch = {};
    // The row term is a lane of its own on the Name field: null clears it.
    if (existing.role === 'name') patch.term = c.term ?? null;
    if (existing.type === 'number' || existing.type === 'formula') {
      for (const k of ['format', 'unit', 'currency', 'decimals', 'separator', 'accounting']) patch[k] = c[k] ?? null;
    }
    if (existing.type === 'date' || existing.type === 'daterange') {
      // Every lane, every time: a null clears (a grain back to full drops the key).
      for (const k of ['grain', 'format', 'time', 'clock', 'zone', 'zoneName', 'pad', 'elapsed']) patch[k] = c[k] ?? null;
    } else if (existing.type === 'select' || existing.type === 'multiselect') {
      patch.options = (c.options ?? []).filter((o) => o.name && o.name.trim());
    } else if (existing.type === 'workflow') {
      patch.states = (c.states ?? []).filter((s) => s.name && s.name.trim());
    }
    if (existing.type === 'formula' && state.expression) patch.expression = state.expression;
    if (existing.type === 'text') patch.literal = !!state.literal;
    if (existing.type === 'attachments') patch.multiple = state.multiple !== false;
    if (existing.type === 'toggle') { patch.on = c.on; patch.off = c.off; }
    // The shape is the field's identity; everything else is the patch.
    if (existing.type === 'view') { const { shape, ...rest } = c; void shape; Object.assign(patch, rest); }
    if (existing.type === 'document') patch.kind = state.kind ?? 'markdown';
    if (DEFAULTABLE.includes(existing.type)) {
      patch.default = c.default ?? null;
    }
    return patch;
  }

  root.fieldDialogCore = {
    FIELD_TYPES, FORMULA_FUNCTIONS, FORMULA_GROUPS, formulaFunctionGroups, formulaFieldChoices, agentRecipe, formulaSuggest, formulaApply, STATE_CATEGORIES, STATE_ICONS, STATE_ICON_LABELS, iconChoices, formulaFieldToken,
    ICON_CATEGORIES, ICON_INVENTORY, iconGroups, categoryOf, AGGREGATES, TYPE_MIGRATIONS, typeChoices, typeLabel, migrateState, moveItem,
    NUMBER_FORMATS, CURRENCIES, DATE_FORMATS, CLOCKS, ZONES, legalFormats, dateCostume, rangeDefault, DOCUMENT_KINDS, CARDINALITIES, OPTION_COLORS, MAX_DEPTH, DEFAULTABLE,
    CREDENTIAL_KINDS, KEYSTORES, VIEW_SHAPES, DESCRIPTION_SIZES, blankView,
    blankState, definitionFromState, stateFromDefinition,
    definitionFromFieldView, editPatchConfig,
    serializeDefinition, parseDefinition,
  };
})(globalThis);
