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
    { id: 'date', label: 'date', icon: '▤' },
    { id: 'daterange', label: 'range', icon: '⇤⇥' },
    { id: 'checkbox', label: 'checkbox', icon: '☑' },
    { id: 'url', label: 'url', icon: '⛓' },
    { id: 'email', label: 'email', icon: '@' },
    { id: 'select', label: 'select', icon: '▾' },
    { id: 'multiselect', label: 'multi', icon: '☰' },
    { id: 'workflow', label: 'workflow', icon: '⟳' },
    { id: 'document', label: 'document', icon: '¶' },
    { id: 'field', label: 'field', icon: '⧉' },
    { id: 'key', label: 'key', icon: '✱' },
    { id: 'attachments', label: 'files', icon: 'iconly:folder' },
    { id: 'relation', label: 'relation', icon: '⇄', relation: true },
    { id: 'lookup', label: 'lookup', icon: '↗', computed: true },
    { id: 'rollup', label: 'rollup', icon: 'Σ', computed: true },
  ];

  // Signatures shown as insertable chips in the formula builder. The name
  // list is contract-tested against FUNCS in src/formula.js.
  const FORMULA_FUNCTIONS = [
    { name: 'if', sig: 'if(cond, then, else)' },
    { name: 'concat', sig: 'concat(a, b, …)' },
    { name: 'round', sig: 'round(x, places)' },
    { name: 'abs', sig: 'abs(x)' },
    { name: 'min', sig: 'min(a, b, …)' },
    { name: 'max', sig: 'max(a, b, …)' },
    { name: 'len', sig: 'len(x)' },
    { name: 'lower', sig: 'lower(text)' },
    { name: 'upper', sig: 'upper(text)' },
    { name: 'trim', sig: 'trim(text)' },
    { name: 'contains', sig: 'contains(hay, needle)' },
    { name: 'empty', sig: 'empty(x)' },
    { name: 'today', sig: 'today()' },
    { name: 'now', sig: 'now()' },
    { name: 'days', sig: 'days(from, to)' },
    { name: 'dateadd', sig: 'dateadd(date, n, unit)' },
    { name: 'datediff', sig: 'datediff(a, b, unit)' },
    { name: 'year', sig: 'year(date)' },
    { name: 'month', sig: 'month(date)' },
    { name: 'day', sig: 'day(date)' },
    { name: 'number', sig: 'number(x)' },
    { name: 'text', sig: 'text(x)' },
  ];

  // Mirror of the engine's TYPE_MIGRATIONS (contract-tested): what an
  // existing field may become. The tray shows the field's own type plus
  // these — never a move the engine would refuse.
  const TYPE_MIGRATIONS = {
    text: ['number', 'key', 'url', 'email', 'select', 'multiselect', 'date'],
    number: ['text'],
    url: ['text'],
    email: ['text'],
    key: ['text'],
    date: ['text'],
    checkbox: ['text'],
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
    if (!existingType) return FIELD_TYPES.slice();
    const byId = Object.fromEntries(FIELD_TYPES.map((t) => [t.id, t]));
    const self = byId[existingType];
    if (!self || self.computed) return [];
    if (self.relation) return [self];
    return [self, ...(TYPE_MIGRATIONS[existingType] ?? []).map((id) => byId[id]).filter(Boolean)];
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
  const ICON_CATEGORIES = [
    { name: 'status', marks: ['○', '◔', '◐', '◑', '◕', '●', '▶', '✓', '✕', '⏸', '⊘', '⚑', '★', '!', '?', '◎'],
      flat: ['danger', 'infocircle', 'closesquare', 'ticksquare', 'shielddone', 'shieldfail',
             'paperfail', 'papernegative', 'bug'] },
    { name: 'people', marks: [], flat: ['profile', '2user', '3user', 'adduser', 'work', 'heart'] },
    { name: 'documents', marks: [], flat: ['document', 'paper', 'paperplus', 'paperupload', 'paperdownload',
             'folder', 'bookmark', 'edit', 'editsquare', 'upload', 'download'] },
    { name: 'data', marks: ['⛓', '⌁'], flat: ['chart', 'graph', 'activity', 'category', 'filter',
             'search', 'scan', 'discovery', 'swap'] },
    { name: 'money', marks: [], flat: ['dollar', 'euro', 'card', 'coins', 'invoice', 'bank', 'trend',
             'percent', 'wallet', 'buy', 'bag', 'discount', 'ticket', 'ticketstar'] },
    { name: 'time', marks: [], flat: ['calendar', 'timecircle'] },
    { name: 'messages', marks: [], flat: ['message', 'chat', 'send', 'notification', 'call', 'calling',
             'callmissed', 'callsilent'] },
    { name: 'media', marks: [], flat: ['camera', 'image', 'play', 'video', 'voice', 'volumeup',
             'volumedown', 'volumeoff'] },
    { name: 'access', marks: [], flat: ['lock', 'unlock', 'password', 'login', 'logout', 'show', 'hide'] },
    { name: 'arrows', marks: ['→'], flat: ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right'] },
    /* The last group is also the fallback: a name nobody classified is still
       offered here rather than dropped, because a missing icon is worse than
       one filed loosely. */
    { name: 'other', marks: ['+'], flat: ['home', 'location', 'star', 'game', 'setting', 'plus',
             'delete', 'morecircle'] },
  ];
  const CATEGORY_OF = new Map();
  for (const g of ICON_CATEGORIES) {
    for (const m of g.marks) CATEGORY_OF.set(m, g.name);
    for (const f of g.flat) CATEGORY_OF.set(`iconly:${f}`, g.name);
  }
  const FALLBACK_CATEGORY = ICON_CATEGORIES[ICON_CATEGORIES.length - 1].name;
  const categoryOf = (id) => CATEGORY_OF.get(id) ?? FALLBACK_CATEGORY;

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

  function iconChoices(flat = []) {
    const mark = (g) => ({ id: g, label: STATE_ICON_LABELS[g] ?? g, mark: g, hint: categoryOf(g) });
    const flatOf = (n) => ({ id: `iconly:${n}`, label: n, iconly: n, hint: categoryOf(`iconly:${n}`) });
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

  const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'join'];
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
  const DEFAULTABLE = ['text', 'number', 'date', 'daterange', 'checkbox', 'url', 'email', 'select', 'multiselect'];
  // Radix-soft swatches for select/multiselect options; '' = neutral chip.
  const OPTION_COLORS = ['', '#4769eb', '#2ea043', '#f59f00', '#e5484d', '#8e4ec6', '#00a2c7', '#d6409f'];

  const blankState = (type = 'text') => ({
    type,
    computed: false,          // false | 'formula' — any field can be a formula
    expression: '',
    options: [],              // [{name, color}]
    states: [],               // [{name, category, default}]
    number: { format: 'number', unit: '', currency: 'USD', decimals: null, separator: false, accounting: false },
    date: { grain: { year: true, month: true, day: true }, format: 'iso', time: false, clock: '24h', zone: 'floating', zoneName: '', pad: false, elapsed: false },
    depth: 1,
    multiple: true,           // attachments: one file or many
    kind: 'markdown',         // document: markdown | html | code
    relation: { targetDb: '', cardinality: 'many-to-one', inverseName: '' },
    relationField: '',
    targetField: '',
    aggregate: 'count',
    default: '',
  });

  function typedDefault(type, raw) {
    const s = String(raw ?? '').trim();
    if (!s || !DEFAULTABLE.includes(type)) return undefined;
    if (type === 'checkbox') return ['true', 'yes', '1'].includes(s.toLowerCase());
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
     the full grain, a 24h floating clock and iso all say nothing. */
  function dateCostume(d = {}, type = 'date') {
    const config = {};
    const g = d.grain ?? { year: true, month: true, day: true };
    const parts = ['year', 'month', 'day'].filter((p) => g[p]);
    if (parts.length < 3) config.grain = parts;
    if (d.format && d.format !== 'iso') config.format = d.format;
    if (d.pad && ['us', 'eu'].includes(d.format)) config.pad = true;
    if (d.time) {
      config.time = true;
      if (d.clock && d.clock !== '24h') config.clock = d.clock;
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
    } else if (t === 'rollup') {
      config.relationField = state.relationField;
      config.aggregate = state.aggregate ?? 'count';
      if (config.aggregate !== 'count' && state.targetField) config.targetField = state.targetField;
    }
    const dflt = typedDefault(t, state.default);
    if (dflt !== undefined) config.default = dflt;
    return { type: t, config };
  }

  /* Canonical {type, config} -> dialog state (for edit mode and for code
     pane edits flowing back into the form). */
  function stateFromDefinition(def) {
    const state = blankState(def.type);
    const c = def.config ?? {};
    if (def.type === 'formula') {
      state.type = 'text'; // grid shows a neutral tile behind the toggle
      state.computed = 'formula';
      state.expression = c.expression ?? '';
      state.number = { format: c.format ?? 'number', unit: c.unit ?? '', currency: c.currency ?? 'USD', decimals: c.decimals ?? null, separator: !!c.separator };
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
        format: c.format ?? 'iso', time: !!c.time, clock: c.clock ?? '24h', zone: c.zone ?? 'floating',
        zoneName: c.zoneName ?? '', pad: !!c.pad, elapsed: !!c.elapsed,
      };
    } else if (def.type === 'field') {
      state.depth = c.depth ?? 1;
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
    }
    if (c.default !== undefined && c.default !== null) {
      state.default = Array.isArray(c.default) ? c.default.join(', ') : String(c.default);
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

  root.fieldDialogCore = {
    FIELD_TYPES, FORMULA_FUNCTIONS, STATE_CATEGORIES, STATE_ICONS, STATE_ICON_LABELS, iconChoices, formulaFieldToken,
    ICON_CATEGORIES, iconGroups, categoryOf, AGGREGATES, TYPE_MIGRATIONS, typeChoices, typeLabel, migrateState, moveItem,
    NUMBER_FORMATS, CURRENCIES, DATE_FORMATS, CLOCKS, ZONES, legalFormats, dateCostume, DOCUMENT_KINDS, CARDINALITIES, OPTION_COLORS, MAX_DEPTH, DEFAULTABLE,
    CREDENTIAL_KINDS, KEYSTORES,
    blankState, definitionFromState, stateFromDefinition,
    serializeDefinition, parseDefinition,
  };
})(globalThis);
