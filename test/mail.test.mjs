/* The invite emails (Feature #216, Issue #569): the two templates Kyle
   approved on 2026-10-03, and the Architect-only preview route that renders
   them with sample values. The copy is asserted word for word; the html is
   held to what a mail client needs: inline styles, no SVG, a PNG mark on
   the instance's own origin, a dark block, every variable escaped. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inviteEmail, inviteAcceptedEmail, ROLES, art, longDate } from '../src/mail.js';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://weave.example.com';
const LINK = `${ORIGIN}/api/auth/oidc/start?invite=wvi_abc`;
const invite = (over = {}) => inviteEmail({ inviter: 'kyle', workspace: 'weave', role: 'editor', expires: 'October 10', link: LINK, origin: ORIGIN, ...over });
const accepted = (over = {}) => inviteAcceptedEmail({ workspace: 'weave', role: 'editor', member: 'dana', joined: 'October 3', members: `${ORIGIN}/w/weave/#members`, origin: ORIGIN, ...over });

test('invite: subject, preheader and plain text are the approved copy', () => {
  const m = invite();
  assert.equal(m.subject, 'Invite from kyle to the weave workspace');
  assert.equal(m.preheader, "You're invited as an Editor. The invite works once and expires on October 10.");
  assert.equal(m.text, `You have an invite from kyle to join the weave workspace on weave. As an Editor, you can view, create and edit entries.

Accept the invite here:
${LINK}

The link opens Clerk, weave's sign-in service, where you can use your Google account. Your first sign-in creates your weave account and opens the workspace.

The invite works once and expires on October 10. Replies to this email don't reach anyone, so ask kyle if you have questions or need a new invite.

You got this email because kyle entered your address to invite you to a workspace on weave.example.com. If you weren't expecting it, you can ignore it and the invite will expire unused. weave keeps your address only on the pending invite and deletes it once the invite is used, revoked or expired.
`);
  for (const line of ['>Workspace invite<', '>Join the weave workspace<', '>Accept invite<', '>Works once. Expires October 10.<',
    "The button opens Clerk, weave's sign-in service, where you can use your Google account.",
    'If the button does nothing, paste this link into your browser:', '>Your role<', '>Invited by<']) {
    assert.ok(m.html.includes(line), `html carries ${line}`);
  }
});

test('accepted: subject, preheader and plain text are the approved copy', () => {
  const m = accepted();
  assert.equal(m.subject, 'New Editor in the weave workspace: dana');
  assert.equal(m.preheader, "Change dana's role or remove them in the weave workspace's Members section.");
  assert.equal(m.text, `The weave workspace has a new Editor: dana accepted your invite.

To change dana's role or remove them, open the Members section on the weave home page:
${ORIGIN}/w/weave/#members

You got this email because you sent an invite from the weave workspace on weave.example.com. weave deleted the address you entered for this invite when dana accepted it.
`);
  for (const line of ['>Invite accepted<', '>New Editor in weave<', '>Open Members<', '>Joined October 3<', 'weave · weave.example.com']) {
    assert.ok(m.html.includes(line), `html carries ${line}`);
  }
});

test('each role renders its own chip, colours and capability line, in html and text', () => {
  for (const [id, r] of Object.entries(ROLES)) {
    const m = invite({ role: id });
    assert.match(m.html, new RegExp(`class="chip chip-${id}" style="[^"]*background:${r.chip[0]};color:${r.chip[1]}">${r.name}</span>`));
    assert.ok(m.html.includes(`You can ${r.line.replace("'", '&#39;')}.`), `${id} line in html`);
    assert.ok(m.text.includes(`As ${art(r.name)} ${r.name}, you can ${r.line}.`), `${id} line in text`);
    assert.ok(m.html.includes(`.chip-${id}{background:${r.chipDark[0]} !important;color:${r.chipDark[1]} !important}`), `${id} dark chip`);
    const a = accepted({ role: id });
    assert.ok(a.html.includes(`Can ${r.line.replace("'", '&#39;')}.`) && a.text.includes(`new ${r.name}:`), `${id} accepted`);
  }
  assert.deepEqual(Object.keys(ROLES).sort(), [...Weave.ROLES].sort(), 'the roles are the engine\'s');
  assert.throws(() => invite({ role: 'owner' }), /role 'owner'/);
});

test('a or an follows the first letter of the role name', () => {
  assert.equal(art('Editor'), 'an');
  assert.equal(art('Observer'), 'an');
  assert.equal(art('Member'), 'a');
  assert.equal(art('reviewer'), 'a');
});

test('every variable is escaped in the html', () => {
  const evil = '<script>alert(1)</script>';
  const m = invite({ workspace: evil, inviter: '"><img src=x onerror=alert(1)>', expires: '<b>soon</b>', link: `${ORIGIN}/x?a="><script>` });
  const a = accepted({ workspace: evil, member: "<i>o'neil</i>", joined: '<u>today</u>', members: 'https://x/"><script>' });
  for (const html of [m.html, a.html]) {
    assert.ok(!html.includes('<script'), 'no script tag survives');
    assert.ok(!/<img[^>]*onerror/.test(html), 'no injected img');
    assert.ok(!/<(b|i|u)>(soon|o|today)/.test(html), 'no injected markup');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped, still shown');
  }
  assert.ok(m.html.includes('>&lt;<'), 'the tile shows the escaped first letter');
});

test('text and html carry the same facts', () => {
  const m = invite({ inviter: 'ann', workspace: 'acme', role: 'observer', expires: 'November 2' });
  for (const fact of ['ann', 'acme', 'Observer', 'view and comment', 'November 2', LINK, 'weave.example.com', 'Clerk', 'Google account']) {
    assert.ok(m.text.includes(fact), `text: ${fact}`);
    assert.ok(m.html.includes(fact), `html: ${fact}`);
  }
  const a = accepted({ workspace: 'acme', member: 'bo', role: 'architect' });
  for (const fact of ['acme', 'bo', 'Architect', 'Members section', `${ORIGIN}/w/weave/#members`, 'weave.example.com']) {
    assert.ok(a.text.includes(fact), `text: ${fact}`);
    assert.ok(a.html.includes(fact), `html: ${fact}`);
  }
});

test('the html is mail-client safe: no SVG, no rope, no web font, a PNG mark on the origin', () => {
  for (const { html } of [invite(), accepted()]) {
    assert.ok(!/<svg/i.test(html), 'Gmail strips SVG');
    assert.ok(!/<path/i.test(html), 'no rope graphic, only the lockup image');
    assert.ok(!html.includes('fonts.googleapis'), 'no Google Fonts link');
    assert.match(html, /<img class="mark-light" style="[^"]*" src="https:\/\/weave\.example\.com\/brand\/email-lockup-light\.png" width="104" height="24" alt="weave">/);
    assert.match(html, /<!--\[if !mso\]><!--><img class="mark-dark" style="display:none[^"]*" src="https:\/\/weave\.example\.com\/brand\/email-lockup-dark\.png" width="104" height="24" alt="weave"><!--<!\[endif\]-->/);
    assert.equal(html.match(/<img /g).length, 2, 'the lockup is the only image');
  }
});

test('critical styles are inline, so the card, button and chips survive a client that drops <style>', () => {
  const { html } = invite();
  const bodyOnly = html.replace(/<style>[\s\S]*?<\/style>/, '');
  assert.match(bodyOnly, /class="card" style="background:#ffffff;border:1px solid #e2e7ef;border-radius:14px/);
  assert.match(bodyOnly, /class="btntd" style="border-radius:9px;background:#2563eb"/);
  assert.match(bodyOnly, /class="btna" style="display:inline-block;padding:14px 26px;font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none/);
  assert.match(bodyOnly, /class="chip chip-editor" style="display:inline-block;[^"]*background:#e6eeff;color:#1d4ed8"/);
  assert.match(bodyOnly, /class="tile" style="width:40px;height:40px;border-radius:10px;background:#2563eb;color:#ffffff/);
  assert.match(bodyOnly, /<body class="body" style="margin:0;padding:0;background:#f2f4f8/);
  for (const m of bodyOnly.matchAll(/style="([^"]*)"/g)) assert.ok(!m[1].includes('"'), 'no stray quote breaks an attribute');
});

test('production html carries color-scheme metas and a dark block; a theme paints one palette', () => {
  const { html } = invite();
  assert.ok(html.includes('<meta name="color-scheme" content="light dark">'));
  assert.ok(html.includes('<meta name="supported-color-schemes" content="light dark">'));
  const dark = html.match(/@media \(prefers-color-scheme: dark\)\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(dark, 'dark media query present');
  for (const rule of ['.body{background:#0b1220 !important}', '.card{background:#111a2b !important;border:1px solid #22304a !important}',
    '.tile{background:#3b82f6 !important}', '.btntd{background:#3b82f6 !important}', '.h1{', '.mark-light{display:none !important}', '.mark-dark{display:block !important}']) {
    assert.ok(dark.includes(rule), `dark: ${rule}`);
  }
  assert.ok(html.includes('@media (max-width:480px)'), 'phone layout');
  const forced = invite({ theme: 'dark' }).html;
  assert.match(forced, /<body class="body" style="margin:0;padding:0;background:#0b1220/);
  assert.match(forced, /background:#13264d;color:#93b8ff">Editor</);
  assert.ok(forced.includes('email-lockup-dark.png') && !forced.includes('email-lockup-light.png'));
  assert.ok(!forced.includes('prefers-color-scheme'), 'a forced theme needs no media query');
});

test('the lockup PNGs are served from public/brand at 2x of 104x24', () => {
  for (const t of ['light', 'dark']) {
    const png = readFileSync(join(ROOT, 'public', 'brand', `email-lockup-${t}.png`));
    assert.equal(png.toString('latin1', 1, 4), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [208, 48], `${t} is 208x48`);
  }
});

test('the templates import nothing, so they run under workerd too', () => {
  const src = readFileSync(join(ROOT, 'src', 'mail.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src));
  assert.equal(longDate('2026-10-10T17:00:00.000Z'), 'October 10');
});

/* ---------------------------------------------------------------- preview */
test('preview: Architect only, sample values, ?role and ?theme', async () => {
  const w = new Weave();
  w.updateWorkspace({ name: 'home' });
  const architect = w.createAccount({ name: 'kyle', role: 'architect' }).token;
  const editor = w.createAccount({ name: 'ed', role: 'editor' }).token;
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0, origin: 'https://weave.example.com' });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, token) => fetch(base + path, { headers: { Host: 'weave.example.com', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  try {
    assert.equal((await get('/api/mail/preview/invite')).status, 401);
    assert.equal((await get('/api/mail/preview/invite', editor)).status, 403);
    const res = await get('/api/mail/preview/invite', architect);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    const html = await res.text();
    assert.equal(html, inviteEmail({ inviter: 'kyle', workspace: 'weave', role: 'editor', expires: 'October 10', link: 'https://weave.example.com/api/auth/oidc/start?invite=Zq7tK4mW2xR9pLc8', origin: 'https://weave.example.com' }).html);
    assert.match(await (await get('/api/mail/preview/invite?role=observer', architect)).text(), />Observer</);
    assert.match(await (await get('/api/mail/preview/invite?theme=dark', architect)).text(), /background:#0b1220/);
    const acc = await (await get('/api/mail/preview/accepted?role=architect', architect)).text();
    assert.ok(acc.includes('>New Architect in weave<') && acc.includes('>dana<') && acc.includes('Joined October 3'));
    assert.equal((await get('/api/mail/preview/nope', architect)).status, 404);
    assert.equal((await get('/api/mail/preview/invite?role=owner', architect)).status, 400);
    // The mark the email points at is a public static, open at the wall.
    const png = await get('/brand/email-lockup-light.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
  } finally { server.close(); }
});
