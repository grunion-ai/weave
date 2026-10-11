(function (win) {
  const doc = win.document;
  const root = doc.documentElement;
  const media = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  let pref = 'auto';
  try { pref = win.localStorage.getItem('weave-theme') ?? 'auto'; } catch {}
  const applyTheme = () => {
    root.dataset.bsTheme = pref === 'dark' || pref === 'light' ? pref : (media?.matches ? 'dark' : 'light');
  };
  applyTheme();
  media?.addEventListener?.('change', applyTheme);

  const valueOf = (node) => {
    const type = node.dataset.type;
    if (type === 'multiselect') return [...node.querySelectorAll('input:checked')].map((i) => i.value);
    if (node.type === 'checkbox') return node.checked;
    if (node.value === '') return undefined;
    return type === 'number' || type === 'rating' ? Number(node.value) : node.value;
  };

  const collect = (form) => {
    if (form.dataset.kind === 'bug') {
      return {
        categories: [...form.querySelectorAll('input[name="categories"]:checked')].map((i) => i.value),
        note: form.querySelector('[name="note"]')?.value.trim() ?? '',
        events: [],
        client: win.bugCore?.clientContext?.() ?? {},
      };
    }
    const values = {};
    for (const node of form.querySelectorAll('[data-field]')) {
      const v = valueOf(node);
      if (v !== undefined) values[node.dataset.field] = v;
    }
    return { values };
  };

  const wire = () => {
    const form = doc.getElementById('wv-form');
    if (!form) return;
    const send = form.querySelector('button[type="submit"]');
    const error = doc.getElementById('wv-form-error');
    const receipt = doc.getElementById('wv-form-receipt');
    const storageKey = `weave-form-pending:${form.dataset.submit}`;
    let pending;
    try { pending = JSON.parse(win.sessionStorage.getItem(storageKey)); } catch {}
    const requestKey = () => win.crypto.randomUUID?.() ?? Array.from(win.crypto.getRandomValues(new Uint8Array(24)), (n) => n.toString(16).padStart(2, '0')).join('');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (send.disabled || !form.reportValidity()) return;
      send.disabled = true;
      send.textContent = 'Sending…';
      error.classList.add('d-none');
      try {
        const input = collect(form);
        const signature = JSON.stringify({ ...input, client: undefined });
        if (!pending || pending.signature !== signature || Date.now() - pending.at >= 24 * 60 * 60 * 1000) {
          pending = { signature, body: JSON.stringify(input), key: requestKey(), at: Date.now() };
          try { win.sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch {}
        }
        const res = await win.fetch(form.dataset.submit, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
          body: pending.body,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const wait = res.status === 429 ? Number(res.headers.get('Retry-After')) : 0;
          throw new Error((data.error || `The form was refused (${res.status})`) + (wait > 0 ? ` Try again in ${wait} seconds.` : ''));
        }
        pending = null;
        try { win.sessionStorage.removeItem(storageKey); } catch {}
        send.textContent = 'Sent';
        form.classList.add('sent');
        receipt.textContent = `Filed as ${data.table} #${data.publicId}.`;
      } catch (err) {
        send.disabled = false;
        send.textContent = 'Send';
        error.textContent = err.message;
        error.classList.remove('d-none');
      }
    });
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', wire);
  else wire();
})(typeof window !== 'undefined' ? window : globalThis);
