(function (root) {
  const { COPY, fill, slugify } = root.WeaveSlugs;
  const make = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids.filter((k) => k != null));
    return n;
  };
  const ERRORS = new Set(['taken', 'reserved', 'invalid']);

  function mount({ check, accountName = null, base = null, delay = 300 } = {}) {
    let submit = null;
    let state = null;
    let checkedSlug = null;
    let slugEdited = false;
    let timer = null;
    let asked = 0;

    const nameInput = make('input', { name: 'name', class: 'form-control', autocomplete: 'off' });
    const slugInput = make('input', { name: 'slug', class: 'form-control', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'ws-slug-helper ws-slug-status' });
    const helper = make('div', { class: 'form-hint', id: 'ws-slug-helper' });
    const status = make('div', { class: 'form-hint ws-slug-status', id: 'ws-slug-status', role: 'status', 'aria-live': 'polite' });
    const chips = make('div', { class: 'ws-slug-chips', hidden: true });

    const suggest = (kind) => {
      if (kind === 'name') {
        slugInput.value = slugify(accountName ?? '');
        slugInput.placeholder = '';
        slugEdited = true;
        slugInput.focus();
        return schedule(0);
      }
      slugInput.value = '';
      slugInput.placeholder = COPY.placeholders[kind];
      slugEdited = true;
      slugInput.focus();
      schedule(0);
    };
    chips.append(make('span', { class: 'ws-slug-chip-lead' }, COPY.chipLead),
      ...['name', 'team', 'project', 'mascot']
        .filter((kind) => kind !== 'name' || slugify(accountName ?? ''))
        .map((kind) => make('button', { type: 'button', class: 'chip ws-slug-chip', 'data-kind': kind, onclick: () => suggest(kind) }, COPY.chips[kind])));

    const paint = () => {
      const slug = slugInput.value;
      helper.textContent = base ? fill(COPY.helper, { slug: slug || COPY.helperSlugFallback, base }) : COPY.helperNoBase;
      const current = checkedSlug === slug ? state : null;
      status.textContent = current === 'available' ? fill(base ? COPY.available : COPY.availableNoBase, { slug, base })
        : ERRORS.has(current) ? fill(COPY[current], { slug }) : '';
      status.dataset.state = current ?? '';
      slugInput.setAttribute('aria-invalid', ERRORS.has(current) ? 'true' : 'false');
      chips.hidden = !(current === 'taken' || current === 'reserved');
      if (submit) submit.disabled = current !== 'available';
    };

    const run = async () => {
      const slug = slugInput.value;
      const ticket = ++asked;
      if (!slug) { state = null; checkedSlug = null; return paint(); }
      let answer;
      try { answer = await check(slug); } catch { answer = { state: null }; }
      if (ticket !== asked || slug !== slugInput.value) return;
      state = answer.state;
      checkedSlug = slug;
      if (answer.base !== undefined) base = answer.base;
      paint();
    };
    const schedule = (ms = delay) => {
      clearTimeout(timer);
      state = null;
      checkedSlug = null;
      paint();
      timer = setTimeout(run, ms);
    };

    nameInput.addEventListener('input', () => {
      if (!slugEdited) slugInput.value = slugify(nameInput.value);
      schedule();
    });
    slugInput.addEventListener('input', () => {
      slugEdited = slugInput.value !== '';
      schedule();
    });

    const node = make('div', { class: 'ws-slug-form' },
      make('label', { class: 'form-label' }, COPY.nameLabel, nameInput),
      make('label', { class: 'form-label' }, COPY.label, slugInput), helper, status, chips);
    paint();

    return {
      node,
      nameInput,
      slugInput,
      bindSubmit(button) { submit = button; button.textContent = COPY.submit; paint(); },
      value: () => ({ name: nameInput.value.trim(), slug: slugInput.value }),
      refused(code) {
        const lost = String(code ?? '').replace(/^slug_/, '');
        if (!ERRORS.has(lost)) return false;
        state = lost;
        checkedSlug = slugInput.value;
        paint();
        return true;
      },
    };
  }

  root.WeaveSlugForm = { mount };
})(globalThis);
