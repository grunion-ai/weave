import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SITE = 'https://grunion.ai/weave';
export const WEAVE = 'https://weave.grunion.ai';
export const CLERK_API = 'https://api.clerk.com/v1';
export const CLERK_FAPI = 'https://clerk.weave.grunion.ai';
export const CTA = '[data-cta-id="weave-hero-get-started"]';
export const SIGN_UP_PATH = '/api/auth/oidc/start?start=1';
const WAIT = 30_000;

export const runId = (now = new Date()) => `e2e-${now.toISOString().replace(/\D/g, '').slice(2, 14)}`;

export function signUpHrefProblem(href, weave = WEAVE) {
  if (!href) return 'grunion.ai has no Get started link';
  if (href !== `${weave}${SIGN_UP_PATH}`) return `grunion.ai Get started points at ${href}, not ${weave}${SIGN_UP_PATH}`;
  return null;
}

export function clerkClient({ key, fetch = globalThis.fetch }) {
  const call = async (method, path, body) => {
    const res = await fetch(`${CLERK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Clerk answered ${res.status} at ${method} ${path}: ${json?.errors?.[0]?.code ?? 'no code'}`);
    return json;
  };
  return {
    createUser: (run) => call('POST', '/users', { first_name: 'E2E', last_name: 'Test', username: `weave_${run}`, external_id: `weave-${run}`, public_metadata: { weave_e2e: true } }),
    ticket: async (userId) => (await call('POST', '/sign_in_tokens', { user_id: userId, expires_in_seconds: 600 })).token,
    testingToken: async () => (await call('POST', '/testing_tokens')).token,
    deleteUser: (userId) => call('DELETE', `/users/${encodeURIComponent(userId)}`),
  };
}

export function weaveAdmin({ token, weave = WEAVE, fetch = globalThis.fetch }) {
  const remove = async (name, hard) => {
    const res = await fetch(`${weave}/api/workspaces/${encodeURIComponent(name)}${hard ? '?hard=1' : ''}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`weave answered ${res.status} deleting workspace ${name}`);
  };
  return { deleteWorkspace: async (name) => { await remove(name, false); await remove(name, true); } };
}

export async function clerkSession({ page, clerk, userId, fapi = CLERK_FAPI, weave = WEAVE }) {
  const q = new URLSearchParams({ _clerk_js_version: '5', __clerk_testing_token: await clerk.testingToken() });
  const res = await page.context().request.post(`${fapi}/v1/client/sign_ins?${q}`, { form: { strategy: 'ticket', ticket: await clerk.ticket(userId) }, headers: { Origin: weave } });
  const body = await res.json().catch(() => ({}));
  const status = body?.response?.status;
  if (status !== 'complete') throw new Error(`the Clerk ticket sign-in answered ${res.status()} ${status ?? body?.errors?.[0]?.code ?? 'no status'}`);
}

export async function signUp({ page, clerk, admin, run, shots, site = SITE, weave = WEAVE, log = console.log }) {
  const steps = [];
  const shot = async (name, note) => {
    const path = join(shots, `${String(steps.length + 1).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path, fullPage: false });
    steps.push({ name, note, path, url: page.url() });
    log(`step ${steps.length} ${name}: ${note}`);
  };
  const user = await clerk.createUser(run);
  let workspace = null;
  try {
    await clerkSession({ page, clerk, userId: user.id, weave });
    log(`Clerk session open for test user ${user.id}`);

    await page.goto(site);
    const cta = page.locator(CTA).first();
    await cta.waitFor({ timeout: WAIT });
    const problem = signUpHrefProblem(await cta.getAttribute('href'), weave);
    await shot('grunion-weave', 'grunion.ai/weave with the Start with weave button');
    if (problem) throw new Error(problem);

    await cta.click();
    await page.waitForURL(`${weave}/start`, { timeout: WAIT });
    await page.locator('main .actions .btn-primary').waitFor({ timeout: WAIT });
    await shot('start', 'weave /start after the Clerk sign-in: no workspaces yet');

    await page.locator('main .actions .btn-primary').click();
    const form = page.locator('main form.card');
    await form.waitFor({ timeout: WAIT });
    const name = form.locator('input').first();
    await name.fill(`E2E ${run}`);
    await shot('create-form', 'The new-workspace form, named for this run');
    const made = page.waitForResponse((r) => r.url().endsWith('/api/start/workspaces') && r.request().method() === 'POST', { timeout: WAIT });
    await form.locator('button[type=submit]').click();
    const answer = await made;
    const body = await answer.json().catch(() => ({}));
    if (!answer.ok()) throw new Error(`creating the workspace answered ${answer.status()}: ${body.error ?? body.code ?? 'no reason'}`);
    workspace = body.name;
    await page.waitForURL((u) => u.pathname !== '/start', { timeout: WAIT });
    await page.waitForLoadState('networkidle', { timeout: WAIT }).catch(() => {});
    await shot('workspace', `Workspace ${workspace} open, the person its Architect`);

    const write = await page.evaluate(async () => {
      const res = await fetch('/api/spaces', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'E2E' }) });
      return { status: res.status, code: (await res.json().catch(() => ({}))).code ?? null };
    });
    if (write.status !== 402 || write.code !== 'seat-required') throw new Error(`an unpaid write answered ${write.status} ${write.code}, not 402 seat-required`);

    await page.goto(new URL('/billing', page.url()).href);
    await page.locator('#summary').filter({ hasText: /No plan covers/ }).waitFor({ timeout: WAIT });
    await shot('billing', 'Billing page: no plan yet, so the Architect works as an Observer');
    return { ok: true, workspace, user: user.id, steps };
  } catch (error) {
    await page.screenshot({ path: join(shots, 'failed.png') }).catch(() => {});
    log(`failed at ${page.url()}`);
    throw error;
  } finally {
    const errors = [];
    if (workspace) await admin.deleteWorkspace(workspace).catch((e) => errors.push(e.message));
    await clerk.deleteUser(user.id).catch((e) => errors.push(e.message));
    if (errors.length) log(`cleanup: ${errors.join('; ')}`);
  }
}

async function main() {
  const key = process.env.WEAVE_E2E_CLERK_SECRET_KEY;
  const token = process.env.WEAVE_E2E_ADMIN_TOKEN;
  if (!key || !token) throw new Error('Set WEAVE_E2E_CLERK_SECRET_KEY and WEAVE_E2E_ADMIN_TOKEN');
  const shots = resolve(process.argv[2] ?? 'signup-e2e-shots');
  mkdirSync(shots, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const result = await signUp({ page, clerk: clerkClient({ key }), admin: weaveAdmin({ token }), run: runId(), shots });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => { console.error(`signup-e2e: ${err.message}`); process.exit(1); });
}
