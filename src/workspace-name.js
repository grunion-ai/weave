const BASE = 'personal-workspace';

export function workspaceName({ taken = [] } = {}) {
  const held = new Set([...taken].map((s) => String(s).toLowerCase()));
  let n = 1;
  let slug = BASE;
  while (held.has(slug)) slug = `${BASE}-${++n}`;
  return { name: `Personal Workspace${n > 1 ? ` ${n}` : ''}`, slug };
}

export function workspaceSlug(text) {
  return String(text ?? '').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['\u2019]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '').slice(0, 48).replace(/[-_]+$/, '');
}

export function nameFromFile(path) {
  const stem = String(path ?? '').split('/').pop().replace(/\.(json|db)$/, '');
  return stem && stem !== 'workspace' && /^[a-z0-9][a-z0-9-_]*$/i.test(stem) ? stem : null;
}
