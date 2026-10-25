(() => {
  const PAGE = 200;
  const BATCH = 400;
  const MIN_BUFFER = 20;
  const LEAD = 3;
  const ROW_H = { compact: 32, comfortable: 44, spacious: 72 };

  globalThis.WeaveGridWindow = {
    PAGE,
    BATCH,
    ROW_H,

    windowFor({ scrollTop, viewportH, rowH, total }) {
      const h = Number.isFinite(rowH) && rowH > 0 ? rowH : ROW_H.comfortable;
      if (!(total > 0)) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
      const top = Math.max(0, Math.min(Number(scrollTop) || 0, total * h));
      const visible = Math.max(1, Math.ceil((Number(viewportH) || 0) / h));
      const buffer = Math.max(MIN_BUFFER, visible);
      const first = Math.min(total - 1, Math.floor(top / h));
      const start = Math.max(0, first - 2 * buffer);
      const end = Math.min(total, first + visible + 2 * buffer);
      return { start, end, topPad: start * h, bottomPad: (total - end) * h };
    },

    feedFor({ scrollTop, viewportH, rowH, loaded, total, lead = LEAD }) {
      const h = Number.isFinite(rowH) && rowH > 0 ? rowH : ROW_H.comfortable;
      if (!(loaded < total)) return null;
      const screen = Math.max(Number(viewportH) || 0, h);
      const left = loaded * h - ((Number(scrollTop) || 0) + screen);
      return left <= lead * screen ? loaded : null;
    },

    scrollTopFor({ index, rowH, viewportH, headH = 0, scrollTop }) {
      const top = index * rowH, bottom = top + rowH;
      if (top - scrollTop < headH) return top - headH;
      if (bottom - scrollTop > viewportH) return bottom - viewportH;
      return scrollTop;
    },
  };
})();
