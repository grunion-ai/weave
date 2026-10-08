(function (root) {
  const HOLD_MS = 250;
  const MOUSE_SLOP = 4;
  const TOUCH_SLOP = 8;
  const BAND = 40;
  const STEP = 16;
  const SETTLE_FALLBACK_MS = 320;

  function edgeSpeed(pos, lo, hi, { band = BAND, step = STEP } = {}) {
    const b = Math.min(band, (hi - lo) / 3);
    if (!(b > 0)) return 0;
    const depth = pos < lo + b ? pos - (lo + b) : pos > hi - b ? pos - (hi - b) : 0;
    if (!depth) return 0;
    return Math.sign(depth) * Math.max(1, Math.round(step * Math.min(1, Math.abs(depth) / b)));
  }

  function nearest(rects, x, y) {
    let best = -1, dist = Infinity;
    rects.forEach((r, i) => {
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dx * dx + dy * dy;
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }

  const before = (r, x, y, axis) => (axis === 'x' ? x < r.left + r.width / 2 : y < r.top + r.height / 2);

  function columnShift({ widths, from, to }) {
    const w = widths[from];
    return widths.map((_, k) => (to > from && k > from && k <= to ? -w : to < from && k >= to && k < from ? w : 0));
  }

  function gapStart({ lefts, widths, from, to }) {
    if (to > from) return lefts[to] + widths[to] - widths[from];
    if (to < from) return lefts[to];
    return lefts[from];
  }

  const doc = () => root.document;
  const lifting = (n) => n.classList.contains('wv-reorder-lift');
  const reduced = () => Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  let lifted = false;

  function guard(handle) {
    if (!handle || handle.dataset.reorderGuard) return handle;
    handle.dataset.reorderGuard = '1';
    handle.classList.add('wv-reorder-handle');
    handle.addEventListener('touchmove', (e) => { if (lifted && e.cancelable) e.preventDefault(); }, { passive: false });
    return handle;
  }

  function swallowClick() {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    root.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => root.removeEventListener('click', stop, { capture: true }), 0);
  }

  function press(down, { hold = HOLD_MS, canLift, keepDefault = false, lift, move, drop, cancel }) {
    const d = doc(), html = d.documentElement;
    const touch = down.pointerType === 'touch';
    const id = down.pointerId;
    const start = { x: down.clientX, y: down.clientY };
    let phase = 'pending', timer = 0, last = start;
    if (!touch) { if (!keepDefault) down.preventDefault(); html.classList.add('wv-grabbing'); }
    const begin = () => {
      if (canLift && !canLift()) { finish('abort'); return; }
      phase = 'lifted';
      lifted = true;
      html.classList.add('wv-grabbing', 'wv-reordering');
      if (touch) { try { root.navigator?.vibrate?.(10); } catch {} }
      lift(last, start);
    };
    const onMove = (e) => {
      if (e.pointerId !== id) return;
      last = { x: e.clientX, y: e.clientY };
      if (phase === 'pending') {
        const far = Math.hypot(last.x - start.x, last.y - start.y);
        if (touch) { if (far > TOUCH_SLOP) finish('abort'); return; }
        if (far < MOUSE_SLOP) return;
        begin();
        if (phase !== 'lifted') return;
      }
      if (phase === 'lifted') { if (e.cancelable) e.preventDefault(); move(last); }
    };
    const onUp = (e) => { if (e.pointerId === id) finish(phase === 'lifted' ? 'drop' : 'abort', { x: e.clientX, y: e.clientY }); };
    const onCancel = (e) => { if (e.pointerId === id) finish(phase === 'lifted' ? 'cancel' : 'abort'); };
    const onKey = (e) => {
      if (e.key !== 'Escape' || phase !== 'lifted') return;
      e.preventDefault(); e.stopPropagation();
      finish('cancel');
    };
    const onTouchMove = (e) => { if (phase === 'lifted' && e.cancelable) e.preventDefault(); };
    const onMenu = (e) => { if (phase !== 'done') e.preventDefault(); };
    function finish(how, p = last) {
      if (phase === 'done') return;
      const was = phase;
      phase = 'done';
      lifted = false;
      clearTimeout(timer);
      d.removeEventListener('pointermove', onMove, true);
      d.removeEventListener('pointerup', onUp, true);
      d.removeEventListener('pointercancel', onCancel, true);
      root.removeEventListener('keydown', onKey, true);
      d.removeEventListener('touchmove', onTouchMove, { passive: false });
      d.removeEventListener('contextmenu', onMenu, true);
      html.classList.remove('wv-grabbing', 'wv-reordering');
      if (was !== 'lifted') return;
      swallowClick();
      if (how === 'drop') drop(p, start); else cancel(p, start);
    }
    d.addEventListener('pointermove', onMove, true);
    d.addEventListener('pointerup', onUp, true);
    d.addEventListener('pointercancel', onCancel, true);
    root.addEventListener('keydown', onKey, true);
    d.addEventListener('touchmove', onTouchMove, { passive: false });
    d.addEventListener('contextmenu', onMenu, true);
    if (touch) timer = setTimeout(() => { if (phase === 'pending') begin(); }, hold);
    return { finish, get phase() { return phase; } };
  }

  const IDENTITY = ['id', 'data-field', 'data-block', 'data-view', 'data-level', 'data-eid', 'data-col', 'data-key', 'data-doc-field', 'data-reorder-guard', 'name', 'for'];
  function liftOf(source, { rect = source.getBoundingClientRect(), host = source.parentElement, make = null } = {}) {
    const d = doc();
    const clone = make ? make(source) : source.cloneNode(true);
    for (const n of [clone, ...clone.querySelectorAll('*')]) for (const a of IDENTITY) n.removeAttribute(a);
    for (const n of clone.querySelectorAll('iframe, video, audio')) n.replaceWith(d.createElement('div'));
    const fromFields = source.querySelectorAll('input, textarea, select');
    clone.querySelectorAll('input, textarea, select').forEach((n, i) => {
      const f = fromFields[i];
      if (!f) return;
      if ('checked' in f) n.checked = f.checked;
      n.value = f.value;
    });
    clone.classList.remove('wv-reorder-slot', 'dragging');
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;
    const s = clone.style;
    s.position = 'fixed';
    s.left = `${rect.left}px`;
    s.top = `${rect.top}px`;
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
    s.margin = '0';
    s.boxSizing = 'border-box';
    s.translate = '0px 0px';
    (host ?? d.body).append(clone);
    const got = clone.getBoundingClientRect();
    if (Math.abs(got.left - rect.left) > 0.5) s.left = `${2 * rect.left - got.left}px`;
    if (Math.abs(got.top - rect.top) > 0.5) s.top = `${2 * rect.top - got.top}px`;
    clone.classList.add('wv-reorder-lift');
    void clone.offsetWidth;
    clone.classList.add('is-lifted');
    const holder = clone;
    let dx = 0, dy = 0;
    return {
      el: clone,
      follow(x, y) { dx = x; dy = y; s.translate = `${x}px ${y}px`; },
      settle(to) {
        return new Promise((done) => {
          let over = false;
          const end = () => { if (over) return; over = true; holder.remove(); done(); };
          if (!to || reduced()) return end();
          const tx = to.left - rect.left, ty = to.top - rect.top;
          if (Math.abs(tx - dx) < 1 && Math.abs(ty - dy) < 1) { clone.classList.remove('is-lifted'); return setTimeout(end, 0); }
          clone.classList.add('is-settling');
          clone.classList.remove('is-lifted');
          s.translate = `${tx}px ${ty}px`;
          clone.addEventListener('transitionend', (e) => { if (e.propertyName === 'translate') end(); });
          setTimeout(end, SETTLE_FALLBACK_MS);
        });
      },
      remove() { holder.remove(); },
    };
  }

  function scrollParent(node, axis) {
    const d = doc();
    for (let n = node; n && n !== d.body && n !== d.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const o = axis === 'x' ? cs.overflowX : cs.overflowY;
      const room = axis === 'x' ? n.scrollWidth > n.clientWidth + 1 : n.scrollHeight > n.clientHeight + 1;
      if (/(auto|scroll)/.test(o) && room) return n;
    }
    return d.scrollingElement;
  }

  function autoScroll({ scroller, axis = 'y', point, onScroll, bounds }) {
    const d = doc();
    let raf = 0;
    const snap = scroller?.style.scrollSnapType;
    const rectOf = (el) => (el === d.scrollingElement || el === d.documentElement || el === d.body
      ? { left: 0, top: 0, right: root.innerWidth, bottom: root.innerHeight }
      : el.getBoundingClientRect());
    const tick = () => {
      raf = 0;
      if (!scroller) return;
      const p = point();
      const r = rectOf(scroller);
      const [lo, hi] = bounds ? bounds(r) : axis === 'x' ? [r.left, r.right] : [r.top, r.bottom];
      const v = edgeSpeed(axis === 'x' ? p.x : p.y, lo, hi);
      if (!v) return;
      const prop = axis === 'x' ? 'scrollLeft' : 'scrollTop';
      scroller.style.scrollSnapType = 'none';
      const was = scroller[prop];
      scroller[prop] = was + v;
      if (scroller[prop] === was) return;
      onScroll?.();
      raf = requestAnimationFrame(tick);
    };
    return {
      kick() { if (!raf) raf = requestAnimationFrame(tick); },
      stop() { cancelAnimationFrame(raf); raf = 0; if (scroller) scroller.style.scrollSnapType = snap ?? ''; },
    };
  }

  const slides = new WeakMap();
  function slide(nodes, mutate) {
    if (reduced()) { mutate(); return; }
    const live = [...new Set(nodes)].filter((n) => n?.isConnected);
    const was = new Map(live.map((n) => [n, n.getBoundingClientRect()]));
    for (const n of live) { n.style.transition = 'none'; n.style.translate = ''; }
    mutate();
    const moving = [];
    for (const n of live) {
      if (!n.isConnected) continue;
      const a = n.getBoundingClientRect(), b = was.get(n);
      const dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) { n.style.transition = ''; continue; }
      n.style.translate = `${dx}px ${dy}px`;
      moving.push(n);
    }
    if (!moving.length) return;
    void doc().body.offsetWidth;
    for (const n of moving) {
      const turn = (slides.get(n) ?? 0) + 1;
      slides.set(n, turn);
      n.style.transition = 'translate var(--wv-slide-ms) var(--wv-slide-ease)';
      n.style.translate = '';
      const done = () => { if (slides.get(n) === turn) { n.style.transition = ''; slides.delete(n); } };
      n.addEventListener('transitionend', done, { once: true });
      setTimeout(done, SETTLE_FALLBACK_MS);
    }
  }

  function settledRect(node) {
    const r = node.getBoundingClientRect();
    const t = getComputedStyle(node).translate;
    if (!t || t === 'none') return r;
    const [x = 0, y = 0] = t.split(' ').map((v) => parseFloat(v) || 0);
    return { left: r.left - x, top: r.top - y, width: r.width, height: r.height, right: r.right - x, bottom: r.bottom - y };
  }

  function sortable(down, opts) {
    const { source, items, axis = 'y', scroller, tail, members: memberFn, onPlace, onDrop, onCancel, zone, lock = false } = opts;
    const follow = (p) => clone.follow(lock && axis === 'y' ? 0 : p.x - start.x, lock && axis === 'x' ? 0 : p.y - start.y);
    let clone = null, members = [source], origin = null, auto = null, last = null, placed = null, start = null;
    const skipNext = (n) => { let s = n?.nextElementSibling; while (s && (members.includes(s) || lifting(s))) s = s.nextElementSibling; return s; };
    const candidates = () => items().filter((n) => !members.includes(n) && !n.classList.contains('wv-reorder-lift') && n.isConnected && n.getClientRects().length);
    const parents = () => [...new Set([origin.parent, source.parentElement].filter(Boolean))];
    const sliding = () => [...candidates(), ...members, ...parents().flatMap((p) => [...p.children].filter((n) => !n.classList.contains('wv-reorder-lift')))];
    const moveTo = (place) => slide(sliding(), () => place());
    const reposition = (p) => {
      const list = candidates();
      if (!list.length) return;
      const rects = list.map((n) => n.getBoundingClientRect());
      const i = nearest(rects, p.x, p.y);
      if (i < 0) return;
      const node = list[i];
      const goesBefore = Boolean(tail?.(node)) || before(rects[i], p.x, p.y, axis);
      placed = { node, before: goesBefore, point: p, start };
      onPlace?.(placed);
      const same = goesBefore ? skipNext(members[members.length - 1]) === node : skipNext(node) === source;
      if (same) return;
      moveTo(() => { if (goesBefore) node.before(...members); else node.after(...members); });
    };
    const outside = (p) => {
      const box = zone?.()?.getBoundingClientRect?.();
      if (!box) return false;
      const m = 48;
      return p.x < box.left - m || p.x > box.right + m || p.y < box.top - m || p.y > box.bottom + m;
    };
    let hosts = [];
    const finishWith = (home) => {
      auto?.stop();
      for (const h of hosts) h.classList.remove('wv-reorder-host');
      const back = () => {
        if (origin.next && origin.next.parentNode === origin.parent && !members.includes(origin.next)) origin.next.before(...members);
        else origin.parent.append(...members);
      };
      if (home) {
        const there = skipNext(members[members.length - 1]) === origin.next && source.parentNode === origin.parent;
        if (!there) moveTo(back);
      }
      const to = settledRect(source);
      for (const m of members) m.classList.add('wv-reorder-settle');
      const reveal = () => { for (const m of members) m.classList.remove('wv-reorder-slot', 'wv-reorder-settle'); };
      clone.settle(to).then(reveal);
      if (reduced()) reveal();
      return home;
    };
    return press(down, {
      lift: (p, s) => {
        start = s;
        members = memberFn ? memberFn() : [source];
        origin = { parent: source.parentNode, next: skipNext(members[members.length - 1]) };
        clone = liftOf(source);
        for (const m of members) m.classList.add('wv-reorder-slot');
        hosts = [...new Set([origin.parent, ...items().map((n) => n.parentElement)].filter(Boolean))];
        for (const h of hosts) h.classList.add('wv-reorder-host');
        auto = autoScroll({ scroller: scroller ?? scrollParent(source.parentElement, axis), axis, point: () => last, onScroll: () => reposition(last) });
        last = p;
        follow(p);
        reposition(p);
      },
      move: (p) => {
        last = p;
        follow(p);
        reposition(p);
        auto.kick();
      },
      drop: (p) => {
        last = p;
        if (outside(p)) { finishWith(true); onCancel?.(); return; }
        const moved = !(skipNext(members[members.length - 1]) === origin.next && source.parentNode === origin.parent);
        finishWith(false);
        if (moved) onDrop?.({ ...placed, point: p, start });
      },
      cancel: () => { finishWith(true); onCancel?.(); },
    });
  }

  root.WeaveReorder = {
    HOLD_MS, MOUSE_SLOP, TOUCH_SLOP, BAND, STEP,
    edgeSpeed, nearest, before, columnShift, gapStart,
    reduced, lifting, guard, press, liftOf, scrollParent, autoScroll, slide, settledRect, sortable,
  };
})(globalThis);
