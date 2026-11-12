'use strict';
function seatNote(billing) {
  if (!billing || billing.plan === 'comped') return null;
  const lead = billing.plan === 'trial' ? `The free trial runs until ${new Date(billing.trial.endsAt).toLocaleDateString()}: everyone can create and edit. After it, Editors and Architects need a plan.`
    : billing.plan === 'paid' ? `Inviting an Editor or Architect adds ${billing.seatPrice ? `a ${billing.seatPrice} seat` : 'a paid seat'}.`
    : 'No seats are bought yet, so Editors and Architects work as Observers.';
  return el('div', { class: 'wv-invite-note wv-seat-note' }, `${lead} Observers stay free. `, el('a', { href: `${WS_PREFIX}/billing` }, 'Billing'));
}
async function inviteDialog() {
  const [acc, inv, bill] = await Promise.allSettled([api('GET', '/accounts'), api('GET', '/invites'), api('GET', '/billing')]);
  if (acc.status !== 'fulfilled' || inv.status !== 'fulfilled') return toast((acc.reason ?? inv.reason).message, true);
  const billing = bill.status === 'fulfilled' ? bill.value : null;
  const day = (iso) => String(iso ?? '').slice(0, 10);
  const email = el('input', { class: 'form-control', type: 'email', placeholder: 'name@company.com', 'aria-label': 'Email to invite' });
  const role = pickerSelect({ name: 'invite-role', title: 'Role', value: 'editor',
    options: Object.entries(ROLE_LABELS).map(([id, label]) => ({ id, label })) });
  const body = el('div', { class: 'wv-members' });
  const send = async () => {
    if (!email.checkValidity() || !email.value.trim()) { email.reportValidity(); return; }
    try {
      const made = await api('POST', '/invites', { email: email.value.trim(), role: role.input.value });
      if (made.mailError) toast(`The invite email was not sent: ${made.mailError}`, true);
      const [a2, i2] = await Promise.all([api('GET', '/accounts'), api('GET', '/invites')]);
      email.value = '';
      draw(a2, i2, made);
    } catch (err) { toast(err.message, true); }
  };
  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  const form = el('div', { class: 'wv-invite-form' }, email, role,
    el('button', { class: 'btn btn-primary wv-invite-send', type: 'button', onclick: send }, 'Invite'));
  const draw = (accounts, invites, link = null) => {
    const shown = link?.mailed ? el('div', { class: 'wv-invite-link card' },
      el('div', { class: 'wv-invite-link-head' }, `Emailed ${link.email}`),
      el('div', { class: 'wv-invite-note' }, 'weave emailed the sign-in link. It works once and expires in 7 days.'))
    : link ? el('div', { class: 'wv-invite-link card' },
      el('div', { class: 'wv-invite-link-head' }, `Sign-in link for ${link.email}`),
      el('div', { class: 'wv-invite-link-row' },
        el('input', { class: 'form-control form-control-sm', readonly: '', value: link.url, 'aria-label': 'Sign-in link', onfocus: (e) => e.target.select() }),
        el('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(link.url, 'Link copied') }, 'Copy link')),
      el('div', { class: 'wv-invite-note' }, link.mailError
        ? 'Send this link yourself: the email did not go out. It works once and expires in 7 days.'
        : 'Send this link yourself: weave does not send email yet. It works once and expires in 7 days.')) : null;
    body.replaceChildren(...[
      form, seatNote(billing), shown,
      el('div', { class: 'wv-members-sub' }, 'Members'),
      accounts.length ? el('div', { class: 'card list-rows' },
        ...accounts.map((a) => el('div', { class: 'list-row' },
          el('span', {}, a.name),
          ...[...new Set((a.identities ?? []).map((i) => i.verifiedEmail).filter(Boolean))].map((mail) => el('span', { class: 'pid wv-member-email' }, mail)),
          el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, ROLE_LABELS[a.role] ?? a.role)))) : null,
      accounts.length > 1 ? null : el('div', { class: 'wv-members-empty' }, 'No one else has joined yet.'),
      el('div', { class: 'wv-members-sub' }, 'Pending invites'),
      invites.length ? el('div', { class: 'card list-rows' },
        ...invites.map((i) => el('div', { class: 'list-row', dataset: { invite: i.id } },
          el('span', {}, i.email), el('span', { class: 'pid' }, ROLE_LABELS[i.role] ?? i.role),
          el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, `invited by ${i.invitedBy ?? 'unknown'} on ${day(i.createdAt)}`),
          holdToConfirm('Revoke', async () => {
            try {
              await api('DELETE', `/invites/${i.id}`);
              toast('Invite revoked');
              draw(accounts, await api('GET', '/invites'));
            } catch (err) { toast(err.message, true); }
          }, { rowClass: 'btn btn-sm btn-ghost-danger', holdingLabel: 'Hold to revoke…' }))))
        : el('div', { class: 'wv-members-empty' }, 'No pending invites.'),
    ].filter(Boolean));
  };
  draw(acc.value, inv.value);
  modal('Invite people', [body], null, 'Done');
}
