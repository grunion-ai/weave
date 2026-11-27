export async function trackWrites(page) {
  await page.addInitScript(() => {
    const net = (window.__wvNet = { inflight: 0, writes: 0 });
    const base = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
      net.inflight++;
      if (method !== 'GET' && method !== 'HEAD') net.writes++;
      return base(input, init).finally(() => { net.inflight--; });
    };
  });
}

export const writesSoFar = (page) => page.evaluate(() => window.__wvNet?.writes ?? 0);

export async function quiet(page, { after = null, timeout = 10000 } = {}) {
  await page.waitForFunction((n) => {
    const net = window.__wvNet;
    return !!net && (n == null || net.writes > n) && net.inflight === 0;
  }, after, { timeout, polling: 'raf' });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(() => window.__wvNet.inflight === 0, null, { timeout, polling: 'raf' });
}

function schemaOf(spaces, tableId) {
  const out = {};
  for (const sp of spaces) for (const t of sp.tables ?? []) {
    if (t.id === tableId) continue;
    out[`${sp.space}/${t.name}`] = {
      fields: (t.fields ?? []).map((f) => `${f.name}:${f.type}`),
      views: (t.views ?? []).map((v) => ({ name: v.name, fields: v.fields })),
    };
  }
  return out;
}

export async function snapshot(page, base, tableId) {
  const get = async (path) => (await fetch(`${base}${path}`)).json();
  const [{ views }, spaces, section] = await Promise.all([
    get(`/api/tables/${tableId}/views`),
    get('/api/schema'),
    page.evaluate(() => document.querySelector('#view-pane .vp-acc[aria-expanded="true"]')?.dataset.section ?? null),
  ]);
  return { views: Object.fromEntries(views.map(({ id, ...v }) => [v.name, v])), schema: schemaOf(spaces, tableId), section };
}

export function paths(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return [at || '(root)'];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => paths(a[k], b[k], at ? `${at}.${k}` : k));
}

export function changes(before, after) {
  const views = {};
  for (const name of new Set([...Object.keys(before.views), ...Object.keys(after.views)])) {
    const p = paths(before.views[name], after.views[name]);
    if (p.length) views[name] = p;
  }
  return { views, schema: paths(before.schema, after.schema), section: before.section === after.section ? null : `${before.section} -> ${after.section}` };
}

export function violations(diff, { view, keys = [], allow = [] }) {
  const ok = new Set([...keys, ...allow]);
  const out = [];
  for (const [name, list] of Object.entries(diff.views)) {
    if (name !== view) { out.push(`view ${name} changed: ${list.join(', ')}`); continue; }
    const stray = list.filter((p) => !ok.has(p.split('.')[0]));
    if (stray.length) out.push(`${view} changed ${stray.join(', ')} beyond ${[...ok].join(', ') || 'nothing'}`);
  }
  if (diff.schema.length) out.push(`another table's schema changed: ${diff.schema.join(', ')}`);
  if (diff.section) out.push(`the open section moved: ${diff.section}`);
  return out;
}

export async function isolated(page, { base, tableId, act, writes = true }) {
  const before = await snapshot(page, base, tableId);
  const n = await writesSoFar(page);
  await act(page);
  await quiet(page, { after: writes ? n : null });
  const after = await snapshot(page, base, tableId);
  return { before, after, diff: changes(before, after) };
}
