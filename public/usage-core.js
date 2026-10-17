(function (root) {
  const ROLES = ['architect', 'editor', 'observer'];
  const DAY_KEY = 'weave-app-opened';

  const role = (value) => {
    const r = String(value ?? '').toLowerCase();
    return ROLES.includes(r) ? { role: r } : null;
  };
  const count = (n) => ({ count: Math.max(0, Math.trunc(Number(n) || 0)) });
  const template = (id, templates = []) => ['template_used', templates.includes(id) ? { source: 'catalog', template: id } : { source: 'catalog' }];

  function eventFor({ method, path, body, data, systemOf = () => null, templates = [] }) {
    if (method !== 'POST') return null;
    const b = body ?? {};
    const d = data ?? {};
    if (path === '/workspaces') return ['workspace_created', { via: 'app' }];
    if (path === '/tables') return ['table_created', null];
    if (path === '/invites') return ['invite_sent', role(b.role)];
    if (path === '/onboarding') return b.template ? template(b.template, templates) : null;
    if (/^\/spaces\/[^/]+\/use$/.test(path)) return ['template_used', { source: 'space' }];
    if (/^\/tables\/[^/]+\/import\.csv$/.test(path)) return ['rows_imported', count(d.created)];
    const m = path.match(/^\/tables\/([^/]+)\/entities$/);
    if (!m) return null;
    const kind = systemOf(m[1]);
    if (kind === 'users') return d.invite ? ['invite_sent', role(b.values?.Role)] : d.token ? ['agent_token_created', null] : null;
    if (kind === 'tables') return ['table_created', null];
    return kind ? null : ['row_created', null];
  }

  function opened(store, now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    try {
      if (store.getItem(DAY_KEY) === day) return false;
      store.setItem(DAY_KEY, day);
      return true;
    } catch {
      return false;
    }
  }

  root.WeaveUsage = { eventFor, template, opened, ROLES, DAY_KEY };
})(globalThis);
