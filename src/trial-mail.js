import { trialOf } from './billing.js';
import { Weave } from './engine.js';
import { trialEmail } from './mail.js';

export const TRIAL_MAIL_DAYS = 3;
export const TRIAL_MAIL_EVERY = 60 * 60_000;

export function trialMailStage(trial, sent = {}) {
  if (!trial) return null;
  if (trial.daysLeft <= 1) return sent.last ? null : 'last';
  if (trial.daysLeft <= TRIAL_MAIL_DAYS) return sent.ending ? null : 'ending';
  return null;
}

export function architectAddresses(accounts = []) {
  const found = new Set();
  for (const a of accounts) {
    if (Weave.roleName(a.role) !== 'architect') continue;
    const mail = a.identities?.find((i) => i.verifiedEmail)?.verifiedEmail;
    if (mail) found.add(mail);
  }
  return [...found];
}

export async function sweepTrialMail({ hub, billing, mail, origin = '', now = Date.now, log = console.error } = {}) {
  const sent = [];
  if (!billing?.trialDays || typeof mail !== 'function') return { sent };
  for (const { name } of hub.list()) {
    const w = hub.get(name);
    if (!w?.state.meta.trialFrom || w.state.meta.deletedAt) continue;
    const trial = trialOf(w.billing(), billing.trialDays, now());
    const stage = trialMailStage(trial, w.state.meta.trialMail ?? {});
    if (!stage) continue;
    const to = architectAddresses(w.listAccounts());
    if (!to.length) continue;
    let standing;
    try {
      standing = await billing.standing({ workspace: w.billing(), accounts: w.listAccounts() });
    } catch (err) {
      log(`weave: the trial sweep could not read '${name}'s plan, so its mail waits: ${err?.message ?? err}`);
      continue;
    }
    if (standing.plan !== 'trial') continue;
    const letter = trialEmail({ workspace: name, stage, daysLeft: trial.daysLeft, endsAt: trial.endsAt, billing: `${origin}/w/${name}/billing`, origin });
    let went = 0;
    for (const address of to) {
      try {
        await mail({ to: address, subject: letter.subject, html: letter.html, text: letter.text });
        went += 1;
      } catch (err) {
        log(`weave: the ${stage} trial mail for '${name}' did not reach ${address}: ${err?.message ?? err}`);
      }
    }
    if (!went) continue;
    w.markTrialMail(stage, new Date(now()).toISOString());
    sent.push({ workspace: name, stage, to });
  }
  return { sent };
}
