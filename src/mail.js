export const ROLES = {
  observer: { name: 'Observer', line: 'view and comment', chip: ['#eef1f5', '#3d4757'], chipDark: ['#1c2638', '#c5cedb'] },
  editor: { name: 'Editor', line: 'view, create and edit entries', chip: ['#e6eeff', '#1d4ed8'], chipDark: ['#13264d', '#93b8ff'] },
  architect: { name: 'Architect', line: "do everything, including creating, editing and deleting the workspace's spaces, tables and field definitions", chip: ['#0c1b33', '#e0dcd4'], chipDark: ['#e0dcd4', '#0c1b33'] },
};

const C = {
  light: { canvas: '#f2f4f8', card: '#ffffff', line: '#e2e7ef', ink: '#0c1b33', body: '#2b3647', muted: '#5b6678', panel: '#f6f8fc', btn: '#2563eb', btnFg: '#ffffff', link: '#2563eb', tile: '#2563eb', tileFg: '#ffffff', eyebrow: '#2563eb' },
  dark: { canvas: '#0b1220', card: '#111a2b', line: '#22304a', ink: '#eef2f8', body: '#c9d2df', muted: '#94a0b4', panel: '#0f1828', btn: '#3b82f6', btnFg: '#ffffff', link: '#7fb0ff', tile: '#3b82f6', tileFg: '#ffffff', eyebrow: '#7fb0ff' },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const art = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const first = (s) => ([...String(s ?? '')][0] ?? '').toUpperCase();
const roleOf = (role) => {
  const r = ROLES[role];
  if (!r) throw new Error(`No email copy for role '${role}' (${Object.keys(ROLES).join(', ')})`);
  return r;
};
export const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
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
  code: `margin-top:24px;padding:18px 16px;background:${c.panel};border:1px solid ${c.line};border-radius:10px;text-align:center;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:30px;line-height:36px;font-weight:650;letter-spacing:.24em;color:${c.ink}`,
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

const head = (at, letter, name, under, round = false) => `<tr class="prow"><td colspan="2"${at('cell0')}><table role="presentation"><tr>
  <td style="padding:0 12px 0 0;vertical-align:middle"><div${at('tile', round ? 'border-radius:999px' : '')}>${esc(letter)}</div></td>
  <td${at('cell0', 'vertical-align:middle')}><div${at('wsname')}>${esc(name)}</div><div${at('wshost')}>${esc(under)}</div></td>
</tr></table></td></tr>`;
const row = (at, label, value) => `<tr class="prow"><td${at('cell lbl stack')}>${label}</td><td${at('cell val stack')}>${value}</td></tr>`;
const button = (at, href, label) => `<div${at('btnwrap')}><table role="presentation"${at('btn')}><tr><td${at('btntd')}><a${at('btna')} href="${esc(href)}" target="_blank">${label}</a></td></tr></table></div>`;

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

const when = (v, s) => (v ? `{{#if ${v}}}${s}{{/if}}` : s);

export function clerkEmail(slug, { origin } = {}) {
  const e = CLERK_EMAILS[slug];
  if (!e) throw new Error(`No weave copy for Clerk template '${slug}' (${Object.keys(CLERK_EMAILS).join(', ')})`);
  const body = (at) => `
<div${at('eyebrow')}>${esc(e.eyebrow)}</div>
<h1${at('h1')}>${esc(e.h1)}</h1>
<p${at('lead')}>${esc(e.lead)}</p>
${e.code ? `<div${at('code')}>${e.code}</div>` : ''}
${e.rows.length ? `<table role="presentation" width="100%"${at('panel')}>
${e.rows.map((r) => when(r.optional, row(at, esc(r.label), esc(r.value)))).join('\n')}
</table>` : ''}
${e.button ? when(e.button.optional, button(at, e.button.href, esc(e.button.label))) : ''}
${e.notes.map((n) => `<p${at('small')}>${esc(n)}</p>`).join('\n')}`;
  return { subject: e.subject, preheader: e.preheader, html: shell(undefined, { origin, preheader: e.preheader, body, footer: esc(e.footer) }) };
}

export const clerkPayload = (slug, opts) => {
  const m = clerkEmail(slug, opts);
  return { name: CLERK_EMAILS[slug].name, subject: m.subject, body: m.html, markup: '', delivered_by_clerk: true, from_email_name: 'noreply' };
};

export const CLERK_REQUIRED = {
  new_device_sign_in: [],
  account_locked: [],
  mfa_enabled: ['primary_email_address'],
  passkey_added: ['primary_email_address'],
  passkey_removed: ['primary_email_address'],
  password_changed: ['primary_email_address'],
  password_removed: ['primary_email_address'],
  primary_email_address_changed: ['new_email_address'],
  reset_password_code: ['otp_code'],
  verification_code: ['otp_code'],
  magic_link_sign_in: ['magic_link'],
  magic_link_sign_up: ['magic_link'],
  magic_link_user_profile: ['magic_link'],
};

export const CLERK_EMAILS = {
  new_device_sign_in: {
    name: "Sign in from new device",
    subject: "New sign-in to your weave account",
    preheader: "If you don't recognize this sign-in, sign that device out from this email.",
    eyebrow: "Account security",
    "h1": "New device sign-in",
    lead: "Someone signed in to your weave account from a new device. If you recognize the details below, you don't need to do anything.",
    code: null,
    rows: [
      {
        label: "Device",
        value: "{{device_type}}",
        optional: "device_type"
      },
      {
        label: "Browser",
        value: "{{browser_name}}",
        optional: "browser_name"
      },
      {
        label: "Operating system",
        value: "{{operating_system}}",
        optional: "operating_system"
      },
      {
        label: "Location",
        value: "{{location}}",
        optional: "location"
      },
      {
        label: "IP address",
        value: "{{ip_address}}",
        optional: "ip_address"
      },
      {
        label: "Signed in",
        value: "{{session_created_at}}",
        optional: "session_created_at"
      },
      {
        label: "Signed in with",
        value: "{{sign_in_method}}",
        optional: "sign_in_method"
      }
    ],
    button: {
      label: "Sign out this device",
      href: "{{revoke_session_url}}",
      optional: "revoke_session_url"
    },
    notes: [
      "If you don't recognize this sign-in, use the button to sign that device out, then sign in at weave.grunion.ai and check your account.",
      "Replies to this email don't reach anyone.{{#if support_email}} For help, write to {{support_email}}.{{/if}}"
    ],
    footer: "You got this email because someone signed in from a new device to the weave account that uses this address."
  },
  account_locked: {
    name: "Account Locked",
    subject: "Account locked after failed weave sign-ins",
    preheader: "If you didn't try to sign in, change your password once the account unlocks.",
    eyebrow: "Account security",
    "h1": "Account locked",
    lead: "weave locked your account after too many failed sign-in attempts. You can sign in again once it unlocks.",
    code: null,
    rows: [
      {
        label: "Failed attempts",
        value: "{{failed_attempts}}",
        optional: "failed_attempts"
      },
      {
        label: "Locked",
        value: "{{locked_date}}",
        optional: "locked_date"
      },
      {
        label: "Locked for",
        value: "{{lockout_duration}}",
        optional: "lockout_duration"
      },
      {
        label: "Unlocks",
        value: "{{unlock_time}}",
        optional: "unlock_time"
      }
    ],
    button: null,
    notes: [
      "If you didn't try to sign in, someone may be guessing your password. Once the account unlocks, sign in at weave.grunion.ai and change it.",
      "Replies to this email don't reach anyone."
    ],
    footer: "You got this email because of repeated failed sign-in attempts on the weave account that uses this address."
  },
  mfa_enabled: {
    name: "MFA Enabled",
    subject: "Two-step verification turned on for weave",
    preheader: "If you didn't turn this on, someone else may be signed in to your account.",
    eyebrow: "Account security",
    "h1": "Two-step verification turned on",
    lead: "Two-step verification is now on for your weave account. Each time you sign in, weave asks for a verification code as a second step.",
    code: null,
    rows: [
      {
        label: "Account",
        value: "{{primary_email_address}}",
        optional: null
      },
      {
        label: "Turned on",
        value: "{{requested_at}}",
        optional: "requested_at"
      },
      {
        label: "Turned on by",
        value: "{{requested_by}}",
        optional: "requested_by"
      },
      {
        label: "From",
        value: "{{requested_from}}",
        optional: "requested_from"
      }
    ],
    button: null,
    notes: [
      "If you didn't turn this on, sign in at weave.grunion.ai and check your account's sign-in methods.",
      "Replies to this email don't reach anyone."
    ],
    footer: "You got this email because someone turned on two-step verification for the weave account that uses this address."
  },
  passkey_added: {
    name: "Passkey added",
    subject: "Passkey added to your weave account",
    preheader: "If you didn't add this passkey, sign in at weave.grunion.ai and remove it now.",
    eyebrow: "Account security",
    "h1": "Passkey added",
    lead: "Your weave account has a new passkey. Anyone with that passkey can sign in without a password or code.",
    code: null,
    rows: [
      {
        label: "Passkey",
        value: "{{passkey_name}}",
        optional: "passkey_name"
      },
      {
        label: "Account",
        value: "{{primary_email_address}}",
        optional: null
      }
    ],
    button: null,
    notes: [
      "If you didn't add this passkey, sign in at weave.grunion.ai, remove it and change your password.",
      "Replies to this email don't reach anyone."
    ],
    footer: "You got this email because someone added a passkey to the weave account that uses this address."
  },
  passkey_removed: {
    name: "Passkey removed",
    subject: "Passkey removed from your weave account",
    preheader: "If you didn't remove this passkey, sign in at weave.grunion.ai and check your account.",
    eyebrow: "Account security",
    "h1": "Passkey removed",
    lead: "Someone removed a passkey from your weave account. No one can sign in with it now.",
    code: null,
    rows: [
      {
        label: "Passkey",
        value: "{{passkey_name}}",
        optional: "passkey_name"
      },
      {
        label: "Account",
        value: "{{primary_email_address}}",
        optional: null
      }
    ],
    button: null,
    notes: [
      "If you didn't remove this passkey, sign in at weave.grunion.ai and check your account's sign-in methods.",
      "Replies to this email don't reach anyone."
    ],
    footer: "You got this email because someone removed a passkey from the weave account that uses this address."
  },
  password_changed: {
    name: "Password changed",
    subject: "Password changed on your weave account",
    preheader: "If you didn't change your password, reset it at weave.grunion.ai now.",
    eyebrow: "Account security",
    "h1": "Password changed",
    lead: "Your weave account has a new password.",
    code: null,
    rows: [
      {
        label: "Account",
        value: "{{primary_email_address}}",
        optional: null
      }
    ],
    button: null,
    notes: [
      "If you didn't change your password, reset it at weave.grunion.ai right away.",
      "Replies to this email don't reach anyone."
    ],
    footer: "You got this email because someone changed the password on the weave account that uses this address."
  },
  password_removed: {
    name: "Password removed",
    subject: "Password removed from your weave account",
    preheader: "If you didn't remove your password, set a new one at weave.grunion.ai.",
    eyebrow: "Account security",
    "h1": "Password removed",
    lead: "Your weave account no longer has a password. You now sign in with the methods left on the account, such as a passkey or an emailed code.",
    code: null,
    rows: [
      {
        label: "Account",
        value: "{{primary_email_address}}",
        optional: null
      }
    ],
    button: null,
    notes: [
      "If you didn't remove your password, sign in at weave.grunion.ai and set a new one.",
      "Replies to this email don't reach anyone."
    ],
    footer: "You got this email because someone removed the password from the weave account that uses this address."
  },
  primary_email_address_changed: {
    name: "Primary email address changed",
    subject: "Email address changed on your weave account",
    preheader: "weave now sends account email to {{new_email_address}}.",
    eyebrow: "Account security",
    "h1": "Email address changed",
    lead: "Your weave account has a new email address. From now on, account email from weave goes to {{new_email_address}} instead of this address.",
    code: null,
    rows: [
      {
        label: "New address",
        value: "{{new_email_address}}",
        optional: null
      }
    ],
    button: null,
    notes: [
      "If you didn't make this change, sign in at weave.grunion.ai, change the email address back and change your password.",
      "Replies to this email don't reach anyone."
    ],
    footer: "You got this email because this was the email address on your weave account before the change."
  },
  reset_password_code: {
    name: "Reset password code",
    subject: "{{otp_code}}: weave password reset code",
    preheader: "Enter the code in weave to choose a new password, or ignore this email if you didn't ask to reset it.",
    eyebrow: "Account access",
    "h1": "Password reset code",
    lead: "Enter this code in weave to choose a new password.",
    code: "{{otp_code}}",
    rows: [
      {
        label: "Account",
        value: "{{user.email_address}}",
        optional: "user.email_address"
      },
      {
        label: "Requested",
        value: "{{requested_at}}",
        optional: "requested_at"
      },
      {
        label: "From",
        value: "{{requested_from}}",
        optional: "requested_from"
      }
    ],
    button: null,
    notes: [
      "The code works once. Don't share it with anyone.",
      "If you didn't ask to reset your password, you can ignore this email and your password stays the same."
    ],
    footer: "You got this email because someone asked to reset the password on the weave account that uses this address."
  },
  verification_code: {
    name: "Verification code",
    subject: "{{otp_code}}: weave verification code",
    preheader: "Enter the code in weave to continue. If you didn't ask for it, ignore this email.",
    eyebrow: "Account access",
    "h1": "Verification code",
    lead: "Enter this code in weave to confirm your email address or finish signing in.",
    code: "{{otp_code}}",
    rows: [
      {
        label: "Account",
        value: "{{user.email_address}}",
        optional: "user.email_address"
      },
      {
        label: "Requested",
        value: "{{requested_at}}",
        optional: "requested_at"
      },
      {
        label: "From",
        value: "{{requested_from}}",
        optional: "requested_from"
      }
    ],
    button: null,
    notes: [
      "The code works once. Don't share it with anyone.",
      "If you didn't ask for a code, you can ignore this email."
    ],
    footer: "You got this email because someone entered this address on weave.grunion.ai and asked for a code."
  },
  magic_link_sign_in: {
    name: "Email link - Sign in",
    subject: "Sign-in link for weave",
    preheader: "Sign in to weave without a password.",
    eyebrow: "Account access",
    "h1": "Sign-in link",
    lead: "Open the link below to sign in to your weave account.",
    code: null,
    rows: [
      {
        label: "Account",
        value: "{{user.email_address}}",
        optional: "user.email_address"
      },
      {
        label: "Link expires",
        value: "In {{ttl_minutes}} minutes",
        optional: "ttl_minutes"
      },
      {
        label: "Requested",
        value: "{{requested_at}}",
        optional: "requested_at"
      },
      {
        label: "From",
        value: "{{requested_from}}",
        optional: "requested_from"
      }
    ],
    button: {
      label: "Sign in to weave",
      href: "{{magic_link}}",
      optional: null
    },
    notes: [
      "If you didn't ask to sign in, you can ignore this email."
    ],
    footer: "You got this email because someone entered this address on the weave sign-in page."
  },
  magic_link_sign_up: {
    name: "Email link - Sign up",
    subject: "Sign-up link for weave",
    preheader: "You can finish creating your weave account from this email.",
    eyebrow: "New account",
    "h1": "Sign-up link",
    lead: "Open the link below to finish creating your weave account.",
    code: null,
    rows: [
      {
        label: "Email",
        value: "{{user.email_address}}",
        optional: "user.email_address"
      },
      {
        label: "Link expires",
        value: "In {{ttl_minutes}} minutes",
        optional: "ttl_minutes"
      },
      {
        label: "Requested",
        value: "{{requested_at}}",
        optional: "requested_at"
      },
      {
        label: "From",
        value: "{{requested_from}}",
        optional: "requested_from"
      }
    ],
    button: {
      label: "Finish sign-up",
      href: "{{magic_link}}",
      optional: null
    },
    notes: [
      "If you didn't start creating a weave account, you can ignore this email."
    ],
    footer: "You got this email because someone entered this address to create a weave account."
  },
  magic_link_user_profile: {
    name: "Email link - Verify email",
    subject: "Email confirmation link for weave",
    preheader: "You can confirm the address you added to weave from this email.",
    eyebrow: "Account email",
    "h1": "Email confirmation link",
    lead: "Open the link below to confirm this address on your weave account.",
    code: null,
    rows: [
      {
        label: "Account",
        value: "{{user.email_address}}",
        optional: "user.email_address"
      },
      {
        label: "Link expires",
        value: "In {{ttl_minutes}} minutes",
        optional: "ttl_minutes"
      },
      {
        label: "Requested",
        value: "{{requested_at}}",
        optional: "requested_at"
      },
      {
        label: "From",
        value: "{{requested_from}}",
        optional: "requested_from"
      }
    ],
    button: {
      label: "Confirm email address",
      href: "{{magic_link}}",
      optional: null
    },
    notes: [
      "If you didn't add this address to a weave account, you can ignore this email and the address stays unconfirmed."
    ],
    footer: "You got this email because someone added this address to a weave account."
  }
};
