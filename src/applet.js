/* The task applet — one table, one screen, one thumb.

   A passcode-gated single page over a single table, built for mobile Safari
   and nothing else. It is deliberately NOT part of the web app: no workspace
   rail, no table switcher, no schema. Open it, type, press return.

   Why the page is generated here and not dropped in public/: on the
   Cloudflare adapter the [assets] binding serves public/ *before* the Worker
   runs (see src/worker.js), so a file there would be permanently ungated.
   Generating it inside the dispatcher means node and workerd gate it the
   same way.

   The passcode lives in WEAVE_APPLET_PASSCODE. With no passcode set there is
   no applet at all — not even a gate to guess at. It is never written to the
   workspace, so it can never leave through /api/export. */

import { createHash, timingSafeEqual } from 'node:crypto';
import { renderMarkdown } from './markdown.js';

const COOKIE = 'wv_applet';
const YEAR = 31536000;
const ACTIVE = ['Open', 'In Progress', 'Review'];

/* Wrong guesses are cheap over a LAN; this makes them cost time. The window
   is per process — the applet is a single-user surface, not a login page. */
const MAX_TRIES = 8;
const WINDOW_MS = 10 * 60 * 1000;
// Per workspace, not per process: one workspace being hammered must not lock
// the passcode out of every other one.
const tries = new WeakMap();

const passcodeOf = () => (process.env.WEAVE_APPLET_PASSCODE ?? '').trim();
const tableOf = () => (process.env.WEAVE_APPLET_TABLE ?? 'Product/Task').trim();
/* Values every task made here starts with — WEAVE_APPLET_DEFAULTS as JSON,
   e.g. {"Assignee":"Kyle"}. Field names, not a hardcoded notion of "me". */
const defaultsOf = () => {
  try { return JSON.parse(process.env.WEAVE_APPLET_DEFAULTS ?? '{}'); } catch { return {}; }
};

const tokenFor = (pass) => createHash('sha256').update(`wv-applet-v1:${pass}`).digest('hex');

/* TextEncoder, not Buffer.from: Buffer pools its memory, so a short Buffer is
   a window onto a shared 8KB arena — and workerd's timingSafeEqual compares
   the backing store, which makes two identical passcodes disagree. Verified
   live on the hosted instance, 2026-08-28: both sides 8 bytes, still false.
   TextEncoder hands back a tight array, and the comparison tells the truth. */
