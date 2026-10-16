const prefix = location.pathname.replace(/\/billing\/?$/, '');
const $ = (id) => document.getElementById(id);
const PLAN_NAMES = { solo: 'the solo plan', team: 'the team plan' };

const api = async (method, path) => {
  const res = await fetch(`${prefix}/api${path}`, { method, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `The server answered ${res.status}`), { status: res.status });
  return body;
};

export const frontendApi = (key) => {
  const encoded = String(key ?? '').split('_')[2];
  if (!encoded) return null;
  try { return atob(encoded).replace(/\$$/, ''); } catch { return null; }
};

let clerk = null;
const loadClerk = async (key) => {
  if (clerk) return clerk;
  const host = frontendApi(key);
  if (!host) return null;
  const inject = (src, data = {}) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    Object.assign(script.dataset, data);
    script.onload = resolve;
    script.onerror = () => reject(new Error('Clerk checkout did not load'));
    document.head.append(script);
  });
  await Promise.all([
    inject(`https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { clerkPublishableKey: key }),
    inject(`https://${host}/npm/@clerk/ui@1/dist/ui.browser.js`),
  ]);
  await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
  clerk = window.Clerk;
  return clerk;
};

const mountCheckout = async (state) => {
  const box = $('checkout');
  box.replaceChildren();
  if (!state.publishableKey || state.plan === 'comped') return;
  const forOrg = !!state.orgId;
  if (forOrg && !state.architect) return;
  if (!forOrg && state.seats > 1) return;
  try {
    const c = await loadClerk(state.publishableKey);
    if (!c?.user) {
      box.textContent = 'Sign in again to see the plans: your billing session has ended.';
      return;
    }
    if (forOrg) await c.setActive({ organization: state.orgId });
    const mount = document.createElement('div');
    box.append(mount);
    c.mountPricingTable(mount, { for: forOrg ? 'organization' : 'user', newSubscriptionRedirectUrl: location.href });
  } catch (error) {
    box.textContent = error.message;
  }
};

const render = (state) => {
  const seated = state.members.filter((m) => m.paid && m.seated).length;
  $('summary').textContent = state.plan === 'comped'
    ? 'This workspace was made before billing began, so it is never charged.'
    : state.plan
    ? `This workspace is on ${PLAN_NAMES[state.plan] ?? state.plan}. ${seated} of ${state.seats} paid ${state.seats === 1 ? 'seat is' : 'seats are'} covered.`
    : state.seats === 0 ? 'Nobody here takes a paid seat yet.' : `No plan covers this workspace, so its ${state.seats === 1 ? 'Editor or Architect works' : `${state.seats} Editors and Architects work`} as Observers until one is bought.`;
  $('seats').replaceChildren(...state.members.map((m) => {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.textContent = m.name;
    const role = document.createElement('small');
    role.textContent = ` ${m.role}`;
    who.append(role);
    const mark = document.createElement('span');
    mark.className = !m.paid ? 'muted' : m.seated ? 'state-ok' : 'state-bad';
    mark.textContent = !m.paid ? 'Free' : m.seated ? 'Seat covered' : 'Needs a seat';
    li.append(who, mark);
    return li;
  }));
  const needsTeam = state.plan !== 'comped' && !state.orgId && state.seats > 1;
  $('team').hidden = !needsTeam;
  $('team-open').disabled = !state.architect;
  $('team-why').textContent = state.architect
    ? 'More than one person here takes a paid seat, so the workspace needs the team plan. Opening it makes a billing organization with every Editor and Architect in it; you then pay per seat below.'
    : 'More than one person here takes a paid seat, so the workspace needs the team plan. An architect opens it.';
  $('back').href = `${prefix}/`;
};

const refresh = async () => {
  try {
    const state = await api('GET', '/billing');
    render(state);
    await mountCheckout(state);
  } catch (error) {
    $('summary').textContent = error.status === 404 ? 'This server does not bill anyone.' : error.message;
  }
};

$('team-open').addEventListener('click', async () => {
  $('team-open').disabled = true;
  try {
    const state = await api('POST', '/billing/team');
    render(state);
    await mountCheckout(state);
  } catch (error) {
    $('team-why').textContent = error.message;
    $('team-open').disabled = false;
  }
});

refresh();
