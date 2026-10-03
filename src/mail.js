/* The two emails weave sends (Feature #216): the invite a new person gets,
   and the notice the inviter gets once it is accepted. Kyle approved the
   design on 2026-10-03 (design review "Weave invite emails"); the copy, the
   layout, the colours and the sizes are that review's, word for word.

   Pure functions with no imports, so they run under node and workerd like
   src/auth-page.js. Each returns { subject, preheader, html, text }.

   One html document per email. The light palette sits inline on every
   element that carries colour or shape, because Gmail drops some <style>
   rules; the <style> block keeps the phone layout and the dark palette,
   under @media (prefers-color-scheme: dark), for the clients that honour it
   (Apple Mail, iOS). The mark is a PNG weave serves itself, because Gmail
   strips SVG: brand/render-png.mjs draws it from brand/build-logos.mjs.
   `theme: 'light' | 'dark'` paints one palette inline with no media query,
   which is what the preview route shows when asked for a theme. */

/* Capability lines are the engine's roles (Feature #255): observer, editor,
   architect. Chip colours are [background, text]. */
export const ROLES = {
  observer: { name: 'Observer', line: 'view and comment', chip: ['#eef1f5', '#3d4757'], chipDark: ['#1c2638', '#c5cedb'] },
  editor: { name: 'Editor', line: 'view, create and edit entries', chip: ['#e6eeff', '#1d4ed8'], chipDark: ['#13264d', '#93b8ff'] },
  architect: { name: 'Architect', line: "do everything, including creating, editing and deleting the workspace's spaces, tables and field definitions", chip: ['#0c1b33', '#e0dcd4'], chipDark: ['#e0dcd4', '#0c1b33'] },
};

