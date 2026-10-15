const prefix = location.pathname.replace(/\/billing\/?$/, '');
const $ = (id) => document.getElementById(id);

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
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = key;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Clerk checkout did not load'));
    document.head.append(script);
  });
  await window.Clerk.load();
  clerk = window.Clerk;
  return clerk;
};

const mountCheckout = async (state) => {
  const box = $('checkout');
  box.replaceChildren();
  if (!state.publishableKey || state.plan === 'comped') return;
  if (!state.orgId || !state.architect) return;
  try {
    const c = await loadClerk(state.publishableKey);
    if (!c?.user) {
      box.textContent = 'Sign in again to see the plans: your billing session has ended.';
      return;
    }
    await c.setActive({ organization: state.orgId });
    const mount = document.createElement('div');
    box.append(mount);
    c.mountPricingTable(mount, { for: 'organization', newSubscriptionRedirectUrl: location.href });
  } catch (error) {
    box.textContent = error.message;
  }
};

const render = (state) => {
  const seated = state.members.filter((m) => m.paid && m.seated).length;
  $('summary').textContent = state.plan === 'comped'
    ? 'This workspace was made before billing began, so it is never charged.'
    : state.plan
    ? `${seated} of ${state.seats} paid ${state.seats === 1 ? 'seat is' : 'seats are'} covered at $4.99 a seat each month.`
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
  const needsOrg = state.plan !== 'comped' && !state.orgId && state.seats > 0;
  $('setup').hidden = !needsOrg;
  $('setup-open').disabled = !state.architect;
  $('setup-why').textContent = state.architect
    ? 'Each Editor and Architect is a $4.99 seat. Setting up billing makes a billing organization with every paid person in it; you then buy the seats below.'
    : 'Each Editor and Architect is a $4.99 seat. An architect sets up billing.';
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

$('setup-open').addEventListener('click', async () => {
  $('setup-open').disabled = true;
  try {
    const state = await api('POST', '/billing/organization');
    render(state);
    await mountCheckout(state);
  } catch (error) {
    $('setup-why').textContent = error.message;
    $('setup-open').disabled = false;
  }
});

refresh();
