import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inviteEmail, trialEmail, ROLES, art, longDate } from '../src/mail.js';
import { Weave } from '../src/engine.js';
import { LOCKUP_SIZES } from '../brand/build-logos.mjs';
import { withServer } from './lib/fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://weave.example.com';
const LINK = `${ORIGIN}/api/auth/oidc/start?invite=wvi_abc`;
const invite = (over = {}) => inviteEmail({ inviter: 'kyle', workspace: 'weave', role: 'editor', expires: 'October 10', link: LINK, origin: ORIGIN, ...over });
const BILLING = `${ORIGIN}/w/weave/billing`;
const trial = (over = {}) => trialEmail({ workspace: 'weave', stage: 'ending', daysLeft: 3, endsAt: '2026-10-10T00:00:00.000Z', billing: BILLING, origin: ORIGIN, ...over });

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

test('each role renders its own chip, colours and capability line, in html and text', () => {
  for (const [id, r] of Object.entries(ROLES)) {
    const m = invite({ role: id });
    assert.match(m.html, new RegExp(`class="chip chip-${id}" style="[^"]*background:${r.chip[0]};color:${r.chip[1]}">${r.name}</span>`));
    assert.ok(m.html.includes(`You can ${r.line.replace("'", '&#39;')}.`), `${id} line in html`);
    assert.ok(m.text.includes(`As ${art(r.name)} ${r.name}, you can ${r.line}.`), `${id} line in text`);
    assert.ok(m.html.includes(`.chip-${id}{background:${r.chipDark[0]} !important;color:${r.chipDark[1]} !important}`), `${id} dark chip`);
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
  for (const html of [m.html]) {
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
});

test('the html is mail-client safe: no SVG, no rope, no web font, a PNG mark on the origin', () => {
  for (const { html } of [invite(), trial(), trial({ stage: 'last' })]) {
    assert.ok(!/<svg/i.test(html), 'Gmail strips SVG');
    assert.ok(!/<path/i.test(html), 'no rope graphic, only the lockup image');
    assert.ok(!html.includes('fonts.googleapis'), 'no Google Fonts link');
    assert.match(html, /<img class="mark-light" style="[^"]*" src="https:\/\/weave\.example\.com\/brand\/email-lockup-light\.png" width="131" height="24" alt="weave">/);
    assert.match(html, /<!--\[if !mso\]><!--><img class="mark-dark" style="display:none[^"]*" src="https:\/\/weave\.example\.com\/brand\/email-lockup-dark\.png" width="131" height="24" alt="weave"><!--<!\[endif\]-->/);
    assert.equal(html.match(/<img /g).length, 2, 'the lockup is the only image');
  }
});

test('trial: the subject, the heading and the plain text name the workspace, the end date and the seat rule', () => {
  const m = trial();
  assert.equal(m.subject, 'Free trial of the weave workspace: 3 days left');
  assert.equal(trial({ stage: 'last', daysLeft: 1 }).subject, 'Free trial of the weave workspace: last day');
  assert.match(m.preheader, /^Buy a seat on the billing page to keep creating and editing in weave\./);
  assert.match(m.html, />Free trial</);
  assert.match(m.html, />Your free trial ends in 3 days</);
  assert.match(trial({ stage: 'last', daysLeft: 1 }).html, />Your free trial ends today</);
  assert.match(m.html, />Open Billing</);
  for (const fact of ['weave', 'October 10', BILLING, 'Editor', 'Architect', 'Observer', 'weave.example.com']) {
    assert.ok(m.text.includes(fact), `text: ${fact}`);
    assert.ok(m.html.includes(fact), `html: ${fact}`);
  }
  assert.ok(m.text.includes('runs until October 10'));
  assert.ok(trial({ stage: 'last', daysLeft: 1 }).text.includes('ends today, October 10'));
  assert.ok(!/[\u2014]/.test(m.text + m.html), 'no em dash in the copy');
});

test('trial: an unknown stage is refused, and the billing link and workspace are escaped', () => {
  assert.throws(() => trial({ stage: 'someday' }), /ending, last/);
  const m = trial({ workspace: 'a<b>&"', billing: `${ORIGIN}/w/a%3Cb/billing?x=1&y=2` });
  assert.ok(!/<b>/.test(m.html.replace(/<style>[\s\S]*?<\/style>/, '')), 'the workspace name is escaped');
  assert.ok(m.html.includes('x=1&amp;y=2'), 'the link is escaped');
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

test('the lockup PNGs are served from public/brand at 3x of the 131x24 the email draws', () => {
  const { email, emailScale } = LOCKUP_SIZES;
  assert.deepEqual([email.width, email.height, emailScale], [131, 24, 3]);
  for (const t of ['light', 'dark']) {
    const png = readFileSync(join(ROOT, 'public', 'brand', `email-lockup-${t}.png`));
    assert.equal(png.toString('latin1', 1, 4), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [393, 72], `${t} is 393x72`);
  }
});

test('longDate names the month and day', () => {
  assert.equal(longDate('2026-10-10T17:00:00.000Z'), 'October 10');
});

test('preview: Architect only, sample values, ?role and ?theme', async () => {
  const w = new Weave();
  w.updateWorkspace({ name: 'home' });
  const architect = w.createAccount({ name: 'kyle', role: 'architect' }).token;
  const editor = w.createAccount({ name: 'ed', role: 'editor' }).token;
  w.setRequireAuth(true);
  await withServer(w, { origin: 'https://weave.example.com' }, async ({ base }) => {
    const get = (path, token) => fetch(base + path, { headers: { Host: 'weave.example.com', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    assert.equal((await get('/api/mail/preview/invite')).status, 401);
    assert.equal((await get('/api/mail/preview/invite', editor)).status, 403);
    const res = await get('/api/mail/preview/invite', architect);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    const html = await res.text();
    assert.equal(html, inviteEmail({ inviter: 'kyle', workspace: 'weave', role: 'editor', expires: 'October 10', link: 'https://weave.example.com/api/auth/oidc/start?invite=Zq7tK4mW2xR9pLc8', origin: 'https://weave.example.com' }).html);
    assert.match(await (await get('/api/mail/preview/invite?role=observer', architect)).text(), />Observer</);
    assert.match(await (await get('/api/mail/preview/invite?theme=dark', architect)).text(), /background:#0b1220/);
    assert.equal((await get('/api/mail/preview/accepted', architect)).status, 404, 'the unsent invite-accepted email has no preview (Issue #656)');
    const tr = await (await get('/api/mail/preview/trial', architect)).text();
    assert.ok(tr.includes('>Your free trial ends in 3 days<') && tr.includes('https://weave.example.com/w/weave/billing'));
    assert.ok((await (await get('/api/mail/preview/trial-last', architect)).text()).includes('>Your free trial ends today<'));
    assert.equal((await get('/api/mail/preview/nope', architect)).status, 404);
    assert.equal((await get('/api/mail/preview/invite?role=owner', architect)).status, 400);
    const png = await get('/brand/email-lockup-light.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
  });
});
