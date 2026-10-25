(function (root) {
  const STEP_NAMES = { account: 'Account', workspace: 'Workspace', work: 'Your work', agent: 'Optional AI app' };
  const ORDER = Object.keys(STEP_NAMES);
  const AT = { account: 'account', workspace: 'workspace', work: 'work', build: 'work', agent: 'agent', done: 'agent' };
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
    return { ...base, step: 'workspace', data: { ...base.data, name: rows.length ? '' : me.accountName ?? '' } };
  }

  function reduce(s, e) {
    const at = (step, extra = {}) => ({ ...s, step, error: null, ...extra });
    switch (e.type) {
      case 'new':
        if (s.step !== 'list') return s;
        return s.me.canCreate ? at('workspace', { data: { name: '', slug: '', template: null, other: '', tool: null }, made: null, skipped: false }) : at('closed');
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
        if (s.step === 'workspace' || s.step === 'work') return at('build', { skipped: true, data: { ...s.data, name: e.name ?? s.data.name, slug: e.slug ?? s.data.slug } });
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

  function draft(s, now = Date.now()) {
    if (!s.me?.signedIn || !['workspace', 'work', 'build', 'agent', 'done'].includes(s.step)) return null;
    return { version: 1, at: now, identity: JSON.stringify(s.me.logins ?? []), step: s.step, data: s.data, made: s.made, skipped: s.skipped };
  }

  function resume(me, saved, now = Date.now()) {
    const fresh = begin(me, { setup: 'new' });
    if (!me.signedIn || !saved || saved.version !== 1 || saved.identity !== JSON.stringify(me.logins ?? []) || !Number.isFinite(saved.at) || now - saved.at > 86400000 || saved.at > now || !saved.data || typeof saved.data.name !== 'string' || typeof saved.data.slug !== 'string' || !['workspace', 'work', 'build', 'agent', 'done'].includes(saved.step)) return fresh;
    const row = (me.rows ?? []).find((r) => r.kind === 'workspace' && r.name === (saved.made?.name ?? saved.data.slug));
    if (saved.made && row) return { ...fresh, step: saved.step === 'done' ? 'done' : 'agent', data: saved.data, made: { ...saved.made, open: row.open }, skipped: false };
    if (saved.step === 'build' && row) return { ...fresh, step: 'done', data: saved.data, made: { name: row.name, title: row.title, open: row.open }, skipped: true };
    if (!me.canCreate || saved.made) return fresh;
    return { ...fresh, step: saved.step === 'work' ? 'work' : 'workspace', data: saved.data, error: saved.step === 'build' ? { code: 'interrupted' } : null };
  }

  function progress(s, build = null) {
    const id = AT[s.step];
    if (!id || (id === 'account' && !s.me?.signedIn)) return null;
    const n = ORDER.indexOf(id) + 1;
    const extra = s.step === 'build' && build?.of ? Math.min(1, build.done / build.of) / ORDER.length : 0;
    return { at: n / ORDER.length + extra, n, of: ORDER.length, id, label: STEP_NAMES[id] };
  }

  function exits(s) {
    const out = [];
    for (const e of [{ type: 'next', name: 'n', slug: 'n' }, { type: 'back' }, { type: 'skip' }, { type: 'new' }]) {
      const t = reduce(s, e);
      if (t !== s && t.step !== s.step) out.push(e.type);
    }
    return out;
  }

  root.WeaveSetup = { STEP_NAMES, STEPS, begin, reduce, draft, resume, progress, exits };
})(globalThis);