const C = {
  light: { canvas: '#f2f4f8', card: '#ffffff', line: '#e2e7ef', ink: '#0c1b33', body: '#2b3647', muted: '#5b6678', panel: '#f6f8fc', btn: '#2563eb', btnFg: '#ffffff', link: '#2563eb', tile: '#2563eb', tileFg: '#ffffff', eyebrow: '#2563eb' },
  dark: { canvas: '#0b1220', card: '#111a2b', line: '#22304a', ink: '#eef2f8', body: '#c9d2df', muted: '#94a0b4', panel: '#0f1828', btn: '#3b82f6', btnFg: '#ffffff', link: '#7fb0ff', tile: '#3b82f6', tileFg: '#ffffff', eyebrow: '#7fb0ff' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const art = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const first = (s) => ([...String(s ?? '')][0] ?? '').toUpperCase();
const roleOf = (role) => {
  const r = ROLES[role];
  if (!r) throw new Error(`No email copy for role '${role}' (${Object.keys(ROLES).join(', ')})`);
  return r;
};
/* "October 10", the way the review writes a date. UTC, so the day does not
   move with the server's zone. */
export const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/* Every class, as the review's stylesheet wrote it. Each one is inlined on
   the element that carries it; the dark block is the declarations that
   change between the palettes, so one table drives both. */
const STYLE = (c) => ({
  body: `margin:0;padding:0;background:${c.canvas};-webkit-text-size-adjust:100%`,
  wrap: `width:100%;background:${c.canvas};border-collapse:collapse`,
  col: 'width:100%;max-width:600px;border-collapse:collapse',
  pad: 'padding:0 24px',
  card: `background:${c.card};border:1px solid ${c.line};border-radius:14px;overflow:hidden;border-collapse:collapse`,
  inner: `padding:32px 36px 30px;${FONT}`,
  eyebrow: `font-size:12px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:${c.eyebrow}`,
  h1: `margin:8px 0 0;font-size:26px;line-height:32px;font-weight:650;letter-spacing:-.015em;color:${c.ink}`,
  lead: `margin:14px 0 0;font-size:15px;line-height:24px;color:${c.body}`,
  ink: `color:${c.ink}`,
  panel: `margin-top:24px;background:${c.panel};border:1px solid ${c.line};border-radius:10px;border-collapse:collapse`,
  cell0: 'padding:14px 16px;vertical-align:top',
  cell: `padding:14px 16px;border-top:1px solid ${c.line};vertical-align:top`,
  lbl: `font-size:12px;line-height:18px;color:${c.muted};width:92px;white-space:nowrap`,
  val: `font-size:14px;line-height:21px;color:${c.body}`,
  tile: `width:40px;height:40px;border-radius:10px;background:${c.tile};color:${c.tileFg};font-size:18px;font-weight:650;text-align:center;line-height:40px`,
  wsname: `font-size:16px;line-height:20px;font-weight:650;color:${c.ink}`,
  wshost: `font-size:13px;line-height:18px;color:${c.muted}`,
  chip: 'display:inline-block;font-size:12px;line-height:18px;font-weight:600;padding:2px 9px;border-radius:999px',
  can: 'display:block;margin-top:6px',
  btnwrap: 'margin-top:26px',
  btn: 'border-collapse:collapse',
  btntd: `border-radius:9px;background:${c.btn}`,
  btna: `display:inline-block;padding:14px 26px;font-size:15px;line-height:20px;font-weight:600;color:${c.btnFg};text-decoration:none;border-radius:9px`,
  meta: `margin:12px 0 0;font-size:13px;line-height:20px;color:${c.muted}`,
  small: `margin:22px 0 0;font-size:13px;line-height:20px;color:${c.muted}`,
  fallback: `margin:14px 0 0;font-size:12px;line-height:18px;color:${c.muted}`,
  flink: `color:${c.link};word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px`,
  foot: `padding:22px 36px 0;font-size:12px;line-height:19px;color:${c.muted};${FONT}`,
  pre: 'display:none;max-height:0;overflow:hidden;opacity:0;color:transparent',
});

const decls = (s) => s.split(';').filter(Boolean);
const darkRules = () => {
  const L = STYLE(C.light), D = STYLE(C.dark);
  const rules = Object.keys(D).map((k) => {
    const changed = decls(D[k]).filter((d) => !decls(L[k]).includes(d));
    return changed.length ? `.${k}{${changed.map((d) => d + ' !important').join(';')}}` : '';
  });
  const chips = Object.entries(ROLES).map(([id, r]) => `.chip-${id}{background:${r.chipDark[0]} !important;color:${r.chipDark[1]} !important}`);
  return [...rules, ...chips, `.foot a{color:${C.dark.muted} !important}`, '.mark-light{display:none !important}', '.mark-dark{display:block !important}'].join('');
};

function shell(theme, { origin, preheader, body, footer }) {
  const c = C[theme ?? 'light'];
  const S = STYLE(c);
  const at = (cls, extra = '') => ` class="${cls}" style="${[...cls.split(' ').map((k) => S[k]), extra].filter(Boolean).join(';')}"`;
  const mark = (t) => `${esc(origin)}/brand/email-lockup-${t}.png`;
  const img = (t, hidden) => `<img${at(`mark-${t}`, `display:${hidden ? 'none' : 'block'};border:0;outline:none`)} src="${mark(t)}" width="104" height="24" alt="weave">`;
  /* Production shows the light mark and swaps in the dark one where the
     client honours the media query; Outlook's renderer ignores display:none
     on an image, so the dark one is hidden from it outright. */
  const lockup = theme ? img(theme, false) : `${img('light', false)}<!--[if !mso]><!-->${img('dark', true)}<!--<![endif]-->`;
  const dark = theme ? '' : `\n@media (prefers-color-scheme: dark){\n${darkRules()}\n}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
table{border-collapse:collapse}
.foot a{color:${c.muted}}
@media (max-width:480px){
.pad{padding:0 12px !important}
.inner{padding:26px 22px 24px !important}
.h1{font-size:23px !important;line-height:29px !important}
.foot{padding:20px 22px 0 !important}
.lbl{display:block !important;width:auto !important;padding-bottom:0 !important}
.lbl+.val{padding-top:4px !important;border-top:0 !important}
.stack{display:block !important;width:100% !important;box-sizing:border-box}
}${dark}
</style></head><body${at('body')}>
<div${at('pre')}>${esc(preheader)}</div>
<table role="presentation"${at('wrap')} width="100%"><tr><td align="center" style="padding:32px 0 40px">
<table role="presentation"${at('col')} width="100%"><tr><td${at('pad')}>
<table role="presentation" width="100%"><tr><td style="padding:0 4px 18px">${lockup}</td></tr></table>
<table role="presentation" width="100%"${at('card')}><tr><td${at('inner')}>${body(at)}</td></tr></table>
<div${at('foot')}>${footer}</div>
</td></tr></table>
</td></tr></table></body></html>`;
}

const chip = (at, role, theme) => {
  const r = ROLES[role], [bg, fg] = theme === 'dark' ? r.chipDark : r.chip;
  return `<span${at(`chip chip-${role}`, `background:${bg};color:${fg}`)}>${esc(r.name)}</span>`;
};

/* The card's head row: a tile with a letter, a name, a line under it. The
   name cell keeps the row padding, as the review's `.prow td` gave it. */
const head = (at, letter, name, under, round = false) => `<tr class="prow"><td colspan="2"${at('cell0')}><table role="presentation"><tr>
  <td style="padding:0 12px 0 0;vertical-align:middle"><div${at('tile', round ? 'border-radius:999px' : '')}>${esc(letter)}</div></td>
  <td${at('cell0', 'vertical-align:middle')}><div${at('wsname')}>${esc(name)}</div><div${at('wshost')}>${esc(under)}</div></td>
</tr></table></td></tr>`;
const row = (at, label, value) => `<tr class="prow"><td${at('cell lbl stack')}>${label}</td><td${at('cell val stack')}>${value}</td></tr>`;
const button = (at, href, label) => `<div${at('btnwrap')}><table role="presentation"${at('btn')}><tr><td${at('btntd')}><a${at('btna')} href="${esc(href)}" target="_blank">${label}</a></td></tr></table></div>`;

/* vars: { inviter, workspace, role, expires ("October 10"), link (the
   one-time sign-in URL), origin (where weave serves the mark), host
   (defaults to origin's), theme } */
export function inviteEmail({ inviter, workspace, role, expires, link, origin, host = new URL(origin).host, theme } = {}) {
  const r = roleOf(role);
  const subject = `Invite from ${inviter} to the ${workspace} workspace`;
  const preheader = `You're invited as ${art(r.name)} ${r.name}. The invite works once and expires on ${expires}.`;
  const body = (at) => `
<div${at('eyebrow')}>Workspace invite</div>
<h1${at('h1')}>Join the ${esc(workspace)} workspace</h1>
<p${at('lead')}>You have an invite from <b${at('ink')}>${esc(inviter)}</b> to join the ${esc(workspace)} workspace on weave.</p>
<table role="presentation" width="100%"${at('panel')}>
${head(at, first(workspace), workspace, host)}
${row(at, 'Your role', `${chip(at, role, theme)}<span${at('can')}>You can ${esc(r.line)}.</span>`)}
${row(at, 'Invited by', esc(inviter))}
</table>
${button(at, link, 'Accept invite')}
<p${at('meta')}>Works once. Expires ${esc(expires)}.</p>
<p${at('small')}>The button opens Clerk, weave's sign-in service, where you can use your Google account. Your first sign-in creates your weave account and opens the workspace.</p>
<p${at('fallback')}>If the button does nothing, paste this link into your browser:<br><a${at('flink')} href="${esc(link)}">${esc(link)}</a></p>
<p${at('small', 'margin-top:14px')}>Replies to this email don't reach anyone, so ask ${esc(inviter)} if you have questions or need a new invite.</p>`;
  const footer = `You got this email because ${esc(inviter)} entered your address to invite you to a workspace on ${esc(host)}. If you weren't expecting it, you can ignore it and the invite will expire unused. weave keeps your address only on the pending invite and deletes it once the invite is used, revoked or expired.`;
  const text = `You have an invite from ${inviter} to join the ${workspace} workspace on weave. As ${art(r.name)} ${r.name}, you can ${r.line}.

Accept the invite here:
${link}

The link opens Clerk, weave's sign-in service, where you can use your Google account. Your first sign-in creates your weave account and opens the workspace.

The invite works once and expires on ${expires}. Replies to this email don't reach anyone, so ask ${inviter} if you have questions or need a new invite.

You got this email because ${inviter} entered your address to invite you to a workspace on ${host}. If you weren't expecting it, you can ignore it and the invite will expire unused. weave keeps your address only on the pending invite and deletes it once the invite is used, revoked or expired.
`;
  return { subject, preheader, html: shell(theme, { origin, preheader, body, footer }), text };
}

/* vars: { workspace, role, member, joined ("October 3"), members (the
   Members link), origin, host, theme }.
   Not sent yet: weave keeps no account email (Feature #252), so it has no
   address for the inviter. Open decision for Kyle: drop this notice, keep
   the inviter's address on the invite until it is used, or show it in-app. */
export function inviteAcceptedEmail({ workspace, role, member, joined, members, origin, host = new URL(origin).host, theme } = {}) {
  const r = roleOf(role);
  const subject = `New ${r.name} in the ${workspace} workspace: ${member}`;
  const preheader = `Change ${member}'s role or remove them in the ${workspace} workspace's Members section.`;
  const body = (at) => `
<div${at('eyebrow')}>Invite accepted</div>
<h1${at('h1')}>New ${esc(r.name)} in ${esc(workspace)}</h1>
<p${at('lead')}>The ${esc(workspace)} workspace has a new ${esc(r.name)}: <b${at('ink')}>${esc(member)}</b> accepted your invite.</p>
<table role="presentation" width="100%"${at('panel')}>
${head(at, first(member), member, `Joined ${joined}`, true)}
${row(at, 'Role', `${chip(at, role, theme)}<span${at('can')}>Can ${esc(r.line)}.</span>`)}
${row(at, 'Workspace', `${esc(workspace)} · ${esc(host)}`)}
</table>
${button(at, members, 'Open Members')}
<p${at('small')}>To change ${esc(member)}'s role or remove them, open the Members section on the ${esc(workspace)} home page.</p>`;
  const footer = `You got this email because you sent an invite from the ${esc(workspace)} workspace on ${esc(host)}. weave deleted the address you entered for this invite when ${esc(member)} accepted it.`;
  const text = `The ${workspace} workspace has a new ${r.name}: ${member} accepted your invite.

To change ${member}'s role or remove them, open the Members section on the ${workspace} home page:
${members}

You got this email because you sent an invite from the ${workspace} workspace on ${host}. weave deleted the address you entered for this invite when ${member} accepted it.
`;
  return { subject, preheader, html: shell(theme, { origin, preheader, body, footer }), text };
}