const sameSecret = (a, b) => {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

const cookieValue = (header, name) => {
  for (const part of String(header ?? '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* What the phone needs to know about the table it is pointed at. The applet
   bakes in no field names: the workflow field is whichever one has that type,
   the states are its own, and every other field is drawn from its type. Point
   WEAVE_APPLET_TABLE somewhere else and the page follows. */
function schemaOf(weave, table) {
  const db = weave.getTable(table);
  const order = db.fieldOrder ?? Object.keys(db.fields);
  const all = order.map((id) => db.fields[id]).filter(Boolean);
  const nameField = db.fields[db.nameFieldId]?.name ?? 'Name';
  const wf = all.find((f) => f.type === 'workflow');
  return {
    table: weave.qualifiedName(db),
    nameField,
    workflow: wf
      ? { field: wf.name, states: (wf.config?.states ?? []).map((x) => ({ id: x.id, name: x.name, category: x.category })) }
      : null,
    fields: all
      .filter((f) => f.name !== nameField)
      .map((f) => ({ name: f.name, type: f.type, config: f.config ?? {} })),
  };
}

/* A row is its name, its fields as they are, and its files. No allowlist. */
function rowOf(weave, e) {
  const flat = (v) => (Array.isArray(v)
    ? v.map((x) => (x && typeof x === 'object' ? x.name ?? '' : x))
    : (v && typeof v === 'object' ? v.name ?? null : v ?? null));
  const fields = {};
  for (const [k, v] of Object.entries(e.fields ?? {})) fields[k] = flat(v);
  return {
    id: e.id,
    publicId: e.publicId,
    name: e.name,
    fields,
    files: (e.files ?? []).map((x) => ({ id: x.id, name: x.name, size: x.size, mime: x.mime })),
    updatedAt: e.updatedAt,
  };
}

/* Active is a question about categories, not about the word "Open". */
const activeStates = (schema) => (schema.workflow?.states ?? [])
  .filter((x) => x.category !== 'done' && x.category !== 'canceled')
  .map((x) => x.name);

/* Handle everything under <prefix>/t. Returns a response, or null so the
   dispatcher carries on. Mounted ahead of the auth wall, like a share link:
   the passcode is its own authorization. */
export function handleApplet({ weave, rx, path, out, mount }) {
  const passcode = passcodeOf();
  if (!passcode) return null;                       // no applet configured
  if (path !== '/t' && !path.startsWith('/t/')) return null;

  const deny = () => out(401, { error: 'Locked', code: 'unauthorized' });
  const unlocked = sameSecret(cookieValue(rx.header('cookie'), COOKIE) ?? '', tokenFor(passcode));

  // ---- unlock ------------------------------------------------------------
  if (path === '/t/unlock' && rx.method === 'POST') {
    const now = Date.now();
    const rec = tries.get(weave);
    if (rec && now > rec.until) tries.delete(weave);
    if ((tries.get(weave)?.n ?? 0) >= MAX_TRIES) {
      return out(429, { error: 'Too many attempts. Try again later.', code: 'rate-limited' });
    }
    let body = {};
    try { body = rx.body ?? {}; } catch { body = {}; }
    if (!sameSecret(String(body.passcode ?? ''), passcode)) {
      const cur = tries.get(weave) ?? { n: 0, until: now + WINDOW_MS };
      tries.set(weave, { n: cur.n + 1, until: cur.until });
      return out(401, { error: 'Wrong passcode', code: 'unauthorized' });
    }
    tries.delete(weave);
    const secure = String(rx.header('x-forwarded-proto') ?? '').toLowerCase() === 'https' ? '; Secure' : '';
    return out(200, { ok: true }, {
      // Set by the server and never touched by page script: WebKit caps
      // script-written cookies at 7 days, server-set ones it leaves alone.
      'Set-Cookie': `${COOKIE}=${tokenFor(passcode)}; Path=${mount}; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${secure}`,
    });
  }

  // ---- the page ----------------------------------------------------------
  if (path === '/t' && rx.method === 'GET') {
    return out(200, appPage(mount, !unlocked), {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
  }

  if (!unlocked) return deny();

  // ---- data (all of it behind the cookie) --------------------------------
  const table = tableOf();
  const body = rx.body ?? {};
  // Every id the applet accepts must belong to its own table. Without this
  // the applet would be a hole straight into the rest of the workspace.
  const mine = (id) => {
    const e = weave.state.entities[id];
    if (!e) return null;
    const db = weave.getTable(table);
    return e.dbId === db.id ? e : null;
  };

  const schema = schemaOf(weave, table);
  let m;

  if (path === '/t/data' && rx.method === 'GET') {
    const scope = rx.searchParams.get('scope') ?? 'active';
    const wf = schema.workflow;
    const where = scope === 'all' || !wf ? [] : [[wf.field, 'in', activeStates(schema)]];
    // query() cannot sort on the update stamp (#pathValue has no entry for
    // it), so the order the applet is built around is applied here.
    const res = weave.query(table, { where, limit: 300 });
    const items = res.items
      .map((e) => rowOf(weave, e))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return out(200, { schema, total: res.total, items });
  }

  if (path === '/t/data' && rx.method === 'POST') {
    const name = String(body.name ?? '').trim();
    if (!name) return out(400, { error: 'A task needs a name', code: 'invalid' });
    const values = { ...defaultsOf(), [schema.nameField]: name, ...(body.values ?? {}) };
    const e = weave.createEntity(table, values);
    return out(201, rowOf(weave, weave.readEntity(e.id)));
  }

  if (path === '/t/state' && rx.method === 'POST') {
    const e = mine(body.id);
    if (!e) return out(404, { error: 'No such task', code: 'not-found' });
    const wf = schema.workflow;
    if (!wf) return out(400, { error: 'This table has no workflow field', code: 'invalid' });
    const known = wf.states.some((x) => x.name === body.state || x.id === body.state);
    if (!known) return out(400, { error: `Unknown state '${body.state}'`, code: 'invalid' });
    weave.setState(e.id, wf.field, body.state);
    return out(200, rowOf(weave, weave.readEntity(e.id)));
  }

  if ((m = path.match(/^\/t\/entity\/([^/]+)$/))) {
    const e = mine(m[1]);
    if (!e) return out(404, { error: 'No such task', code: 'not-found' });
    if (rx.method === 'PATCH') {
      weave.updateEntity(e.id, body.values ?? body);
      return out(200, rowOf(weave, weave.readEntity(e.id)));
    }
    const full = weave.readEntity(e.id);
    return out(200, {
      ...rowOf(weave, full),
      doc: full.doc ?? '',
      docHtml: renderMarkdown(full.doc ?? ''),
      createdAt: full.createdAt,
      schema,
    });
  }

  if ((m = path.match(/^\/t\/entity\/([^/]+)\/doc$/)) && (rx.method === 'PUT' || rx.method === 'POST')) {
    const e = mine(m[1]);
    if (!e) return out(404, { error: 'No such task', code: 'not-found' });
    weave.setDoc(e.id, String(body.doc ?? body.markdown ?? ''), body.field ?? null);
    const full = weave.readEntity(e.id);
    return out(200, { ok: true, doc: full.doc ?? '', docHtml: renderMarkdown(full.doc ?? '') });
  }

  if (path === '/t/file' && rx.method === 'POST') {
    const e = mine(body.id);
    if (!e) return out(404, { error: 'No such task', code: 'not-found' });
    const file = weave.attachFile(e.id, {
      name: body.name ?? 'attachment',
      mime: body.mime ?? 'application/octet-stream',
      bytes: body.contentBase64 ?? body.bytes,
    });
    return out(201, file);
  }

  if ((m = path.match(/^\/t\/file\/([^/]+)$/)) && rx.method === 'GET') {
    // Only files that hang off this table's rows.
    const owner = Object.values(weave.state.entities)
      .find((e) => (e.files ?? []).some((f) => f.id === m[1]));
    if (!owner || !mine(owner.id)) return out(404, 'Not found');
    const { meta, bytes } = weave.readFile(m[1]);
    return out(200, bytes, {
      'Content-Type': meta.mime,
      'Content-Disposition': `inline; filename="${meta.name.replace(/[^\w.-]+/g, '_')}"`,
    });
  }

  return out(404, { error: 'No such applet route', code: 'not-found' });
}

/* ---------------------------------------------------------------- markup */

const HEAD = (mount, title, extra) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Tasks">
<meta name="theme-color" content="#f3f1ec" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1b33" media="(prefers-color-scheme: dark)">
<meta name="robots" content="noindex, nofollow">
<link rel="apple-touch-icon" href="${mount}/icon.png">
<title>${esc(title)}</title>
<style>${CSS}${extra ?? ''}</style>
</head><body>`;

const CSS = `
:root{
  --ground:#f3f1ec; --surface:#fafaf8; --sunk:#efece5;
  --line:#e6e3dc; --line-soft:#edeae3;
  --ink:#24292e; --body:#374151; --muted:#6b7280; --faint:#9aa0a6;
  --accent:#3a5bc7; --accent-soft:rgba(71,105,235,.12); --accent-line:rgba(71,105,235,.35);
  --ok:#218358; --ok-soft:rgba(46,160,67,.14);
  --warn:#7a5209; --warn-soft:rgba(245,159,0,.16);
  --bad:#ce2c31; --bad-soft:rgba(229,72,77,.12);
  --slate:#60646c; --slate-soft:rgba(0,5,20,.05);
  --shadow:0 1px 4px rgba(0,0,0,.10);
  --safe-t:env(safe-area-inset-top,0px); --safe-b:env(safe-area-inset-bottom,0px);
  --app:"Inter Var","Inter",-apple-system,BlinkMacSystemFont,"San Francisco","Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root{
  --ground:#0c1b33; --surface:#132444; --sunk:#0f1e39;
  --line:#24375e; --line-soft:#1b2c4f;
  --ink:#e0dcd4; --body:#cfd3dd; --muted:#9099ad; --faint:#71798d;
  --accent:#9eb1ff; --accent-soft:rgba(99,140,245,.18); --accent-line:rgba(99,140,245,.45);
  --ok:#71d083; --ok-soft:rgba(70,180,110,.16);
  --warn:#e0b063; --warn-soft:rgba(245,180,60,.16);
  --bad:#ff9ea1; --bad-soft:rgba(229,72,77,.18);
  --slate:#b0b7c3; --slate-soft:rgba(255,255,255,.07);
  --shadow:0 1px 4px rgba(0,0,0,.4);
}}
*{box-sizing:border-box; -webkit-tap-highlight-color:transparent}
/* Rotating the phone must not reflow the type: Safari inflates text on a
   landscape turn unless it is told the page already knows its own size. */
html{-webkit-text-size-adjust:100%; text-size-adjust:100%; touch-action:manipulation}
html,body{height:100%}
body{
  margin:0; background:var(--ground); color:var(--body);
  font-family:var(--app); font-size:15px; line-height:1.5;
  -webkit-font-smoothing:antialiased; overscroll-behavior-y:none;
}
button,input,textarea{font:inherit; color:inherit}
:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
@media (prefers-reduced-motion: reduce){*{animation-duration:.001ms !important; transition-duration:.001ms !important}}

.wv{position:fixed; inset:0; display:flex; flex-direction:column; padding-top:var(--safe-t)}
.wv-head{flex:none; display:flex; align-items:center; gap:9px; padding:14px 20px 12px}
.wv-head h1{font-size:19px; font-weight:600; color:var(--ink); letter-spacing:-.015em; margin:0}
.wv-head .spacer{flex:1}
.wv-head .tally{font-size:12.5px; color:var(--muted); font-variant-numeric:tabular-nums}
.wv-mark{width:26px; height:26px; flex:none; display:block}
.wv-mark-dark{display:none}
@media (prefers-color-scheme: dark){
  .wv-mark-light{display:none}
  .wv-mark-dark{display:block}
}
.wv-iconbtn{width:34px; height:34px; border-radius:8px; border:1px solid transparent; background:none;
  color:var(--muted); display:grid; place-items:center; flex:none}
.wv-iconbtn:active{background:var(--slate-soft)}

.wv-compose{flex:none; margin:0 16px 10px; background:var(--surface); border:1px solid var(--line);
  border-radius:12px; padding:11px 13px; display:flex; align-items:center; gap:10px;
  transition:border-color .15s, box-shadow .15s}
.wv-compose.on{border-color:var(--accent-line); box-shadow:0 0 0 3px var(--accent-soft)}
.wv-compose .plus{width:22px; height:22px; flex:none; border-radius:6px; display:grid; place-items:center;
  color:var(--accent); background:var(--accent-soft)}
.wv-input{flex:1; border:0; background:none; font-size:16px; color:var(--ink); padding:0; min-width:0}
.wv-input::placeholder{color:var(--faint)}
.wv-input:focus{outline:none}
.wv-clip{width:28px; height:28px; flex:none; border-radius:7px; border:0; background:none; padding:0;
  color:var(--faint); display:grid; place-items:center}
.wv-clip:active{background:var(--slate-soft); color:var(--accent)}
.wv-clip.has{color:var(--accent)}

.wv-list{flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain;
  padding:0 16px calc(30px + var(--safe-b)); display:flex; flex-direction:column; gap:8px}
.wv-group{font-family:var(--mono); font-size:10px; letter-spacing:.11em; text-transform:uppercase;
  color:var(--faint); padding:12px 4px 3px; display:flex; align-items:center; gap:8px}
.wv-group .line{flex:1; height:1px; background:var(--line)}
.wv-rowwrap{position:relative; border-radius:12px; overflow:hidden; flex:none}
.wv-reveal{position:absolute; inset:0; display:flex; align-items:center; justify-content:space-between;
  padding:0 22px; font-size:13px; font-weight:600; border-radius:12px; opacity:0;
  transition:opacity .12s linear, background-color .12s linear}
.wv-reveal span{display:flex; align-items:center; gap:7px; transform:scale(.82); opacity:.55;
  transition:transform .16s cubic-bezier(.2,1.4,.4,1), opacity .16s}
.wv-reveal .rv-done{color:var(--ok)}
.wv-reveal .rv-prog{color:var(--accent); margin-left:auto}
.wv-rowwrap[data-arm="done"] .rv-done, .wv-rowwrap[data-arm="prog"] .rv-prog{transform:scale(1); opacity:1}
.wv-rowwrap.leaving{transition:height .26s cubic-bezier(.4,0,.2,1), opacity .2s, margin .26s; overflow:hidden}
@keyframes wv-pop{0%{transform:scale(1)}38%{transform:scale(1.42)}100%{transform:scale(1)}}
.wv-glyph.pop{animation:wv-pop .34s cubic-bezier(.2,1.3,.4,1)}
.wv-row{position:relative; display:flex; align-items:flex-start; gap:12px; background:var(--surface);
  border:1px solid var(--line); border-radius:12px; padding:13px 13px 13px 12px; touch-action:pan-y;
  transition:transform .18s cubic-bezier(.2,.8,.3,1), opacity .2s}
.wv-row:active{background:var(--sunk)}
.wv-row.swiping{transition:none}
.wv-row.pending{opacity:.55}
.wv-glyph{width:26px; height:26px; flex:none; border-radius:50%; border:0; background:none; padding:0;
  display:grid; place-items:center; margin-top:-1px}
.wv-rowmain{flex:1; min-width:0; display:flex; flex-direction:column; gap:6px}
.wv-title{font-size:16px; line-height:1.32; color:var(--ink); letter-spacing:-.006em; overflow-wrap:anywhere}
.wv-row[data-cat="done"] .wv-title{color:var(--muted); text-decoration:line-through; text-decoration-color:var(--faint)}
.wv-row[data-cat="canceled"] .wv-title{color:var(--faint); text-decoration:line-through}
.wv-meta{display:flex; flex-wrap:wrap; gap:5px; align-items:center}
.wv-chev{color:var(--faint); flex:none; margin-top:3px; opacity:.7}

.k{font-size:11.5px; line-height:18px; padding:1px 8px; border-radius:4px; display:inline-flex;
  align-items:center; gap:4px; white-space:nowrap; border:0; font-family:inherit}
.k.slate{background:var(--slate-soft); color:var(--slate)}
.k.blue{background:var(--accent-soft); color:var(--accent)}
.k.green{background:var(--ok-soft); color:var(--ok)}
.k.amber{background:var(--warn-soft); color:var(--warn)}
.k.red{background:var(--bad-soft); color:var(--bad)}
.k.ghost{background:none; color:var(--muted); padding:1px 0}
.k.pointer{background:none; color:var(--accent); padding:1px 0}
.k.pointer::after{content:"\\2197"; font-size:9px; opacity:.6; margin-left:1px}
.k-add{background:none; border:1px dashed var(--line); color:var(--faint); border-radius:4px;
  font-size:12.5px; line-height:22px; padding:2px 9px}
.k-more{background:none; color:var(--faint); padding:2px 4px; font-size:12.5px}
.k-empty{font-size:11.5px; line-height:18px; padding:1px 8px; color:var(--faint); border-style:dashed}
.wv-doc-empty{display:block; width:100%; text-align:left; color:var(--faint); border-style:dashed; font-size:14px}

.wv-donebar{display:flex; align-items:center; gap:8px; padding:11px 13px; border-radius:12px; flex:none;
  border:1px dashed var(--line); background:none; font-size:13.5px; color:var(--muted); margin-top:4px}
.wv-donebar .n{margin-left:auto; font-variant-numeric:tabular-nums; color:var(--faint)}
.wv-empty{text-align:center; color:var(--faint); font-size:13.5px; padding:38px 20px; line-height:1.6}

.wv-toast{position:fixed; left:16px; right:16px; bottom:calc(24px + var(--safe-b)); z-index:40;
  background:var(--ink); color:var(--ground); border-radius:11px; padding:12px 15px;
  display:flex; align-items:center; gap:12px; font-size:14px; box-shadow:var(--shadow);
  transform:translateY(18px); opacity:0; pointer-events:none;
  transition:transform .24s cubic-bezier(.2,.9,.3,1), opacity .18s}
.wv-toast.up{transform:translateY(0); opacity:1; pointer-events:auto}
.wv-toast button{margin-left:auto; background:none; border:0; color:var(--ground);
  font-weight:600; text-decoration:underline}
.wv-scrim{position:fixed; inset:0; background:rgba(15,15,20,.34); z-index:44; opacity:0;
  pointer-events:none; transition:opacity .2s}
.wv-scrim.on{opacity:1; pointer-events:auto}
.wv-sheet{position:fixed; left:0; right:0; bottom:0; z-index:46; background:var(--surface);
  border-radius:22px 22px 0 0; border-top:1px solid var(--line);
  padding:10px 0 calc(24px + var(--safe-b));
  transform:translateY(102%); transition:transform .26s cubic-bezier(.2,.9,.3,1)}
.wv-sheet.up{transform:translateY(0)}
.wv-sheet .grab{width:38px; height:4px; border-radius:3px; background:var(--line); margin:2px auto 12px}
.wv-sheet h4{margin:0; padding:0 22px 10px; font-size:11px; font-family:var(--mono); letter-spacing:.1em;
  text-transform:uppercase; color:var(--faint); font-weight:500}
.wv-opt{display:flex; align-items:center; gap:12px; width:100%; padding:13px 22px; border:0;
  background:none; font-size:16px; color:var(--ink); text-align:left}
.wv-opt:active{background:var(--sunk)}
.wv-opt .tick{margin-left:auto; color:var(--accent)}

.wv-detail{position:fixed; inset:0; z-index:42; background:var(--ground); display:flex;
  flex-direction:column; padding-top:var(--safe-t);
  transform:translateX(100%); transition:transform .28s cubic-bezier(.25,.9,.3,1)}
.wv-detail.in{transform:translateX(0)}
.wv-dhead{flex:none; display:flex; align-items:center; gap:6px; padding:10px 12px 8px; color:var(--accent); font-size:15px}
.wv-dhead button{background:none; border:0; color:inherit; display:flex; align-items:center; gap:3px; padding:6px 4px}
.wv-dhead .pid{margin-left:auto; font-family:var(--mono); font-size:11px; color:var(--faint)}
.wv-dbody{flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:4px 20px calc(40px + var(--safe-b))}
.wv-crumbs{font-size:12px; color:var(--faint); display:flex; gap:6px; margin-bottom:8px}
.wv-dtitle{font-size:25px; line-height:1.24; font-weight:600; color:var(--ink); letter-spacing:-.02em;
  border:0; background:none; width:100%; resize:none; padding:0; margin:0 0 14px; overflow:hidden}
.wv-dtitle:focus{outline:none}
.wv-dsec{font-family:var(--mono); font-size:10px; letter-spacing:.11em; text-transform:uppercase;
  color:var(--faint); margin:0 0 8px; display:flex; align-items:center; gap:8px}
.wv-dsec .line{flex:1; height:1px; background:var(--line)}
.wv-vrail{display:flex; flex-wrap:wrap; gap:6px; margin:0 0 18px; align-items:center}
.wv-vrail .k{font-size:12.5px; line-height:22px; padding:2px 10px}
.wv-vrail .k.pointer{padding:2px 2px}
.wv-files{display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px}
.wv-file{display:flex; align-items:center; gap:9px; padding:8px 12px 8px 9px; border-radius:10px;
  border:1px solid var(--line); background:var(--surface); font-size:13.5px; color:var(--ink);
  max-width:100%; text-decoration:none}
.wv-file .thumb{width:28px; height:28px; border-radius:6px; background:var(--slate-soft); flex:none;
  display:grid; place-items:center; color:var(--muted); font-family:var(--mono); font-size:9px; text-transform:uppercase}
.wv-file .nm{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.wv-file .sz{color:var(--faint); font-size:11.5px; flex:none}
.wv-file.add{border-style:dashed; color:var(--muted)}
.wv-doc{border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:15px 16px;
  margin-bottom:18px; font-size:15px; line-height:1.6; color:var(--body); overflow-wrap:anywhere}
.wv-doc :first-child{margin-top:0}
.wv-doc :last-child{margin-bottom:0}
.wv-doc h1,.wv-doc h2,.wv-doc h3{font-size:16px; color:var(--ink); margin:14px 0 6px}
.wv-doc pre{font-family:var(--mono); font-size:12.5px; background:var(--sunk); border-radius:8px;
  padding:10px 12px; overflow-x:auto}
.wv-doc code{font-family:var(--mono); font-size:12.5px; background:var(--slate-soft); padding:1px 5px; border-radius:4px}
.wv-doc table{border-collapse:collapse; font-size:13px; width:100%; display:block; overflow-x:auto}
.wv-doc td,.wv-doc th{border:1px solid var(--line); padding:4px 8px; text-align:left}
.wv-doc img{max-width:100%}
.wv-dfoot{font-size:12px; color:var(--faint); display:flex; flex-direction:column; gap:3px}

.wv-bug{position:fixed; right:3px; bottom:calc(15px + var(--safe-b)); z-index:50; width:44px; height:44px;
  border:0; background:none; padding:0; display:grid; place-items:center; opacity:.62; color:var(--ink)}
.wv-bug:active{opacity:1}
.wv-bug .face{width:26px; height:26px; border-radius:7px; background:var(--surface);
  border:1px solid var(--line); box-shadow:var(--shadow); display:grid; place-items:center}

`;

const GATE_CSS = `
.wv-mark-dark{display:none}
@media (prefers-color-scheme: dark){.wv-mark-light{display:none}.wv-mark-dark{display:block}}
/* Landscape on a phone is 400-ish points tall with the keyboard gone: every
   band of chrome costs a row. The list takes the width instead. */
@media (orientation: landscape) and (max-height: 520px){
  .wv{padding-left:env(safe-area-inset-left,0px); padding-right:env(safe-area-inset-right,0px)}
  .wv-head{padding:8px 18px 6px}
  .wv-head h1{font-size:16px}
  .wv-mark{width:20px; height:20px}
  .wv-compose{margin:0 14px 8px; padding:7px 11px; border-radius:10px}
  .wv-input{font-size:16px}
  .wv-list{padding:0 14px 18px; display:grid; grid-template-columns:repeat(2, minmax(0,1fr));
    gap:8px; align-content:start}
  .wv-donebar{grid-column:1 / -1}
  .wv-row{padding:9px 11px 9px 10px; gap:10px}
  .wv-title{font-size:15px}
  .wv-glyph{width:22px; height:22px}
  .wv-glyph svg{width:16px; height:16px}
  .wv-detail{padding-left:env(safe-area-inset-left,0px); padding-right:env(safe-area-inset-right,0px)}
  .wv-dhead{padding:6px 12px 4px}
  .wv-dtitle{font-size:20px; margin-bottom:10px}
  .wv-dbody{padding:2px 18px 24px}
  .wv-sheet{max-height:86vh; overflow-y:auto}
  .wv-opt{padding:10px 22px}
  .wv-key{height:44px; border-radius:22px; font-size:20px}
  .wv-pad{gap:8px 20px; max-width:300px}
  .wv-gate .logo{margin-top:4vh}
  .wv-gate h2{margin:10px 0 2px; font-size:17px}
  .wv-dots{margin:14px 0 4px}
}

.wv-gate{position:fixed; inset:0; z-index:70; background:var(--ground); display:flex; flex-direction:column;
  align-items:center; padding:var(--safe-t) 34px calc(24px + var(--safe-b));
  transition:opacity .3s, transform .3s}
.wv-gate.gone{opacity:0; transform:scale(1.04); pointer-events:none}
.wv-gate .logo{margin-top:16vh; color:var(--ink)}
.wv-gate h2{margin:22px 0 5px; font-size:20px; font-weight:600; color:var(--ink); letter-spacing:-.015em}
.wv-gate p{margin:0; font-size:13.5px; color:var(--muted)}
.wv-dots{display:flex; gap:13px; margin:38px 0 6px}
.wv-dot{width:11px; height:11px; border-radius:50%; border:1.5px solid var(--line); transition:all .16s}
.wv-dot.on{background:var(--accent); border-color:var(--accent); transform:scale(1.12)}
.wv-dots.bad{animation:shake .4s}
.wv-dots.bad .wv-dot{border-color:var(--bad)}
@keyframes shake{10%,90%{transform:translateX(-2px)}30%,70%{transform:translateX(5px)}50%{transform:translateX(-5px)}}
.wv-hint{font-size:12px; color:var(--faint); height:18px; margin-top:8px; font-family:var(--mono)}
.wv-pad{margin-top:auto; display:grid; grid-template-columns:repeat(3,1fr); gap:16px 26px; width:100%; max-width:330px}
.wv-key{height:66px; border-radius:33px; border:1px solid var(--line); background:var(--surface);
  font-size:27px; font-weight:400; color:var(--ink)}
.wv-key:active{background:var(--accent-soft); border-color:var(--accent-line)}
.wv-key.flat{background:none; border-color:transparent; font-size:15px; color:var(--muted)}
`;

const MARK = '<img class="wv-mark wv-mark-light" src="/brand/weave-mark-light.svg" alt="weave">'
  + '<img class="wv-mark wv-mark-dark" src="/brand/weave-mark-dark.svg" alt="">';

const BIG_MARK = '<img class="wv-mark-light" src="/brand/weave-mark-light.svg" alt="weave" width="56" height="56">'
  + '<img class="wv-mark-dark" src="/brand/weave-mark-dark.svg" alt="" width="56" height="56">';

const GATE_HTML = (mount) => `
<div class="wv-gate" id="gate">
  <div class="logo">${BIG_MARK}</div>
  <h2>uno tasks</h2>
  <p>Enter the passcode</p>
  <div class="wv-dots" id="dots">${'<span class="wv-dot"></span>'.repeat(8)}</div>
  <div class="wv-hint" id="hint"></div>
  <div class="wv-pad">
    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="wv-key" data-k="${n}">${n}</button>`).join('')}
    <button class="wv-key flat" data-k="clear">clear</button>
    <button class="wv-key" data-k="0">0</button>
    <button class="wv-key flat" data-k="del">&#9003;</button>
  </div>
</div>`;

function appPage(mount, locked) {
  return `${HEAD(mount, 'Tasks', locked ? GATE_CSS : '')}
<div class="wv">
  <div class="wv-head">${MARK}<h1>Tasks</h1><span class="spacer"></span><span class="tally" id="tally"></span></div>
  <form class="wv-compose" id="compose">
    <span class="plus"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
    <input class="wv-input" id="new" type="text" placeholder="What needs doing?" enterkeyhint="send"
      autocapitalize="sentences" autocorrect="off" spellcheck="false" aria-label="New task">
    <button class="wv-clip" id="clip" type="button" aria-label="Attach a file"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 9.5l-7.1 7.1a3.2 3.2 0 0 1-4.5-4.5l7.7-7.7a2.1 2.1 0 0 1 3 3l-7.7 7.7a1 1 0 0 1-1.4-1.4l6.9-6.9"/></svg></button>
  </form>
  <div class="wv-list" id="list"></div>
</div>
<div class="wv-toast" id="toast"><span class="msg"></span><button type="button">Undo</button></div>
<div class="wv-scrim" id="scrim"></div>
<div class="wv-sheet" id="sheet"></div>
<div class="wv-detail" id="detail"></div>
${locked ? GATE_HTML(mount) : ''}
<button class="wv-bug" id="bug" type="button" title="Report a problem" aria-label="Report a problem"><span class="face"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 3.2a3 3 0 0 0-2.8 2H8a1 1 0 0 0 0 2h.4a5 5 0 0 0-.9 1.6L6 8.2a1 1 0 1 0-.8 1.8l1.4.6a6.7 6.7 0 0 0 0 1.3l-1.5.6A1 1 0 0 0 6 14.3l1.4-.6c.2.6.5 1.1.9 1.6l-1.1 1a1 1 0 1 0 1.4 1.4l1.1-1a4.6 4.6 0 0 0 4.6 0l1.1 1a1 1 0 0 0 1.4-1.4l-1.1-1c.4-.5.7-1 .9-1.6l1.4.6a1 1 0 0 0 .8-1.8l-1.5-.6a6.7 6.7 0 0 0 0-1.3l1.5-.6a1 1 0 0 0-.8-1.8l-1.5.6a5 5 0 0 0-.9-1.6h.4a1 1 0 0 0 0-2h-1.2a3 3 0 0 0-2.8-2zm0 2a1 1 0 0 1 .9.6h-1.8a1 1 0 0 1 .9-.6zm-1 5.3h2v6h-2z"/></svg></span></button>
<input type="file" id="picker" accept="image/*,application/pdf,text/*" multiple hidden>
<script src="/chip-core.js"></script>
<script>
// Safari ignores user-scalable=no in a tab; refusing the gesture is the only
// way a swipe-driven list stops turning into a zoom.
['gesturestart', 'gesturechange', 'gestureend'].forEach((g) =>
  document.addEventListener(g, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
</script>
<script>${CLIENT.replace('__MOUNT__', mount).replace('__LOCKED__', String(!!locked))}</script>
</body></html>`;
}

/* The applet's whole client. One recipe, with every choice named at the top
   so a different one is a one-line change, not a rewrite. */
const CLIENT = `
(() => {
  const MOUNT = '__MOUNT__';
  const CFG = {
    swipe: true,        // right -> the done state, left -> the in-progress one
    attach: true,       // paperclip on compose, files on the task
    fieldView: 'rail',  // 'rail' | 'rows'
    scope: 'all',       // fetch everything, show the active ones; Done tucks
    doneTuck: true,
    undo: true,
    rowChips: 4,        // how many field chips a row shows before it says "+n"
    emptyOnRow: ['date', 'multiselect'],   // types worth a tappable blank on the row
  };

  // The hue ramp is weave's own (public/chip-core.js), not a second opinion.
  const CC = globalThis.chipCore ?? {};
  const hueForIndex = CC.hueForIndex ?? (() => 'slate');
  const categoryHue = CC.categoryHue ?? (() => 'slate');
  const hueFromHex = CC.hueFromHex ?? (() => null);

  const svg = (d, n) => '<svg viewBox="0 0 24 24" width="' + (n||18) + '" height="' + (n||18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const I = {
    circle: svg('<circle cx="12" cy="12" r="8.5"/>'),
    half: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>'),
    check: svg('<circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none"/><path d="M8.3 12.2l2.6 2.6 5-5.4" stroke="var(--surface)" stroke-width="2.1"/>'),
    cross: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>'),
    chev: svg('<path d="M9 5l7 7-7 7"/>', 15),
    back: svg('<path d="M15 5l-7 7 7 7"/>', 19),
    tick: svg('<path d="M4.5 12.5l4.5 4.5 10-11"/>', 17),
    clip: svg('<path d="M17.5 9.5l-7.1 7.1a3.2 3.2 0 0 1-4.5-4.5l7.7-7.7a2.1 2.1 0 0 1 3 3l-7.7 7.7a1 1 0 0 1-1.4-1.4l6.9-6.9"/>', 14),
    plus: svg('<path d="M12 5v14M5 12h14"/>', 15),
  };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ago = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
  };
  const day = (iso) => {
    if (!iso) return '';
    const d = new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(iso) ? iso + 'T12:00:00' : iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const kb = (n) => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

  const $ = (id) => document.getElementById(id);
  const list = $('list'), input = $('new'), compose = $('compose'), toast = $('toast');
  const scrim = $('scrim'), sheet = $('sheet'), detail = $('detail'), picker = $('picker');
  let tasks = [], S = null, showDone = false, staged = [], toastTimer = null;

  // ---- what the table says about itself ---------------------------------
  const wfField = () => S && S.workflow && S.workflow.field;
  const states = () => (S && S.workflow ? S.workflow.states : []);
  const stateOf = (t) => (t.fields || {})[wfField()] || null;
  const catOf = (name) => { const x = states().find((y) => y.name === name); return x ? x.category : 'not-started'; };
  const byCat = (c) => { const x = states().find((y) => y.category === c); return x ? x.name : null; };
  const cycleNames = () => ['not-started', 'in-progress', 'done'].map(byCat).filter(Boolean);
  const isActive = (t) => { const c = catOf(stateOf(t)); return c !== 'done' && c !== 'canceled'; };
  // Fields the phone draws as chips: everything except the name, the prose,
  // and the attachments — those have their own places on the page.
  const chipFields = () => (S ? S.fields.filter((f) => !['document', 'attachments'].includes(f.type)) : []);
  /* A row has space for four chips, so the ones that answer "what is this and
     when" go first. Still no field names — the order is by type, and the
     table's own order breaks ties. */
  const CHIP_WEIGHT = { select: 0, multiselect: 1, date: 2, relation: 3, number: 4, checkbox: 5 };
  const rowFields = () => chipFields()
    .map((f, i) => ({ f, i, w: CHIP_WEIGHT[f.type] ?? 6 }))
    .sort((a, b) => a.w - b.w || a.i - b.i)
    .map((x) => x.f);

  const optionNames = (f) => (f.config.options || []).map((o) => (o && typeof o === 'object' ? o.name : o));
  const hueForValue = (f, v) => {
    const opts = f.config.options || [];
    const i = optionNames(f).indexOf(v);
    if (i < 0) return 'slate';
    const stored = opts[i] && typeof opts[i] === 'object' ? opts[i].color : null;
    return (stored && hueFromHex(stored)) || hueForIndex(i);
  };

  const api = async (path, opts) => {
    const res = await fetch(MOUNT + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    if (res.status === 401) { location.reload(); throw new Error('locked'); }
    if (!res.ok) throw new Error(await res.text());
    return res.status === 204 ? null : res.json();
  };

  function say(msg, undo) {
    toast.querySelector('.msg').textContent = msg;
    const b = toast.querySelector('button');
    b.hidden = !undo;
    b.onclick = () => { undo && undo(); toast.classList.remove('up'); };
    toast.classList.add('up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('up'), 2800);
  }
  function openSheet(html, wire) {
    sheet.innerHTML = '<div class="grab"></div>' + html;
    sheet.classList.add('up'); scrim.classList.add('on');
    wire && wire(sheet);
  }
  const closeSheet = () => { sheet.classList.remove('up'); scrim.classList.remove('on'); };
  scrim.addEventListener('click', closeSheet);

  // ---- writes, optimistic ------------------------------------------------
  async function setState(t, state) {
    const was = stateOf(t);
    if (was === state) return;
    t.fields[wfField()] = state; t.updatedAt = new Date().toISOString();
    paint();
    try {
      const row = await api('/state', { method: 'POST', body: JSON.stringify({ id: t.id, state }) });
      Object.assign(t, row);
    } catch { t.fields[wfField()] = was; say('Could not save — still ' + was); }
    paint();
    if (CFG.undo) say(state, () => setState(t, was));
  }
  const advance = (t) => {
    const c = cycleNames();
    const i = c.indexOf(stateOf(t));
    if (c.length) setState(t, i === -1 ? (byCat('in-progress') || c[0]) : c[(i + 1) % c.length]);
  };
  async function setField(t, name, value) {
    const was = t.fields[name];
    t.fields[name] = value;
    paint();
    try {
      const row = await api('/entity/' + t.id, { method: 'PATCH', body: JSON.stringify({ values: { [name]: value } }) });
      Object.assign(t, row);
    } catch { t.fields[name] = was; say('Could not set ' + name); }
    paint();
  }

  compose.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    input.focus();                                   // the loop: never give up focus
    const temp = { id: 'tmp-' + Math.random().toString(36).slice(2), name, fields: {},
                   files: [], updatedAt: new Date().toISOString(), pending: true };
    if (wfField()) temp.fields[wfField()] = byCat('not-started');
    tasks.unshift(temp);
    paint();
    list.scrollTop = 0;
    const files = staged; staged = [];
    $('clip').classList.remove('has');
    try {
      const row = await api('/data', { method: 'POST', body: JSON.stringify({ name }) });
      Object.assign(temp, row, { pending: false });
      for (const f of files) {
        const file = await api('/file', { method: 'POST', body: JSON.stringify(Object.assign({ id: temp.id }, f)) });
        temp.files.push(file);
      }
    } catch {
      temp.failed = true; temp.pending = false;
      say('Not saved — still here, try again');
    }
    paint();
  });
  input.addEventListener('focus', () => compose.classList.add('on'));
  input.addEventListener('blur', () => compose.classList.remove('on'));

  // ---- attachments -------------------------------------------------------
  const readFile = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => resolve({ name: file.name, mime: file.type || 'application/octet-stream',
                                contentBase64: String(fr.result).split(',')[1] });
    fr.readAsDataURL(file);
  });
  let pickInto = null;
  $('clip').addEventListener('click', () => { pickInto = null; picker.click(); });
  picker.addEventListener('change', async () => {
    const files = [...picker.files];
    picker.value = '';
    if (!files.length) return;
    const payloads = [];
    for (const f of files) payloads.push(await readFile(f));
    if (pickInto) {
      for (const pl of payloads) {
        const file = await api('/file', { method: 'POST', body: JSON.stringify(Object.assign({ id: pickInto.id }, pl)) });
        pickInto.files.push(file);
      }
      openDetail(pickInto); paint();
    } else {
      staged = staged.concat(payloads);
      $('clip').classList.add('has');
      input.focus();
    }
  });

  // ---- swipe -------------------------------------------------------------
  const THRESH = 72;
  let popNext = null;

  function wireSwipe(wrap, node, t) {
    let x0 = null, dx = 0, armed = null;
    const reveal = wrap.querySelector('.wv-reveal');
    node.addEventListener('pointerdown', (e) => {
      if (e.clientX < 24) return;                    // leave Safari's back gesture alone
      x0 = e.clientX; dx = 0; armed = null;
      node.classList.add('swiping');
      try { node.setPointerCapture(e.pointerId); } catch {}
    });
    node.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      const raw = e.clientX - x0;
      // Past the threshold the row keeps moving, but grudgingly: the drag
      // stops feeling free exactly where the gesture has already committed.
      dx = Math.abs(raw) <= THRESH ? raw : Math.sign(raw) * (THRESH + (Math.abs(raw) - THRESH) * 0.32);
      if (Math.abs(dx) < 3) return;
      node.style.transform = 'translateX(' + dx.toFixed(1) + 'px)';
      reveal.style.opacity = Math.min(1, Math.abs(dx) / THRESH).toFixed(2);
      reveal.style.backgroundColor = dx > 0 ? 'var(--ok-soft)' : 'var(--accent-soft)';
      const nowArmed = Math.abs(raw) >= THRESH ? (dx > 0 ? 'done' : 'prog') : null;
      if (nowArmed !== armed) { armed = nowArmed; wrap.dataset.arm = armed || ''; }
    });
    const settle = () => {
      node.classList.remove('swiping');
      node.style.transform = ''; reveal.style.opacity = ''; wrap.dataset.arm = '';
    };
    const end = () => {
      if (x0 === null) return;
      const hit = armed;
      x0 = null; armed = null;
      if (!hit) { settle(); return; }
      const next = hit === 'done' ? byCat('done') : byCat('in-progress');
      if (!next || stateOf(t) === next) { settle(); return; }
      // A row about to leave this view should be seen leaving it; one that
      // stays gets its glyph changed under the returning row instead.
      if (catOf(next) === 'done' && !showDone) {
        const h = wrap.offsetHeight;
        node.classList.remove('swiping');
        node.style.transform = 'translateX(' + (wrap.offsetWidth * 0.34) + 'px)';
        node.style.opacity = '0';
        wrap.style.height = h + 'px';
        requestAnimationFrame(() => {
          wrap.classList.add('leaving');
          wrap.style.height = '0px'; wrap.style.opacity = '0'; wrap.style.marginBottom = '-8px';
        });
        setTimeout(() => setState(t, next), 250);
      } else {
        settle(); popNext = t.id; setState(t, next);
      }
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  // ---- one chip, drawn from the field's type -----------------------------
  function chipHTML(f, v, opts) {
    const o = opts || {};
    const tap = o.editable ? ' data-edit="' + esc(f.name) + '"' : '';
    const one = (cls, txt) => '<button class="k ' + cls + '"' + tap + '>' + esc(txt) + '</button>';
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
    switch (f.type) {
      case 'workflow': return one(categoryHue(catOf(v)), v);
      case 'select': return one(hueForValue(f, v), v);
      case 'multiselect': return [].concat(v).map((x) => one(hueForValue(f, x), x)).join('');
      case 'date': return one('ghost', day(v));
      case 'checkbox': return v ? one('slate', f.name) : '';
      case 'number': return one('ghost', f.name + ' ' + v);
      case 'relation': return [].concat(v).map((x) => '<span class="k pointer">' + esc(x) + '</span>').join('');
      case 'formula': case 'lookup': case 'rollup':
        return '<span class="k k-more">\\u25e6 ' + esc(v) + '</span>';
      case 'email': case 'url': case 'text': return one('ghost', v);
      default: return one('ghost', v);
    }
  }
  const editableType = (t) => ['workflow', 'select', 'multiselect', 'date', 'number', 'text', 'email', 'url', 'checkbox'].includes(t);

  // ---- editing a field, in this page, never on another one ---------------
  function editField(t, name, after) {
    const f = chipFields().find((x) => x.name === name) || (S.workflow && name === wfField()
      ? { name, type: 'workflow', config: {} } : null);
    if (!f || !editableType(f.type)) return;
    const cur = t.fields[name];
    const done = (v) => { closeSheet(); setField(t, name, v).then(after); };

    if (f.type === 'workflow') {
      openSheet('<h4>' + esc(name) + '</h4>' + states().map((x) =>
        '<button class="wv-opt" data-v="' + esc(x.name) + '"><span class="k ' + categoryHue(x.category) + '">' + esc(x.name) + '</span>'
        + (cur === x.name ? '<span class="tick">' + I.tick + '</span>' : '') + '</button>').join(''),
        (sh) => sh.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
          closeSheet(); setState(t, b.dataset.v).then(after);
        })));
      return;
    }
    if (f.type === 'select') {
      openSheet('<h4>' + esc(name) + '</h4>' + optionNames(f).map((o) =>
        '<button class="wv-opt" data-v="' + esc(o) + '"><span class="k ' + hueForValue(f, o) + '">' + esc(o) + '</span>'
        + (cur === o ? '<span class="tick">' + I.tick + '</span>' : '') + '</button>').join('')
        + '<button class="wv-opt" data-clear style="color:var(--muted)">Clear</button>',
        (sh) => {
          sh.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => done(b.dataset.v)));
          sh.querySelector('[data-clear]').addEventListener('click', () => done(null));
        });
      return;
    }
    if (f.type === 'multiselect') {
      const picked = new Set([].concat(cur || []));
      openSheet('<h4>' + esc(name) + '</h4>' + optionNames(f).map((o) =>
        '<button class="wv-opt" data-v="' + esc(o) + '"><span class="k ' + hueForValue(f, o) + '">' + esc(o) + '</span>'
        + '<span class="tick" data-mark' + (picked.has(o) ? '' : ' hidden') + '>' + I.tick + '</span></button>').join('')
        + '<button class="wv-opt" data-save style="color:var(--accent);font-weight:600">Done</button>',
        (sh) => {
          sh.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
            const o = b.dataset.v;
            if (picked.has(o)) picked.delete(o); else picked.add(o);
            b.querySelector('[data-mark]').hidden = !picked.has(o);
          }));
          sh.querySelector('[data-save]').addEventListener('click', () => done([...picked]));
        });
      return;
    }
    const kind = f.type === 'date' ? 'date' : f.type === 'number' ? 'number'
      : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text';
    if (f.type === 'checkbox') { done(!cur); return; }
    openSheet('<h4>' + esc(name) + '</h4>'
      + '<div style="padding:0 22px 8px"><input id="fv" type="' + kind + '" value="' + esc(cur == null ? '' : cur) + '" '
      + 'style="width:100%;font-size:16px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--ground)"></div>'
      + '<button class="wv-opt" data-save style="color:var(--accent);font-weight:600">Save</button>',
      (sh) => {
        const el = sh.querySelector('#fv');
        setTimeout(() => el.focus(), 60);
        sh.querySelector('[data-save]').addEventListener('click', () => {
          const raw = el.value.trim();
          done(raw === '' ? null : (kind === 'number' ? Number(raw) : raw));
        });
      });
  }

  // ---- the task page (an overlay on this page, not a navigation) ---------
  let dView = CFG.fieldView;
  async function openDetail(t) {
    let full = t;
    try { full = await api('/entity/' + t.id); } catch {}
    const live = tasks.find((x) => x.id === full.id);
    if (live) Object.assign(live, full);
    const target = live || full;
    const fs = chipFields();
    const set = fs.filter((f) => { const v = target.fields[f.name]; return !(v == null || v === '' || (Array.isArray(v) && !v.length)); });
    const empty = fs.filter((f) => !set.includes(f) && editableType(f.type));

    const rail = '<div class="wv-vrail">'
      + set.map((f) => chipHTML(f, target.fields[f.name], { editable: editableType(f.type) })).join('')
      + empty.map((f) => '<button class="k-add k-empty" data-edit="' + esc(f.name) + '">' + esc(f.name) + '</button>').join('')
      + '</div>';
    const rows = '<div class="wv-values">'
      + fs.map((f) => '<div class="wv-val"' + (editableType(f.type) ? ' data-edit="' + esc(f.name) + '"' : '') + '>'
          + '<span class="lab">' + esc(f.name) + '</span>'
          + '<span class="v">' + (chipHTML(f, target.fields[f.name], {}) || '<span style="color:var(--faint)">—</span>') + '</span></div>').join('')
      + '</div>';

    detail.innerHTML =
      '<div class="wv-dhead"><button type="button" class="back">' + I.back + '<span>Tasks</span></button>'
      + '<span class="pid">#' + esc(target.publicId) + ' \\u00b7 ' + ago(target.updatedAt) + '</span></div>'
      + '<div class="wv-dbody">'
      + '<textarea class="wv-dtitle" rows="2">' + esc(target.name) + '</textarea>'
      + '<p class="wv-dsec">Fields<span class="line"></span><button type="button" class="k-add" data-view style="padding:1px 7px">'
      + (dView === 'rail' ? 'rows' : 'rail') + '</button></p>'
      + (dView === 'rail' ? rail : rows)
      + (CFG.attach ? '<p class="wv-dsec">Files<span class="line"></span></p><div class="wv-files">'
          + (target.files || []).map((f) => '<a class="wv-file" href="' + MOUNT + '/file/' + f.id + '" target="_blank" rel="noopener">'
              + '<span class="thumb">' + esc((f.name.split('.').pop() || 'file').slice(0, 4)) + '</span>'
              + '<span class="nm">' + esc(f.name) + '</span><span class="sz">' + kb(f.size) + '</span></a>').join('')
          + '<button class="wv-file add" data-addfile>' + I.plus + '<span class="nm">Add file</span></button></div>' : '')
      + '<p class="wv-dsec">Description<span class="line"></span>'
      + '<button type="button" class="k-add" data-doc style="padding:1px 7px">' + (full.docHtml ? 'edit' : 'add') + '</button></p>'
      + (full.docHtml
          ? '<div class="wv-doc" data-doc>' + full.docHtml + '</div>'
          : '<button class="wv-doc wv-doc-empty" data-doc>Add a description</button>')
      + '<div class="wv-dfoot"><span>Created ' + new Date(full.createdAt || target.updatedAt).toLocaleDateString() + '</span>'
      + '<span>Updated ' + ago(target.updatedAt) + ' ago</span></div></div>';
    requestAnimationFrame(() => detail.classList.add('in'));

    detail.querySelector('.back').addEventListener('click', () => detail.classList.remove('in'));
    detail.querySelector('[data-view]').addEventListener('click', () => {
      dView = dView === 'rail' ? 'rows' : 'rail';
      openDetail(target); detail.classList.add('in');
    });
    detail.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
      editField(target, b.dataset.edit, () => { openDetail(target); detail.classList.add('in'); })));
    detail.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => editDoc(target, full)));
    const add = detail.querySelector('[data-addfile]');
    if (add) add.addEventListener('click', () => { pickInto = target; picker.click(); });
    const title = detail.querySelector('.wv-dtitle');
    title.addEventListener('blur', async () => {
      const v = title.value.trim();
      if (!v || v === target.name) return;
      try {
        const row = await api('/entity/' + target.id, { method: 'PATCH', body: JSON.stringify({ values: { [S.nameField]: v } }) });
        Object.assign(target, row); paint();
      } catch { say('Could not rename'); }
    });
  }

  /* The document, written where it is read. A full-height sheet rather than
     an inline caret: a phone keyboard takes half the screen, and markdown
     wants the other half. */
  function editDoc(t, full) {
    openSheet('<h4>Description</h4>'
      + '<div style="padding:0 18px 10px"><textarea id="docedit" placeholder="Markdown" '
      + 'style="width:100%;min-height:46vh;font-size:16px;line-height:1.5;padding:12px;border:1px solid var(--line);'
      + 'border-radius:12px;background:var(--ground);font-family:var(--mono)">' + esc(full.doc || '') + '</textarea></div>'
      + '<button class="wv-opt" data-save style="color:var(--accent);font-weight:600">Save</button>',
      (sh) => {
        const el = sh.querySelector('#docedit');
        setTimeout(() => el.focus(), 60);
        sh.querySelector('[data-save]').addEventListener('click', async () => {
          const md = el.value;
          closeSheet();
          try {
            const res = await api('/entity/' + t.id + '/doc', { method: 'PUT', body: JSON.stringify({ doc: md }) });
            full.doc = md; full.docHtml = res.docHtml;
            openDetail(t); detail.classList.add('in');
          } catch { say('Could not save the description'); }
        });
      });
  }

  // ---- bug report --------------------------------------------------------
  const BUG_CATS = [['slow', 'Slow'], ['broken-ui', 'Looks broken'], ['wrong-data', 'Wrong data'], ['error', 'Error']];
  $('bug').addEventListener('click', () => {
    openSheet('<h4>Report a problem</h4>'
      + '<div style="padding:2px 22px 10px;display:flex;flex-wrap:wrap;gap:6px">'
      + BUG_CATS.map(([id, label]) => '<button class="k slate" data-cat="' + id + '" style="padding:6px 11px;font-size:13px">' + label + '</button>').join('')
      + '</div><textarea id="bugtext" placeholder="What happened?" style="margin:0 22px;width:calc(100% - 44px);min-height:74px;'
      + 'border:1px solid var(--line);border-radius:10px;background:var(--ground);padding:10px;font-size:16px"></textarea>'
      + '<button class="wv-opt" data-send style="color:var(--accent);font-weight:600">Send to weave</button>',
      (sh) => {
        const picked = new Set();
        sh.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
          const id = b.dataset.cat;
          if (picked.has(id)) picked.delete(id); else picked.add(id);
          b.className = 'k ' + (picked.has(id) ? 'blue' : 'slate');
          b.style.padding = '6px 11px'; b.style.fontSize = '13px';
        }));
        sh.querySelector('[data-send]').addEventListener('click', async () => {
          const note = sh.querySelector('#bugtext').value.trim();
          if (!picked.size && !note) { say('Pick a symptom or write a line'); return; }
          closeSheet();
          try {
            // The endpoint's own contract: categories + note, not a title and
            // a description. Asked at the root, because the Issue is filed
            // into the weave docs workspace, not this one.
            const res = await fetch('/api/bug-report', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                categories: [...picked], note, events: [],
                client: { surface: 'task applet', url: location.href, ua: navigator.userAgent,
                          viewport: innerWidth + 'x' + innerHeight, filedAt: new Date().toISOString() },
              }),
            });
            if (!res.ok) { say('Not reported \\u2014 ' + res.status); return; }
            const filed = await res.json();
            say('Reported as Issue #' + filed.publicId);
          } catch { say('Could not send the report'); }
        });
      });
  });

  // ---- render ------------------------------------------------------------
  function rowNode(t) {
    const st = stateOf(t);
    const c = catOf(st);
    const wrap = document.createElement('div');
    wrap.className = 'wv-rowwrap';
    if (CFG.swipe && wfField()) wrap.insertAdjacentHTML('beforeend',
      '<div class="wv-reveal"><span class="rv-done">' + I.tick + ' ' + esc(byCat('done') || 'Done') + '</span>'
      + '<span class="rv-prog">' + esc(byCat('in-progress') || 'Doing') + ' ' + I.half + '</span></div>');
    const node = document.createElement('div');
    node.className = 'wv-row' + (t.pending ? ' pending' : '');
    node.dataset.cat = c;
    const glyph = c === 'done' ? I.check : c === 'canceled' ? I.cross : c === 'in-progress' ? I.half : I.circle;
    const colour = c === 'done' ? 'var(--ok)' : c === 'in-progress' ? 'var(--accent)' : 'var(--faint)';

    // The row shows the fields the table has, in the table's own order.
    const chips = [];
    for (const f of rowFields()) {
      if (f.name === wfField()) {
        // The glyph already says not-started/in-progress/done; only a state
        // the glyph cannot spell earns a chip of its own.
        const spelled = cycleNames().includes(st);
        if (!spelled && st) chips.push(chipHTML(f, st, {}));
        continue;
      }
      const html = chipHTML(f, t.fields[f.name], {});
      if (html) chips.push(html);
    }
    // An empty deadline or tag set still earns a slot: triage happens in the
    // list, and a chip you can tap beats opening the task to find it blank.
    for (const f of rowFields()) {
      if (!CFG.emptyOnRow.includes(f.type) || f.name === wfField()) continue;
      const v = t.fields[f.name];
      if (!(v == null || v === '' || (Array.isArray(v) && !v.length))) continue;
      chips.push('<button class="k-add k-empty" data-edit="' + esc(f.name) + '">' + esc(f.name) + '</button>');
    }
    const shown = chips.slice(0, CFG.rowChips + CFG.emptyOnRow.length);
    if (chips.length > shown.length) shown.push('<span class="k k-more">+' + (chips.length - shown.length) + '</span>');
    if ((t.files || []).length) shown.push('<span class="k ghost" style="gap:3px">' + I.clip + ((t.files.length > 1) ? t.files.length : '') + '</span>');
    if (t.failed) shown.push('<span class="k red">not saved</span>');

    node.innerHTML = '<button class="wv-glyph" type="button" aria-label="' + esc(st || 'state') + '" style="color:' + colour + '">' + glyph + '</button>'
      + '<div class="wv-rowmain"><div class="wv-title">' + esc(t.name) + '</div>'
      + (shown.length ? '<div class="wv-meta">' + shown.join('') + '</div>' : '') + '</div>'
      + '<span class="wv-chev">' + I.chev + '</span>';
    const gbtn = node.querySelector('.wv-glyph');
    gbtn.addEventListener('click', (e) => { e.stopPropagation(); advance(t); });
    if (popNext === t.id) { gbtn.classList.add('pop'); popNext = null; }
    node.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();                           // set the field, stay in the list
      editField(t, b.dataset.edit);
    }));
    node.addEventListener('click', () => { if (!String(t.id).startsWith('tmp-')) openDetail(t); });
    wrap.appendChild(node);
    if (CFG.swipe && wfField()) wireSwipe(wrap, node, t);
    return wrap;
  }

  function paint() {
    const active = tasks.filter(isActive);
    $('tally').textContent = active.length + ' open';
    list.innerHTML = '';
    if (!tasks.length) {
      list.innerHTML = '<div class="wv-empty">Nothing here yet.<br>Type above and press return.</div>';
      return;
    }
    active.forEach((t) => list.appendChild(rowNode(t)));
    const done = tasks.filter((t) => !isActive(t));
    if (CFG.doneTuck && done.length) {
      const bar = document.createElement('button');
      bar.type = 'button'; bar.className = 'wv-donebar';
      bar.innerHTML = '<span style="color:var(--ok);display:grid">' + I.tick + '</span><span>'
        + esc(byCat('done') || 'Done') + '</span><span class="n">' + done.length + '</span>';
      bar.addEventListener('click', () => { showDone = !showDone; paint(); });
      list.appendChild(bar);
      if (showDone) done.forEach((t) => list.appendChild(rowNode(t)));
    }
  }

  async function load() {
    try {
      const data = await api('/data?scope=' + CFG.scope);
      S = data.schema;
      tasks = data.items;
    } catch { say('Offline \\u2014 showing what was here'); }
    paint();
  }

  // A tab coming back to the front has stale rows; a phone that has been in a
  // pocket for an hour has very stale rows.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  /* Getting the keyboard up on open.

     Safari refuses focus() outside a user gesture, and an await breaks the
     gesture chain — so the focus call happens FIRST, synchronously inside the
     tap that enters the last digit, and the unlock request follows it. That
     one ordering is the whole reason the gate is an overlay on this page
     rather than a page of its own: a navigation would spend the gesture.

     A warm open has no gesture at all and nothing can conjure one, so the
     first touch anywhere that is not aimed at a row does the same job. */
  const LOCKED = __LOCKED__;

  function armFirstTouch() {
    const grab = (e) => {
      if (e.target.closest('.wv-row, .wv-glyph, .wv-donebar, .wv-bug, .wv-sheet, .wv-detail, .wv-clip, input, textarea, a, button')) return;
      input.focus();
      document.removeEventListener('pointerdown', grab);
    };
    document.addEventListener('pointerdown', grab);
  }

  if (LOCKED) {
    const gate = $('gate');
    const dots = [...gate.querySelectorAll('.wv-dot')];
    const hint = $('hint');
    let buf = '', busy = false;
    const draw = () => dots.forEach((d, i) => d.classList.toggle('on', i < buf.length));
    const fail = (msg) => {
      const row = $('dots');
      row.classList.add('bad'); hint.textContent = msg;
      setTimeout(() => { row.classList.remove('bad'); buf = ''; draw(); hint.textContent = ''; }, 500);
    };
    gate.querySelectorAll('.wv-key').forEach((b) => b.addEventListener('click', async () => {
      if (busy) return;
      const k = b.dataset.k;
      if (k === 'clear') buf = '';
      else if (k === 'del') buf = buf.slice(0, -1);
      else if (buf.length < 8) buf += k;
      draw();
      if (buf.length !== 8) return;
      busy = true;
      input.focus();                                 // ← still inside the tap
      try {
        const res = await fetch(MOUNT + '/unlock', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: buf }),
        });
        if (res.ok) {
          gate.classList.add('gone');
          setTimeout(() => gate.remove(), 320);
          await load();
          input.focus();                             // the caret, after the rows
          return;
        }
        input.blur();
        fail(res.status === 429 ? 'too many tries' : 'wrong passcode');
      } catch { input.blur(); fail('no connection'); }
      busy = false;
    }));
  } else {
    load().then(() => {
      try { input.focus({ preventScroll: true }); } catch {}
      armFirstTouch();
    });
  }
})();
`;
