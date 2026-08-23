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
    { id: 'url', label: 'url', icon: '⌘' },
    { id: 'email', label: 'email', icon: '@' },
    { id: 'select', label: 'select', icon: '◉' },
    { id: 'multiselect', label: 'multi', icon: '☰' },
    { id: 'workflow', label: 'workflow', icon: '⟳' },
    { id: 'document', label: 'document', icon: '¶' },
    { id: 'field', label: 'field', icon: '⧉' },
    { id: 'key', label: 'key', icon: '⌗' },
    { id: 'attachments', label: 'files', icon: '📎' },
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
  /* Grid tiles to offer: every type for a new field; for an existing one its
     current type first, then the compatible migrations in matrix order.
     Computed types (formula/lookup/rollup/relation) have no tile set — their
     type is fixed. */
  function typeChoices(existingType) {
    if (!existingType) return FIELD_TYPES.slice();
    const byId = Object.fromEntries(FIELD_TYPES.map((t) => [t.id, t]));
    const self = byId[existingType];
    if (!self || self.computed) return [];
    return [self, ...(TYPE_MIGRATIONS[existingType] ?? []).map((id) => byId[id]).filter(Boolean)];
  }

  /* The form's state after picking a migration target: whatever config can
     carry over does (options <-> states), so the categories/colors can be
     tuned before the save; the old default is dropped — it was a value of
     the old type. The engine derives anything left empty (text -> select
     builds its options from the values present). */
  function migrateState(state, toType) {
    const next = { ...blankState(toType), options: [], states: [] };
    const from = state.type;
    if ((toType === 'select' || toType === 'multiselect') && (from === 'select' || from === 'multiselect')) {
      next.options = (state.options ?? []).map((o) => ({ ...o }));
    } else if ((toType === 'select' || toType === 'multiselect') && from === 'workflow') {
      next.options = (state.states ?? []).map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name, color: '' }));
    } else if (toType === 'workflow' && from === 'select') {
      next.states = (state.options ?? []).map((o, i) => ({ ...(o.id ? { id: o.id } : {}), name: o.name, category: 'in-progress', default: i === 0 }));
    }
    return next;
  }

  const STATE_CATEGORIES = ['not-started', 'in-progress', 'done', 'canceled'];
  const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'join'];
  const NUMBER_FORMATS = ['number', 'currency', 'percent'];
  const DATE_FORMATS = ['iso', 'us', 'eu', 'long'];
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
    number: { format: 'number', unit: '', decimals: null, separator: false },
    date: { format: 'iso', time: false },
    depth: 1,
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
  function definitionFromState(state) {
    if (state.computed === 'formula') {
      return { type: 'formula', config: { expression: state.expression ?? '' } };
    }
    const t = state.type;
    const config = {};
    if (t === 'select' || t === 'multiselect') {
      config.options = (state.options ?? []).map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name, color: o.color ?? '' }));
    } else if (t === 'workflow') {
      config.states = (state.states ?? []).map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name, category: s.category ?? 'in-progress', default: !!s.default }));
    } else if (t === 'number') {
      const n = state.number ?? {};
      if (n.format && n.format !== 'number') config.format = n.format;
      if (n.unit && String(n.unit).trim()) config.unit = String(n.unit).trim();
      if (n.decimals != null && n.decimals !== '') config.decimals = Number(n.decimals);
      if (n.separator) config.separator = true;
    } else if (t === 'date') {
      const d = state.date ?? {};
      if (d.format && d.format !== 'iso') config.format = d.format;
      if (d.time) config.time = true;
    } else if (t === 'field') {
      config.depth = state.depth ?? 1;
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
      return state;
    }
    if (def.type === 'select' || def.type === 'multiselect') {
      state.options = (c.options ?? []).map((o) => (typeof o === 'string' ? { name: o, color: '' } : { ...(o.id ? { id: o.id } : {}), name: o.name, color: o.color ?? '' }));
    } else if (def.type === 'workflow') {
      state.states = (c.states ?? []).map((s) => (typeof s === 'string'
        ? { name: s, category: 'in-progress', default: false }
        : { ...(s.id ? { id: s.id } : {}), name: s.name, category: s.category ?? 'in-progress', default: !!s.default }));
    } else if (def.type === 'number') {
      state.number = { format: c.format ?? 'number', unit: c.unit ?? '', decimals: c.decimals ?? null, separator: !!c.separator };
    } else if (def.type === 'date') {
      state.date = { format: c.format ?? 'iso', time: !!c.time };
    } else if (def.type === 'field') {
      state.depth = c.depth ?? 1;
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
    }
    if (def.type === 'date' && c.format != null && !DATE_FORMATS.includes(c.format)) {
      return fail(`Invalid date format '${c.format}' (${DATE_FORMATS.join(', ')})`);
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
    return { ok: true, def: { type: def.type, config: c } };
  }

  root.fieldDialogCore = {
    FIELD_TYPES, FORMULA_FUNCTIONS, STATE_CATEGORIES, AGGREGATES, TYPE_MIGRATIONS, typeChoices, migrateState,
    NUMBER_FORMATS, DATE_FORMATS, OPTION_COLORS, MAX_DEPTH, DEFAULTABLE,
    blankState, definitionFromState, stateFromDefinition,
    serializeDefinition, parseDefinition,
  };
})(globalThis);
