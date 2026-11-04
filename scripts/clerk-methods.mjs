#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export function methodsOf(environment) {
  const settings = environment.user_settings;
  const social = Object.values(settings.social ?? {}).filter((s) => s.enabled);
  const email = settings.attributes.email_address;
  const signUp = [...(email?.enabled && (email.verifications ?? []).includes('email_code') ? ['email_code'] : []), ...social.map((s) => s.strategy)];
  const signIn = [...(email?.enabled && email.used_for_first_factor ? (email.first_factors ?? []).filter((f) => f === 'email_code') : []), ...social.filter((s) => s.authenticatable).map((s) => s.strategy)];
  return { signIn: signIn.sort(), signUp: signUp.sort() };
}

export function parityGaps(environment) {
  const { signIn, signUp } = methodsOf(environment);
  return {
    signUpOnly: signUp.filter((m) => !signIn.includes(m)),
    signInOnly: signIn.filter((m) => !signUp.includes(m)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2] ?? 'https://clerk.weave.grunion.ai/v1/environment';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const environment = await res.json();
  const methods = methodsOf(environment);
  const gaps = parityGaps(environment);
  console.log(JSON.stringify({ url, ...methods, ...gaps }, null, 1));
  if (gaps.signUpOnly.length || gaps.signInOnly.length) process.exit(1);
}
