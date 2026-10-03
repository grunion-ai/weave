/* A new workspace's name (Issue #594, Kyle's ruling 2026-10-03): every new
   workspace is "Personal Workspace", slug personal-workspace; the next
   unnamed one on the instance is "Personal Workspace 2", personal-workspace-2,
   then 3. meta.name holds the slug and meta.title the display name (Issue
   #592). Pure: no I/O, runs in node and in the Worker. */

const BASE = 'personal-workspace';

// `taken` holds the slugs already on the instance; a match gets -2, -3, …
export function workspaceName({ taken = [] } = {}) {
  const held = new Set([...taken].map((s) => String(s).toLowerCase()));
  let n = 1;
  let slug = BASE;
  while (held.has(slug)) slug = `${BASE}-${++n}`;
  return { name: `Personal Workspace${n > 1 ? ` ${n}` : ''}`, slug };
}

/* The slug a display name answers at (Issues #592, #599): lowercase
   letters, digits, - and _, at most 48, so "Personal finance" is
   personal-finance and "Acme" and "acme" are one slug. Empty when nothing
   usable is left. The same fold as WeaveStarters.workspaceName, lowercased. */
export function workspaceSlug(text) {
  return String(text ?? '').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['\u2019]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '').slice(0, 48).replace(/[-_]+$/, '');
}

/* A file someone named is a name asked for, the way `heroku create myapp`
   is: `--data ./other.db` makes the workspace `other`, and a hub serves it at
   /w/other/ (AGENTS.md). The default data file, `workspace`, names nothing,
   so it is called personal-workspace. A stem the rename rule refuses names
   nothing either. */
export function nameFromFile(path) {
  const stem = String(path ?? '').split('/').pop().replace(/\.(json|db)$/, '');
  return stem && stem !== 'workspace' && /^[a-z0-9][a-z0-9-_]*$/i.test(stem) ? stem : null;
}
