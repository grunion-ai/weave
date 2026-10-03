/* A new workspace's name (Issue #594, Kyle's ruling 2026-10-02): a random
   adjective and animal, the way Heroku and Docker name a fresh resource.
   Display name in Title Case ("Quiet Turtle"), slug in kebab case
   (quiet-turtle) — the slug is what meta.name holds until Issue #592 gives
   the display name its own field.

   Adjectives are neutral or positive, so no pair reads as a jab. Every animal
   is also the name of its upstream Lucide icon, so a workspace icon can match
   its animal once those icons are vendored (public/vendor/icons ships none
   of them yet); Lucide's other animals (rat, worm, shrimp, bug) are left out on
   purpose, and its `mouse` is the computer kind. Pure: no I/O, runs in node
   and in the Worker. */

export const ADJECTIVES = [
  'quiet', 'bright', 'brave', 'calm', 'clever', 'gentle', 'golden', 'happy',
  'kind', 'lucky', 'merry', 'nimble', 'noble', 'patient', 'plucky', 'quick',
  'sunny', 'steady', 'swift', 'tidy', 'warm', 'wise', 'bold', 'cheerful',
  'curious', 'eager', 'friendly', 'jolly', 'keen', 'lively', 'mellow', 'sturdy',
];

export const ANIMALS = ['bird', 'cat', 'dog', 'fish', 'panda', 'rabbit', 'snail', 'squirrel', 'turtle'];

const cap = (w) => w[0].toUpperCase() + w.slice(1);

// `taken` holds the slugs already on the instance; a match gets -2, -3, …
export function workspaceName({ taken = [], random = Math.random } = {}) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const adjective = pick(ADJECTIVES);
  const animal = pick(ANIMALS);
  const held = new Set([...taken].map((s) => String(s).toLowerCase()));
  const base = `${adjective}-${animal}`;
  let n = 1;
  let slug = base;
  while (held.has(slug)) slug = `${base}-${++n}`;
  return { name: `${cap(adjective)} ${cap(animal)}${n > 1 ? ` ${n}` : ''}`, slug, animal };
}

/* A file someone named is a name asked for, the way `heroku create myapp`
   is: `--data ./other.db` makes the workspace `other`, and a hub serves it at
   /w/other/ (AGENTS.md). The default data file, `workspace`, names nothing,
   so it draws at random. A stem the rename rule refuses draws too. */
export function nameFromFile(path) {
  const stem = String(path ?? '').split('/').pop().replace(/\.(json|db)$/, '');
  return stem && stem !== 'workspace' && /^[a-z0-9][a-z0-9-_]*$/i.test(stem) ? stem : null;
}
