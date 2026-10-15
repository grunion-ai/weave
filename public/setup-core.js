(function (root) {
  const RAIL = [
    { id: 'account', label: 'Account' },
    { id: 'workspace', label: 'Workspace' },
    { id: 'work', label: 'Template' },
    { id: 'agent', label: 'Agent' },
  ];
  const STEPS = ['account', 'list', 'closed', 'workspace', 'work', 'build', 'agent', 'done'];
  const SLUG_CODES = new Set(['slug_taken', 'slug_reserved', 'slug_invalid']);
  const SIGNIN_CODES = new Set(['signin_failed', 'signin_unverified', 'provider_down', 'signin_expired']);

  function begin(me = {}, query = {}) {
    const base = { step: 'account', me, data: { name: '', slug: '', template: null, other: '', tool: null }, error: null, skipped: false, made: null };
    const error = SIGNIN_CODES.has(query.error) ? { code: query.error } : null;
    if (!me.signedIn) return { ...base, error };
    const rows = me.rows ?? [];
    if (query.setup === 'skip' && me.canCreate && !rows.some((r) => r.kind === 'workspace')) return { ...base, step: 'build', skipped: true };
    if (rows.length && query.setup !== 'new') return { ...base, step: 'list' };
    if (!me.canCreate) return { ...base, step: rows.length ? 'list' : 'closed' };
    return { ...base, step: 'workspace', data: { ...base.data, name: me.accountName ?? '' } };
  }

  function reduce(s, e) {
    const at = (step, extra = {}) => ({ ...s, step, error: null, ...extra });
    switch (e.type) {
      case 'new':
        if (s.step !== 'list') return s;
        return s.me.canCreate ? at('workspace', { data: { ...s.data, name: s.data.name || (s.me.accountName ?? '') } }) : at('closed');
      case 'next':
        if (s.step === 'workspace') return at('work', { data: { ...s.data, name: e.name ?? s.data.name, slug: e.slug ?? s.data.slug } });
        if (s.step === 'work') return at('build', { data: { ...s.data, template: e.template ?? null, other: e.other ?? '' } });
        if (s.step === 'agent') return s.connected ? at('done') : s;
        return s;
      case 'back':
        if (s.step === 'work') return at('workspace');
        if (s.step === 'workspace' && (s.me.rows ?? []).length) return at('list');
        if (s.step === 'agent' && s.data.tool) return at('agent', { data: { ...s.data, tool: null } });
        return s;
      case 'skip':
        if (s.step === 'workspace' || s.step === 'work') return at('build', { skipped: true });
        if (s.step === 'agent') return at('done', { skippedAgent: true });
        return s;
      case 'tool':
        return s.step === 'agent' ? at('agent', { data: { ...s.data, tool: e.tool } }) : s;
      case 'built':
        if (s.step !== 'build') return s;
        return { ...s, step: s.skipped ? 'done' : 'agent', made: e.made, error: e.made?.templateError ? { code: 'template_failed', template: s.data.template } : null };
      case 'connected':
        return s.step === 'agent' ? { ...s, connected: e.at ?? true } : s;
      case 'fail': {
        if (s.step !== 'build') return { ...s, error: { code: e.code, message: e.message ?? null } };
        if (SLUG_CODES.has(e.code)) return { ...s, step: 'workspace', skipped: false, error: { code: e.code, message: e.message ?? null } };
        return { ...s, step: s.skipped ? 'workspace' : 'work', skipped: false, error: { code: e.code ?? 'build_failed', message: e.message ?? null } };
      }
      case 'dismiss':
        return { ...s, error: null };
      default:
        return s;
    }
  }

  function railState(s) {
    const order = RAIL.map((r) => r.id);
    const pos = { account: 0, list: 1, closed: 1, workspace: 1, work: 2, build: 2, agent: 3, done: 4 }[s.step];
    return order.map((id, i) => ({ id, label: RAIL[i].label, state: i < pos ? 'done' : i === pos ? 'on' : 'todo' }));
  }

  function exits(s) {
    const out = [];
    for (const e of [{ type: 'next', name: 'n', slug: 'n' }, { type: 'back' }, { type: 'skip' }, { type: 'new' }]) {
      const t = reduce(s, e);
      if (t !== s && t.step !== s.step) out.push(e.type);
    }
    return out;
  }

  root.WeaveSetup = { RAIL, STEPS, begin, reduce, railState, exits };
})(globalThis);
