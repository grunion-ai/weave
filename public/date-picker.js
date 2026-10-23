'use strict';

function orderRange(r) {
  return String(r.start) > String(r.end) ? { start: r.end, end: r.start } : r;
}

function readTypedDate(typed, c, current) {
  const dc = weaveDateCore;
  const grain = dc.grainOf(c);
  const format = c.format ?? weaveDateGrain.DEFAULT_FORMAT;
  const pad = (n) => String(n).padStart(2, '0');
  const clock = c.time ? dc.parseClock(typed) : null;
  if (!grain.length) {
    if (!clock) throw new Error('no time of day');
    return clock;
  }
  const today = dc.todayIso();
  const [ty, tm] = today.split('-').map(Number);
  const hasD = grain.includes('day'), hasM = grain.includes('month'), hasY = grain.includes('year');
  const bare = typed.replace(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i, '').trim();
  let day = null;
  let m;
  if (!hasM && hasD && (m = bare.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/i))) day = `${ty}-${pad(tm)}-${pad(m[1])}`;
  else if (!hasD && hasM && (m = bare.match(/^(\d{1,2})[/.\-](\d{4})$/))) day = `${m[2]}-${pad(m[1])}-01`;
  else if (!hasD && hasM && (m = bare.match(/^(\d{4})[/.\-](\d{1,2})$/))) day = `${m[1]}-${pad(m[2])}-01`;
  else if (!hasD && !hasM && hasY && (m = bare.match(/^(\d{4})$/))) day = `${m[1]}-01-01`;
  else if (!hasD && hasM && !hasY && (m = bare.match(/^(\d{1,2})$/))) day = `${ty}-${pad(m[1])}-01`;
  else if (bare) {
    day = parseNaturalDate(bare, new Date(), { dayFirst: format === 'eu' })
      ?? (!hasD ? parseNaturalDate('1 ' + bare, new Date(), { dayFirst: format === 'eu' }) : null);
  } else if (clock && current) {
    day = String(current).split('T')[0];
  }
  if (!day) throw new Error('unreadable');
  if (!c.time) return day;
  const keep = dc.partsOf(current)?.t;
  const t = clock ?? keep;
  return t ? `${day}T${t}` : day;
}

