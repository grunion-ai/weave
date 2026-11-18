import { ROUTES, STATES } from './states.mjs';

const NO_ELEMENT = '(no trigger element)';

const ID = ':id';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

export const routeShape = (hash) => String(hash).replace(UUID, ID).replace(/^\/(?=#)/, '');

export const harvestedRoutes = (routes) => [...new Set(routes.map(([, hash]) => routeShape(hash)))].sort();

const ctxStub = () => new Proxy({}, {
  get(target, key) {
    if (key === 'base') return '';
    if (key === Symbol.toPrimitive) return () => ID;
    return ctxStub();
  },
});

export function stateRoutes(routes = ROUTES, states = STATES) {
  const out = new Map();
  for (const state of states) {
    const route = routes[state.route];
    if (!route) continue;
    for (const cell of ['desktop', 'phone']) {
      const shape = routeShape(route.url(ctxStub(), cell));
      if (!out.has(shape)) out.set(shape, state.name);
    }
  }
  return out;
}

export function harvestedTriggers(data) {
  const by = new Map();
  for (const control of data.controls ?? []) {
    for (const look of control.looks ?? []) {
      if (!look.overlay || !look.trig) continue;
      const classes = ((look.trig.html ?? '').match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
      const sig = classes.slice().sort().join('.') || NO_ELEMENT;
      const seen = by.get(sig) ?? { sig, classes, labels: new Set() };
      const label = (look.trig.text ?? '').trim();
      if (label) seen.labels.add(label);
      by.set(sig, seen);
    }
  }
  return [...by.values()].map((t) => ({ ...t, labels: [...t.labels] })).sort((a, b) => a.sig.localeCompare(b.sig));
}

export function catalogNames(src) {
  const classes = new Set([...src.matchAll(/\.([a-zA-Z][\w-]{2,})/g)].map((m) => m[1]));
  const labels = new Set();
  for (const m of src.matchAll(/'([^'\n]+)'|"([^"\n]+)"/g)) labels.add((m[1] ?? m[2]).toLowerCase());
  for (const m of src.matchAll(/text=([^'"`\n]+)/g)) labels.add(m[1].trim().toLowerCase());
  return { classes, labels };
}

export function namedByState(trigger, names) {
  if (trigger.classes.some((c) => names.classes.has(c))) return true;
  return trigger.labels.some((label) => {
    const want = label.toLowerCase();
    for (const named of names.labels) if (named === want || named.endsWith(want)) return true;
    return false;
  });
}

export function surfaceGaps({ routes, triggers, states, names, allowed = {} }) {
  const routeGaps = routes.filter((shape) => !states.has(shape));
  const triggerGaps = triggers.filter((t) => !namedByState(t, names)).map((t) => t.sig);
  const allowedRoutes = allowed.routes ?? {};
  const allowedTriggers = allowed.triggers ?? {};
  return {
    missing: {
      routes: routeGaps.filter((shape) => !(shape in allowedRoutes)),
      triggers: triggerGaps.filter((sig) => !(sig in allowedTriggers)),
    },
    stale: {
      routes: Object.keys(allowedRoutes).filter((shape) => !routeGaps.includes(shape)),
      triggers: Object.keys(allowedTriggers).filter((sig) => !triggerGaps.includes(sig)),
    },
  };
}
