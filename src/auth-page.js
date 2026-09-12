/* The sign-in page (Feature #222 part 2, door B). Served at /auth — and under
   /w/<ws>/auth — even when requireAuth is on, generated here rather than
   dropped in public/ so the wall's static-asset door never has to admit an
   .html, and so the Worker's assets binding cannot serve it ahead of the
   dispatcher. Everything it needs is inline: no app.js, no vendored CSS.

   Three states, decided by the browser after one call to /api/auth/me:
     signed out           → "Sign in with a passkey" (discoverable credential)
     signed out + ?invite → "Register this device" with a label field
     signed in            → the "You" section: sessions, passkeys, sign out
   After a successful ceremony the page goes to ?next, or the workspace root. */

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
:root{
  --ground:#f3f1ec; --surface:#fafaf8; --line:#e6e3dc; --ink:#24292e; --body:#374151; --muted:#6b7280;
  --accent:#3a5bc7; --accent-ink:#fff; --bad:#ce2c31; --bad-soft:rgba(229,72,77,.12); --ok:#218358; --ok-soft:rgba(46,160,67,.14);
  --app:"Inter Var","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
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
label{display:block;font-size:13px;color:var(--muted);margin:14px 0 4px}
input{width:100%;font:inherit;color:var(--ink);background:var(--ground);border:1px solid var(--line);border-radius:8px;padding:9px 11px}
button{font:inherit;cursor:pointer;border-radius:8px;padding:10px 16px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent;width:100%;font-weight:600;margin-top:16px}
button.small{padding:4px 10px;font-size:12.5px}
button.danger{color:var(--bad)}
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
.mark{display:block;width:40px;height:40px;margin:0 0 14px}
`;

/* Runs in the browser. Plain script, no modules: it has to work on a phone
   that just scanned a QR code. */
const JS = `
(() => {
  const mount = document.body.dataset.mount || '';
  const q = new URLSearchParams(location.search);
  const invite = q.get('invite');
  const next = (() => { const n = q.get('next') || ''; return n.startsWith('/') && !n.startsWith('//') ? n : (mount + '/'); })();
  // A passkey RP ID cannot be an IP address; the loopback dev instance is
  // "localhost" to WebAuthn, so an address typed as 127.0.0.1 moves there.
  if (location.hostname === '127.0.0.1') { location.replace(location.href.replace('127.0.0.1', 'localhost')); return; }
  const $ = (id) => document.getElementById(id);
  const b64 = {
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''),
    dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
  };
  const api = async (path, body, method) => {
    const res = await fetch(mount + '/api/auth' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  };
  const say = (kind, text) => { const m = $('msg'); m.className = 'msg ' + kind; m.textContent = text; };
  const show = (id) => { for (const s of document.querySelectorAll('section')) s.hidden = s.id !== id; };
  const explain = (err) => {
    const t = String(err && err.message || err);
    if (/NotAllowedError|timed out|not allowed/i.test(t)) return 'The passkey prompt was cancelled or timed out. Try again, and pick this site\\'s passkey when your device asks.';
    if (/SecurityError/i.test(t)) return 'This page is not being served from the origin the server expects. Open it at the address in WEAVE_ORIGIN.';
    if (/InvalidStateError/i.test(t)) return 'This device already holds a passkey for this account. Sign in with it instead.';
    return t;
  };
  const supported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);

  // Sign in: a discoverable credential, so there is no username step.
  async function signIn() {
    const btn = $('signin'); btn.disabled = true; say('', '');
    try {
      const { id, options } = await api('/login/options', {});
      options.challenge = b64.dec(options.challenge);
      options.allowCredentials = (options.allowCredentials || []).map((c) => ({ ...c, id: b64.dec(c.id) }));
      const cred = await navigator.credentials.get({ publicKey: options });
      const response = { id: cred.id, rawId: b64.enc(cred.rawId), type: cred.type, response: {
        clientDataJSON: b64.enc(cred.response.clientDataJSON), authenticatorData: b64.enc(cred.response.authenticatorData),
        signature: b64.enc(cred.response.signature), userHandle: cred.response.userHandle ? b64.enc(cred.response.userHandle) : null } };
      await api('/login/verify', { id, response });
      say('ok', 'Signed in.');
      location.replace(next);
    } catch (err) { say('bad', explain(err)); btn.disabled = false; }
  }

  // Register: an invite link, or an existing session adding a device.
  async function register() {
    const btn = $('register'); btn.disabled = true; say('', '');
    try {
      const label = $('label').value.trim();
      const { id, options } = await api('/register/options', { invite: invite || undefined, label });
      options.challenge = b64.dec(options.challenge);
      options.user.id = b64.dec(options.user.id);
      options.excludeCredentials = (options.excludeCredentials || []).map((c) => ({ ...c, id: b64.dec(c.id) }));
      const cred = await navigator.credentials.create({ publicKey: options });
      const response = { id: cred.id, rawId: b64.enc(cred.rawId), type: cred.type, response: {
        clientDataJSON: b64.enc(cred.response.clientDataJSON), attestationObject: b64.enc(cred.response.attestationObject),
        transports: cred.response.getTransports ? cred.response.getTransports() : [] } };
      await api('/register/verify', { id, response, label });
      say('ok', 'Passkey registered. Taking you in…');
      location.replace(next);
    } catch (err) { say('bad', explain(err)); btn.disabled = false; }
  }

  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(); };
  function renderMe(me) {
    $('who-name').textContent = me.account.name;
    $('who-role').textContent = me.role;
    const creds = $('creds'); creds.innerHTML = '';
    for (const c of me.credentials) {
      const li = document.createElement('li');
      li.innerHTML = '<span><strong></strong> <span class="meta"></span></span>';
      li.querySelector('strong').textContent = c.label || 'Passkey';
      li.querySelector('.meta').textContent = (c.alg === -7 ? 'ES256' : 'RS256') + ' · added ' + when(c.createdAt) + (c.lastUsedAt ? ' · used ' + when(c.lastUsedAt) : '');
      const b = document.createElement('button'); b.className = 'small danger'; b.textContent = 'Remove'; b.dataset.cred = c.id;
      b.onclick = async () => { if (me.credentials.length === 1 && !confirm('This is your only passkey. Remove it? You will need a new invite to get back in.')) return; try { await api('/credentials/' + encodeURIComponent(c.id), null, 'DELETE'); load(); } catch (e) { say('bad', explain(e)); } };
      li.appendChild(b); creds.appendChild(li);
    }
    if (!me.credentials.length) creds.innerHTML = '<li class="sub">No passkey yet — register one below.</li>';
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
    if (!supported()) { show('sec-unsupported'); return; }
    let me = null;
    try { me = await api('/me'); } catch { me = null; }
    if (me) {
      renderMe(me);
      show('sec-me');
      $('go').href = next;
      $('add-device').onclick = () => { $('label').value = ''; show('sec-register'); $('register-title').textContent = 'Add this device'; };
      $('signout').onclick = async () => { await api('/logout', {}); location.reload(); };
      $('others').onclick = async () => { try { await api('/sessions/others', null, 'DELETE'); load(); } catch (e) { say('bad', explain(e)); } };
      if (!me.credentials.length && !invite) { show('sec-register'); $('register-title').textContent = 'Register this device'; }
      return;
    }
    if (invite) { show('sec-register'); return; }
    show('sec-signin');
  }
  $('signin').onclick = signIn;
  $('register').onclick = register;
  $('label').value = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  load();
})();
`;

export function renderAuthPage({ mount = '', workspace = 'weave' } = {}) {
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
    <svg class="mark" viewBox="0 0 48 48" role="img" aria-label="weave"><path d="M12,20 C16,20 16,28 20,28 C24,28 24,20 28,20 C32,20 32,28 36,28" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round"/><path d="M12,28 C16,28 16,20 20,20 C24,20 24,28 28,28 C32,28 32,20 36,20" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>
    <section id="sec-signin" hidden>
      <h1>Sign in to ${esc(workspace)}</h1>
      <p class="sub">Use the passkey on this device — Face ID, Touch ID, Windows Hello, or a security key.</p>
      <button id="signin" class="primary" type="button">Sign in with passkey</button>
      <p class="sub" style="margin-top:14px">No passkey yet? Ask an operator for an invite link, or open the one you were sent.</p>
    </section>
    <section id="sec-register" hidden>
      <h1 id="register-title">Register this device</h1>
      <p class="sub">A passkey for this device will be stored on your account. You can register more devices later from this page.</p>
      <label for="label">Device name</label>
      <input id="label" type="text" maxlength="80" placeholder="e.g. Kyle's iPhone">
      <button id="register" class="primary" type="button">Create passkey</button>
    </section>
    <section id="sec-me" hidden>
      <div class="who"><h1 id="who-name"></h1><span id="who-role" class="role"></span></div>
      <p class="sub">You are signed in. <a id="go" href="${esc(mount)}/">Open the workspace →</a></p>
      <h2>Passkeys</h2>
      <ul id="creds"></ul>
      <button id="add-device" class="small" type="button" style="margin-top:8px">Add this device</button>
      <h2>Sessions</h2>
      <ul id="sessions"></ul>
      <div class="row">
        <button id="others" type="button" hidden>Sign out other sessions</button>
        <button id="signout" type="button">Sign out</button>
      </div>
    </section>
    <section id="sec-unsupported" hidden>
      <h1>Passkeys are not available here</h1>
      <p class="sub">This browser has no WebAuthn support, or the page is not served over HTTPS (or localhost). Agents and the CLI keep using a <code>wv_</code> token.</p>
    </section>
    <div id="msg" class="msg" role="status"></div>
  </div>
</main>
<script>${JS}</script>
</body></html>`;
}
