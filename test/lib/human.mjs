export function human(page) {
  const loc = (target) => (typeof target === 'string' ? page.locator(target).first() : target);
  const at = async (target) => {
    const l = loc(target);
    await l.waitFor({ state: 'visible' });
    await l.scrollIntoViewIfNeeded();
    const box = await l.boundingBox();
    if (!box) throw new Error(`${target} has no box`);
    return { l, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  return {
    async click(target) {
      const { l, x, y } = await at(target);
      const hit = await l.evaluate((n, [px, py]) => {
        const e = document.elementFromPoint(px, py);
        return !e || n === e || n.contains(e) || e.contains(n) ? null : `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`;
      }, [x, y]);
      if (hit) throw new Error(`${target} is covered at its centre by ${hit}`);
      await page.mouse.click(x, y);
    },
    async pick(label) {
      const row = page.locator('.picker-pop .picker-row').filter({ has: page.locator('.picker-label', { hasText: new RegExp(`^${label}$`) }) }).first();
      await this.click(row);
    },
  };
}

export function covering(page, scope) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].flatMap((n) => {
    const r = n.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || getComputedStyle(n).visibility === 'hidden') return [];
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return [];
    for (let p = n.parentElement; p; p = p.parentElement) {
      if (!/auto|scroll|hidden/.test(getComputedStyle(p).overflowY)) continue;
      const b = p.getBoundingClientRect();
      if (y < b.top || y > b.bottom || x < b.left || x > b.right) return [];
    }
    const name = (m) => `${m.tagName.toLowerCase()}.${[...m.classList].join('.')}`;
    const over = [r.left + 3, x, r.right - 3].map((px) => document.elementFromPoint(px, y)).find((e) => e && !(n === e || n.contains(e) || e.contains(n)));
    return over ? [`${name(n)} "${n.textContent.trim().slice(0, 24)}" under ${name(over)}`] : [];
  }), scope);
}
