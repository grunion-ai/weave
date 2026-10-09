import { escapeHtml as esc } from './markdown.js';

const CSS = `
:root{
  --ground:#f3f1ec; --surface:#fafaf8; --line:#e6e3dc; --ink:#24292e; --body:#374151; --muted:#6b7280;
  --accent:#3a5bc7; --accent-ink:#fff; --bad:#ce2c31; --bad-soft:rgba(229,72,77,.12); --ok:#218358; --ok-soft:rgba(46,160,67,.14);
  --app:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root{
  --ground:#0c1b33; --surface:#132444; --line:#24375e; --ink:#e0dcd4; --body:#cfd3dd; --muted:#9099ad;
  --accent:#9eb1ff; --accent-ink:#0c1b33; --bad:#ff9ea1; --bad-soft:rgba(229,72,77,.18); --ok:#71d083; --ok-soft:rgba(70,180,110,.16);
}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--body);font-family:var(--app);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
main{max-width:440px;margin:10vh auto 0;padding:0 20px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:24px 22px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 4px;color:var(--ink);letter-spacing:-.01em}
h2{font-size:13px;margin:22px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
p{margin:0 0 14px}
.sub{color:var(--muted);font-size:13.5px}
button{font:inherit;cursor:pointer;border-radius:8px;padding:10px 16px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
button.small{padding:4px 10px;font-size:12.5px}
button[disabled]{opacity:.6;cursor:default}
.msg{margin-top:14px;padding:10px 12px;border-radius:8px;font-size:13.5px;display:none}
.msg.bad{display:block;background:var(--bad-soft);color:var(--bad)}
.msg.ok{display:block;background:var(--ok-soft);color:var(--ok)}
ul{list-style:none;margin:0;padding:0}
li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:13.5px}
li:first-child{border-top:0}
.meta{color:var(--muted);font-family:var(--mono);font-size:11.5px}
.who{display:flex;align-items:baseline;gap:8px}
.role{font-family:var(--mono);font-size:11.5px;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:1px 6px}
.row{display:flex;gap:8px;margin-top:18px}
.row button{flex:1}
a{color:var(--accent)}
a.provider{display:block;text-align:center;text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:10px 16px;margin-top:10px;font-weight:600}
.mark{display:block;width:40px;height:40px;margin:0 0 14px}
.legal{text-align:center;margin-top:14px;font-size:12.5px}
.legal a{color:var(--muted)}
`;

const JS = `
(() => {
  const mount = document.body.dataset.mount || '';
  const q = new URLSearchParams(location.search);
  const next = (() => { const n = q.get('next') || ''; return n.startsWith('/') && !n.startsWith('//') ? n : (mount + '/'); })();
  // The loopback dev instance's redirect URI is http://localhost:<port>, and
  // the trip cookie is per host, so an address typed as 127.0.0.1 moves there.
  if (location.hostname === '127.0.0.1') { location.replace(location.href.replace('127.0.0.1', 'localhost')); return; }
  const $ = (id) => document.getElementById(id);
  const api = async (path, body, method) => {
    const res = await fetch(mount + '/api/auth' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  };
  const say = (kind, text) => { const m = $('msg'); m.className = 'msg ' + kind; m.textContent = text; };
  const show = (id) => { for (const s of document.querySelectorAll('section')) s.hidden = s.id !== id; };
  const explain = (err) => String(err && err.message || err);

  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(); };
  function renderMe(me) {
    $('who-name').textContent = me.account.name;
    $('who-role').textContent = me.role;
    const sess = $('sessions'); sess.innerHTML = '';
    for (const s of me.sessions) {
      const li = document.createElement('li');
      li.innerHTML = '<span><strong></strong> <span class="meta"></span></span>';
      li.querySelector('strong').textContent = s.current ? 'This browser' : (s.ua || 'Browser').slice(0, 48);
      li.querySelector('.meta').textContent = 'seen ' + when(s.lastSeenAt);
      if (!s.current) { const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Sign out'; b.onclick = async () => { try { await api('/sessions/' + s.id, null, 'DELETE'); load(); } catch (e) { say('bad', explain(e)); } }; li.appendChild(b); }
      sess.appendChild(li);
    }
    $('others').hidden = me.sessions.filter((s) => !s.current).length === 0;
  }

  async function load() {
    let me = null;
    try { me = await api('/me'); } catch { me = null; }
    if (me) {
      renderMe(me);
      show('sec-me');
      $('go').href = next;
      $('signout').onclick = async () => { await api('/logout', {}); location.replace(mount + '/auth?signed-out=1'); };
      $('everywhere').onclick = async () => { await api('/logout?everywhere=1', {}); location.replace(mount + '/auth?signed-out=1'); };
      $('others').onclick = async () => { try { await api('/sessions/others', null, 'DELETE'); load(); } catch (e) { say('bad', explain(e)); } };
      return;
    }
    show('sec-signin');
  }
  if ($('oidc')) $('oidc').href += '?next=' + encodeURIComponent(next);
  load();
})();
`;

const MARK = '<svg class="mark" viewBox="0 0 48 48" role="img" aria-label="weave"><path d="M12,20 C16,20 16,28 20,28 C24,28 24,20 28,20 C32,20 32,28 36,28" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round"/><path d="M12,28 C16,28 16,20 20,20 C24,20 24,28 28,28 C32,28 32,20 36,20" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>';

export function renderRefusalPage({ title, lines = [], actions = [] } = {}) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>
<main>
  <div class="card">
    ${MARK}
    <h1>${esc(title)}</h1>
${[].concat(lines).map((l) => `    <p class="sub">${esc(l)}</p>\n`).join('')}${actions.map((a) => `    <a class="provider" href="${esc(a.href)}">${esc(a.label)}</a>\n`).join('')}  </div>
</main>
</body></html>`;
}

export function renderAuthPage({ mount = '', workspace = 'weave', provider = null } = {}) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Sign in — ${esc(workspace)}</title>
<style>${CSS}</style>
</head><body data-mount="${esc(mount)}">
<main>
  <div class="card">
    ${MARK}
    <section id="sec-signin" hidden>
      <h1>Sign in to ${esc(workspace)}</h1>
${provider ? `      <p class="sub">Your account here is linked to your ${esc(provider)} sign-in.</p>
      <a id="oidc" class="provider" href="${esc(mount)}/api/auth/oidc/start">Sign in with ${esc(provider)}</a>
      <p class="sub" style="margin-top:14px">No account yet? Ask an operator for a link that adds you.</p>
` : `      <p class="sub">No sign-in provider is configured for this server. An operator sets WEAVE_OIDC_ISSUER and WEAVE_OIDC_CLIENT_ID to add one. Agents and the CLI use a <code>wv_</code> token.</p>
`}    </section>
    <section id="sec-me" hidden>
      <div class="who"><h1 id="who-name"></h1><span id="who-role" class="role"></span></div>
      <p class="sub">You are signed in. <a id="go" href="${esc(mount)}/">Open the workspace →</a></p>
      <h2>Sessions</h2>
      <ul id="sessions"></ul>
      <div class="row">
        <button id="others" type="button" hidden>Sign out other sessions</button>
        <button id="signout" type="button">Sign out of ${esc(workspace)}</button>
      </div>
      <div class="row">
        <button id="everywhere" type="button">Sign out of every workspace</button>
      </div>
    </section>
    <div id="msg" class="msg" role="status"></div>
  </div>
  <p class="sub legal"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
</main>
<script>${JS}</script>
</body></html>`;
}
