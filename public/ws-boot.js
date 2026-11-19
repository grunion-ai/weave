(function (win) {
  const KEY = 'weave-ws-rail';
  const doc = win.document;
  const segment = (path) => (/^\/w\/([^/]+)/.exec(path) ?? [null, null])[1];
  const rail = {
    key: KEY,
    painted: null,
    read() {
      try {
        const held = JSON.parse(win.localStorage.getItem(KEY));
        return Array.isArray(held?.chips) && held.chips.every((c) => c && typeof c.id === 'string' && typeof c.name === 'string') ? held.chips : null;
      } catch { return null; }
    },
    write(chips) {
      try { win.localStorage.setItem(KEY, JSON.stringify({ chips })); } catch {}
    },
    forget() {
      try { win.localStorage.removeItem(KEY); } catch {}
    },
    currentOf(chips, path) {
      const seg = segment(path);
      return (seg
        ? chips.find((c) => !c.held && (c.id === seg || c.name === seg))
        : chips.find((c) => !c.held && c.bare)) ?? null;
    },
    order(chips, current) {
      return [...chips.filter((c) => c === current), ...chips.filter((c) => c !== current)];
    },
    chipEl(c, { current = false, afterFallback = null } = {}) {
      const chip = doc.createElement('a');
      chip.className = c.cls + (current ? ' active' : '');
      chip.href = c.href;
      if (c.held) {
        chip.title = c.title;
        chip.setAttribute('aria-label', c.title);
      } else chip.title = c.title + (current ? ' (click for the menu)' : ' (right-click for the menu)');
      if (c.logo) {
        const img = doc.createElement('img');
        img.src = c.logo;
        img.alt = c.name;
        img.addEventListener('error', () => {
          for (const cls of c.fallback.split(' ')) chip.classList.add(cls);
          chip.replaceChildren(c.letter);
          if (afterFallback) afterFallback();
        });
        chip.append(img);
      } else chip.append(c.letter);
      return chip;
    },
    paint(path) {
      const box = doc.getElementById('ws-list');
      const chips = box && !box.children.length ? rail.read() : null;
      if (!chips) return null;
      const current = rail.currentOf(chips, path);
      if (!current) return null;
      box.replaceChildren(...rail.order(chips, current).filter((c) => !c.pinned).map((c) => rail.chipEl(c, { current: c === current })));
      const pinned = doc.getElementById('rail-weave');
      if (pinned && current.pinned) {
        pinned.href = current.href;
        pinned.classList.add('active');
      }
      const wordmark = doc.getElementById('ws-name');
      if (wordmark) {
        wordmark.textContent = current.name;
        wordmark.href = `${(/^\/w\/[^/]+/.exec(path) ?? [''])[0]}/`;
        wordmark.title = `Open the ${current.name} workspace page`;
      }
      rail.painted = current.name;
      return current.name;
    },
  };
  win.weaveWsRail = rail;
  rail.paint(win.location.pathname);
})(window);