function datePopover({ anchor, title = '', value, time, format, costume = null, range = false, onPick }) {
  const dc = weaveDateCore;
  const c = costume ?? { time, format };
  time = !!c.time;
  format = c.format ?? weaveDateGrain.DEFAULT_FORMAT;
  const grain = dc.grainOf(c);
  const hasY = grain.includes('year'), hasM = grain.includes('month'), hasD = grain.includes('day');
  const pad = (n) => String(n).padStart(2, '0');
  document.querySelector('.date-pop')?.remove();
  const todayIso = dc.todayIso();
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const startVal = range ? (value?.start ?? '') : (value || '');
  const p = dc.partsOf(startVal) ?? {};
  let y = p.y ?? ty, m = p.m ?? tm;
  const dayOf = (iso) => { const q = dc.partsOf(iso || ''); return q?.d != null ? `${q.y}-${pad(q.m)}-${pad(q.d)}` : ''; };
  const clockOf = (iso) => dc.partsOf(iso || '')?.t ?? '';
  const ends = range
    ? { start: dayOf(value?.start), end: dayOf(value?.end) }
    : { start: dayOf(value), end: '' };
  const clocks = range
    ? { start: clockOf(value?.start), end: clockOf(value?.end) }
    : { start: clockOf(value), end: '' };
  let picking = range && ends.start && !ends.end ? 'end' : 'start';
  let view = !hasY && !hasM && !hasD ? 'clock' : hasD && !hasM ? 'daylist' : hasM && !hasD ? 'months' : hasY && !hasM ? 'years' : 'days';
  let decadeBase = y;
  const pop = el('div', { class: 'date-pop' + (range ? ' range' : ''), role: 'dialog', onclick: (e) => e.stopPropagation() });
  const withClock = (day, which = 'start') => (time ? `${day}T${clocks[which] || '00:00'}` : day);
  const stamp = (which) => (view === 'clock' ? clocks[which] : (ends[which] ? withClock(ends[which], which) : ''));
  const commit = (close) => {
    if (range) {
      const both = view === 'clock' ? clocks.start && clocks.end : ends.start && ends.end;
      if (both) onPick({ start: stamp('start'), end: stamp('end') });
    } else {
      onPick(view === 'clock' ? (clocks.start || null) : (ends.start ? stamp('start') : null));
    }
    if (close) pop.remove();
    else draw();
  };
  const clear = () => { ends.start = ''; ends.end = ''; clocks.start = ''; clocks.end = ''; picking = 'start'; onPick(null); pop.remove(); };
  const pick = (dayIso) => {
    if (!range) { ends.start = dayIso; return commit(!time); }
    if (picking === 'start') { ends.start = dayIso; ends.end = ''; picking = 'end'; return draw(); }
    ends.end = dayIso;
    if (ends.end < ends.start) [ends.start, ends.end] = [ends.end, ends.start];
    picking = 'start';
    commit(!time);
  };
  const dayClass = (iso) => (
    (iso === todayIso ? ' today' : '')
    + (iso === ends.start || iso === ends.end ? ' sel' : '')
    + (range && ends.start && ends.end && iso > ends.start && iso < ends.end ? ' in-range' : ''));
  const smartFor = (which) => {
    const cur = range ? (value?.[which] ?? '') : (value || '');
    const smart = el('input', {
      class: 'form-control form-control-sm date-smart',
      'aria-label': range ? (which === 'start' ? 'Start' : 'End') : 'Date',
      placeholder: view === 'clock' ? '9:15, 5:40 pm…' : hasD ? 'today, 15 sep, 9/15/26…' : hasM ? 'aug 2026, 08/2026…' : '2026…',
      value: dc.formatDate(cur, { ...c, viewerZone: LOCAL_ZONE }),
    });
    const preview = el('div', { class: 'date-smart-preview' });
    const readSmart = () => {
      try { return readTypedDate(smart.value, c, cur); } catch { return null; }
    };
    smart.addEventListener('input', () => {
      const local = readSmart();
      let shown = '…';
      if (local) { try { shown = `→ ${dc.formatDate(c.grain == null ? local : dc.coerce(c, local), { ...c, format: c.grain == null ? 'long' : format })}`; } catch { shown = '…'; } }
      preview.textContent = smart.value.trim() ? shown : '';
    });
    smart.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const local = readSmart();
      if (!local) return toast(`Could not read '${smart.value}' as a ${view === 'clock' ? 'time' : 'date'}`, true);
      if (view === 'clock') { clocks[which] = local; return commit(!range || !!(clocks.start && clocks.end)); }
      const day = local.split('T')[0];
      const t = local.split('T')[1];
      if (t) clocks[which] = t;
      if (!range) { ends.start = day; return commit(true); }
      [y, m] = day.split('-').map(Number);
      if (which === 'start') {
        ends.start = day; ends.end = ''; picking = 'end';
        draw();
        pop.querySelector('.date-pop-smart-end .date-smart')?.focus();
        return;
      }
      ends.end = day;
      if (!ends.start) { picking = 'start'; return draw(); }
      if (ends.end < ends.start) [ends.start, ends.end] = [ends.end, ends.start];
      picking = 'start';
      commit(true);
    });
    return el('div', { class: 'date-pop-smart' + (range ? ' date-pop-smart-' + which : '') },
      range ? el('span', { class: 'date-smart-label' }, which === 'start' ? 'Start' : 'End') : null, smart, preview);
  };
  const body = el('div', { class: 'date-pop-body' });
  const timeInput = (which) => {
    const t = el('input', { type: 'time', class: 'form-control form-control-sm date-time', 'aria-label': range ? `${which} time` : 'Time', value: clocks[which] });
    t.addEventListener('change', () => {
      clocks[which] = t.value;
      if (view === 'clock') { commit(false); return; }
      if (ends.start && (!range || ends.end)) commit(false);
    });
    return t;
  };
  const timeRow = () => el('div', { class: 'date-pop-time' },
    el('span', {}, 'Time'), timeInput('start'),
    ...(range ? [el('span', { class: 'range-sep' }, '–'), timeInput('end')] : []));
  const foot = (todayPick) => el('div', { class: 'date-pop-foot' },
    el('button', { type: 'button', class: 'date-pop-link', onclick: clear }, 'Clear'),
    el('button', { type: 'button', class: 'date-pop-link', onclick: todayPick }, 'Today'));
  function draw() {
    body.replaceChildren();
    if (view === 'days') {
      body.append(el('div', { class: 'date-pop-head' },
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { view = 'months'; draw(); } }, dc.MONTHS_LONG[m - 1], lucideEl('chevron-down', 'wv-icon wv-icon-xs')),
        hasY ? el('button', { type: 'button', class: 'date-pop-title', onclick: () => { view = 'years'; decadeBase = y; draw(); } }, String(y), lucideEl('chevron-down', 'wv-icon wv-icon-xs')) : el('span'),
        el('span', { class: 'date-pop-spacer' }),
        el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Previous month', onclick: () => { [y, m] = dc.shiftMonth(y, m, -1); draw(); } }, '‹'),
        el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Next month', onclick: () => { [y, m] = dc.shiftMonth(y, m, 1); draw(); } }, '›')));
      const grid = el('div', { class: 'date-grid' }, ...dc.WEEKDAYS.map((d) => el('span', { class: 'date-wd' }, d)));
      for (const week of dc.calendarMonth(y, m)) {
        for (const cell of week) {
          grid.append(el('button', {
            type: 'button',
            class: 'date-day' + (cell.inMonth ? ' in' : ' out') + dayClass(cell.iso),
            onclick: () => { [y, m] = cell.iso.split('-').map(Number); pick(cell.iso); },
          }, String(cell.day)));
        }
      }
      body.append(grid);
      if (time) body.append(timeRow());
      body.append(foot(() => { [y, m] = [ty, tm]; pick(todayIso); }));
    } else if (view === 'daylist') {
      const grid = el('div', { class: 'date-grid' });
      for (let d = 1; d <= 31; d++) {
        const iso = `${ty}-${pad(tm)}-${pad(d)}`;
        grid.append(el('button', {
          type: 'button', class: 'date-day in' + dayClass(iso),
          onclick: () => pick(iso),
        }, String(d)));
      }
      body.append(grid);
      if (time) body.append(timeRow());
      body.append(foot(() => pick(todayIso)));
    } else if (view === 'clock') {
      body.append(timeRow(), el('div', { class: 'date-pop-foot' },
        el('button', { type: 'button', class: 'date-pop-link', onclick: clear }, 'Clear'),
        el('button', { type: 'button', class: 'date-pop-link', onclick: () => {
          const d = new Date();
          const now = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
          if (!range) { clocks.start = now; return commit(true); }
          if (picking === 'start') { clocks.start = now; clocks.end = ''; picking = 'end'; return draw(); }
          clocks.end = now; picking = 'start'; commit(true);
        } }, 'Now')));
    } else if (view === 'months') {
      body.append(el('div', { class: 'date-pop-head' },
        hasY ? el('button', { type: 'button', class: 'date-pop-title', onclick: () => { if (hasD) { view = 'days'; draw(); } else { view = 'years'; decadeBase = y; draw(); } } }, String(y), hasD ? null : lucideEl('chevron-down', 'wv-icon wv-icon-xs')) : el('span', { class: 'date-pop-title' }, 'Month'),
        el('span', { class: 'date-pop-spacer' }),
        ...(hasY ? [
          el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Previous year', onclick: () => { y--; draw(); } }, '‹'),
          el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Next year', onclick: () => { y++; draw(); } }, '›')] : [])));
      body.append(el('div', { class: 'date-pick-grid' }, ...dc.MONTHS.map((name, i) => {
        const iso = `${y}-${pad(i + 1)}-01`;
        return el('button', {
          type: 'button', class: 'date-pick-cell' + (hasD ? (i + 1 === m ? ' sel' : '') : dayClass(iso).replace(' today', '')),
          onclick: () => {
            m = i + 1;
            if (hasD) { view = 'days'; draw(); return; }
            pick(iso);
          },
        }, name);
      })));
      if (!hasD && time) body.append(timeRow());
      if (!hasD) body.append(foot(() => { y = ty; m = tm; pick(`${ty}-${pad(tm)}-01`); }));
    } else {
      const years = dc.decade(decadeBase);
      body.append(el('div', { class: 'date-pop-head' },
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { if (hasM) { view = hasD ? 'days' : 'months'; draw(); } } }, `${years[0]}–${years[years.length - 1]}`),
        el('span', { class: 'date-pop-spacer' }),
        el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Previous decade', onclick: () => { decadeBase -= 10; draw(); } }, '‹'),
        el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Next decade', onclick: () => { decadeBase += 10; draw(); } }, '›')));
      body.append(el('div', { class: 'date-pick-grid' }, ...years.map((yr) => {
        const iso = `${yr}-01-01`;
        return el('button', {
          type: 'button', class: 'date-pick-cell' + (hasM ? (yr === y ? ' sel' : '') : dayClass(iso).replace(' today', '')),
          onclick: () => {
            y = yr;
            if (hasM) { view = 'months'; draw(); return; }
            pick(iso);
          },
        }, String(yr));
      })));
      if (!hasM) body.append(foot(() => { y = ty; pick(`${ty}-01-01`); }));
    }
  }
  draw();
  const smarts = range ? [smartFor('start'), smartFor('end')] : [smartFor('start')];
  pop.append(...(title ? [el('div', { class: 'picker-title' }, title)] : []), ...smarts, body);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (r.bottom + 6 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + 'px';
  dismissOutside({ open: () => pop.isConnected, inside: (t) => pop.contains(t), swallow: (t) => anchor.contains(t), close: () => pop.remove() });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); pop.remove(); anchor.focus(); } });
  smarts[0].querySelector('.date-smart').focus();
  return pop;
}
