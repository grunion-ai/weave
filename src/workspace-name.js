import '../public/slug-core.js';

const { WeaveSlugs } = globalThis;
const BASE = 'personal-workspace';

export function workspaceName({ taken = [] } = {}) {
  const held = new Set([...taken].map((s) => String(s).toLowerCase()));
  let n = 1;
  let slug = BASE;
  while (held.has(slug)) slug = `${BASE}-${++n}`;
  return { name: `Personal Workspace${n > 1 ? ` ${n}` : ''}`, slug };
}

export const workspaceSlug = (text) => WeaveSlugs.slugify(text);

export function hostSlugRefusal(slug) {
  const state = WeaveSlugs.formState(slug);
  return state ? { state, code: `slug_${state}`, message: WeaveSlugs.apiMessage(state, slug) } : null;
}

export const slugTaken = (slug) => ({ state: 'taken', code: 'slug_taken', message: WeaveSlugs.apiMessage('taken', slug) });

export function nameFromFile(path) {
  const stem = String(path ?? '').split('/').pop().replace(/\.(json|db)$/, '');
  return stem && stem !== 'workspace' && /^[a-z0-9][a-z0-9-_]*$/i.test(stem) ? stem : null;
}

export function slugOfHost(host, baseDomain) {
  if (!baseDomain || !host) return null;
  let name;
  try { name = new URL(`http://${host}`).hostname; } catch { return null; }
  return name.endsWith(`.${baseDomain}`) ? name.slice(0, -baseDomain.length - 1) : null;
}
