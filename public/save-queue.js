(function (root) {
  const DEBOUNCE_MS = 600;
  const TICK_MS = 2000;
  const retryable = (err) => err?.code === 'offline' || !err?.status || err.status >= 500;

  function createSaveQueue({ send, delay = DEBOUNCE_MS, tick = TICK_MS, timers = root, onFail = () => {}, retry = retryable } = {}) {
    const due = new Map();
    const failed = new Map();
    const line = [];
    const listeners = new Set();
    const hearers = new Set();
    let inFlight = 0;
    let pumping = null;
    let ticking = false;
    let tickTimer = null;
    let seq = 0;

    const keyOf = (job) => job.key ?? `${job.entityId}::${job.field}`;
    const state = () => (failed.size ? 'failed'
      : due.size || line.length || inFlight ? 'pending'
        : ticking ? 'saved' : 'idle');
    const pending = () => due.size + line.length + inFlight + failed.size;
    let last = null;
    const emit = () => {
      const now = state();
      const snap = { state: now, pending: pending() };
      if (last && last.state === snap.state && last.pending === snap.pending) return;
      last = snap;
      for (const fn of listeners) fn(snap);
    };

    const attempt = (e) => {
      try { return Promise.resolve((e.job.send ?? send)(e.job)); } catch (err) { return Promise.reject(err); }
    };
    const answer = (e, how, value) => { for (const w of e.waiters) w[how](value); e.waiters = []; };
    const keep = (e, err) => {
      const newer = due.get(e.key);
      if (newer) newer.waiters.push(...e.waiters);
      else failed.set(e.key, e);
      onFail(err, e.job);
    };

    const refuse = (e, err) => (e.job.keep ? keep(e, err) : answer(e, 'reject', err));

    async function sendEntry(e) {
      inFlight++;
      emit();
      let landed = false;
      try {
        let result;
        try { result = await attempt(e); }
        catch (err) {
          if (!retry(err)) { refuse(e, err); return false; }
          try { result = await attempt(e); }
          catch (again) {
            if (retry(again)) keep(e, again);
            else refuse(e, again);
            return false;
          }
        }
        for (const fn of hearers) {
          try { fn(result, e.job); } catch (err) { timers.setTimeout(() => { throw err; }, 0); }
        }
        answer(e, 'resolve', result);
        landed = true;
        return true;
      } finally {
        inFlight--;
        if (landed) ticking = 'due';
        if (!pumping) settle();
      }
    }

    function settle() {
      if (ticking === 'due' && !failed.size && !due.size && !line.length && !inFlight) {
        ticking = true;
        timers.clearTimeout(tickTimer);
        tickTimer = timers.setTimeout(() => { ticking = false; emit(); }, tick);
      } else if (ticking === 'due' && failed.size) ticking = false;
      emit();
    }

    function pump() {
      if (pumping || !line.length) return pumping ?? Promise.resolve();
      pumping = (async () => {
        while (line.length) await sendEntry(line.shift());
        pumping = null;
        settle();
      })();
      return pumping;
    }

    function push(job) {
      const key = keyOf(job);
      const waiters = [];
      for (const from of [failed, due]) {
        const old = from.get(key);
        if (!old) continue;
        timers.clearTimeout(old.timer);
        waiters.push(...old.waiters);
        from.delete(key);
      }
      const entry = { key, job, waiters, seq: ++seq };
      const done = new Promise((resolve, reject) => entry.waiters.push({ resolve, reject }));
      if (ticking === true) { ticking = false; timers.clearTimeout(tickTimer); }
      entry.timer = timers.setTimeout(() => {
        if (due.get(key) !== entry) return;
        due.delete(key);
        line.push(entry);
        pump();
      }, delay);
      due.set(key, entry);
      emit();
      return done;
    }

    function gather() {
      for (const e of due.values()) timers.clearTimeout(e.timer);
      line.push(...failed.values(), ...due.values());
      failed.clear();
      due.clear();
      line.sort((a, b) => a.seq - b.seq);
    }

    function flush({ leaving = false } = {}) {
      gather();
      if (!leaving) return pump();
      const batch = new Map();
      for (const e of line.splice(0)) {
        const prior = batch.get(e.key);
        if (prior) e.waiters.unshift(...prior.waiters);
        batch.delete(e.key);
        batch.set(e.key, e);
      }
      return Promise.all([...batch.values()].map(sendEntry)).then(() => pumping);
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function onSaved(fn) {
      hearers.add(fn);
      return () => hearers.delete(fn);
    }

    return {
      push,
      flush,
      subscribe,
      onSaved,
      get pending() { return pending(); },
      get state() { return state(); },
    };
  }

  function bindPageHide(queue, win = root, doc = root.document) {
    const go = () => queue.flush({ leaving: true });
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') go(); });
    win.addEventListener('pagehide', go);
  }

  function bindEscape(queue, doc = root.document) {
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && queue.pending) queue.flush(); }, true);
  }

  const changes = (n) => `${n} ${n === 1 ? 'change' : 'changes'}`;
  const GLYPH = {
    pending: { icon: 'lucide:clock', label: (n) => `Saving ${changes(n)}. Save now` },
    saved: { icon: 'lucide:check', label: () => 'All changes saved' },
    failed: { icon: 'lucide:circle-alert', label: (n) => `${changes(n)} not saved. Try again` },
  };

  function saveGlyph(queue, { icon, place = () => null, doc = root.document } = {}) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-ghost-secondary save-glyph';
    btn.hidden = true;
    btn.addEventListener('click', (e) => { e.stopPropagation(); queue.flush(); });
    let shown = null;
    const paint = ({ state, pending }) => {
      btn.dataset.state = state;
      btn.hidden = state === 'idle';
      if (state === 'idle') return;
      const g = GLYPH[state];
      const label = g.label(pending);
      btn.setAttribute('aria-label', label);
      btn.title = label;
      if (shown !== g.icon) { btn.replaceChildren(icon(g.icon, 'wv-icon')); shown = g.icon; }
      const home = place();
      if (home && btn.parentNode !== home) home.append(btn);
      else if (!home && !btn.isConnected) { btn.classList.add('save-glyph-float'); doc.body.append(btn); }
      if (home) btn.classList.remove('save-glyph-float');
    };
    queue.subscribe(paint);
    paint({ state: queue.state, pending: queue.pending });
    return btn;
  }

  root.WeaveSaveQueue = { createSaveQueue, bindPageHide, bindEscape, saveGlyph, retryable, DEBOUNCE_MS, TICK_MS };
})(globalThis);
