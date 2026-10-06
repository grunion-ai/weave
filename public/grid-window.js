(() => {
  const PAGE = 200;
  const MIN_BUFFER = 20;
  const ROW_H = { compact: 32, comfortable: 44, spacious: 72 };
  const pageOf = (i, page) => Math.floor(i / page) * page;

  globalThis.WeaveGridWindow = {
    PAGE,
    ROW_H,

    windowFor({ scrollTop, viewportH, rowH, total, direction = 1, page = PAGE }) {
      const h = Number.isFinite(rowH) && rowH > 0 ? rowH : ROW_H.comfortable;
      if (!(total > 0)) return { start: 0, end: 0, topPad: 0, bottomPad: 0, prefetchOffset: null };
      const top = Math.max(0, Math.min(Number(scrollTop) || 0, total * h));
      const visible = Math.max(1, Math.ceil((Number(viewportH) || 0) / h));
      const buffer = Math.max(MIN_BUFFER, visible);
      const first = Math.min(total - 1, Math.floor(top / h));
      const down = direction >= 0;
      const start = Math.max(0, first - (down ? buffer : 2 * buffer));
      const end = Math.min(total, first + visible + (down ? 2 * buffer : buffer));
      const edge = down ? pageOf(end - 1, page) + page : pageOf(start, page) - page;
      const prefetchOffset = edge >= 0 && edge < total ? edge : null;
      return { start, end, topPad: start * h, bottomPad: (total - end) * h, prefetchOffset };
    },

    pagesFor({ start, end }, page = PAGE, total = Infinity) {
      const out = [];
      const stop = Math.min(end, total);
      for (let o = pageOf(start, page); o < stop; o += page) out.push(o);
      return out;
    },

    travelFor({ scrollTop, lastTop, direction = 1, rowH }) {
      const h = Number.isFinite(rowH) && rowH > 0 ? rowH : ROW_H.comfortable;
      const top = Number(scrollTop) || 0;
      const moved = top - (Number(lastTop) || 0);
      if (Math.abs(moved) < h) return { direction, lastTop: Number(lastTop) || 0 };
      return { direction: moved > 0 ? 1 : -1, lastTop: top };
    },

    scrollTopFor({ index, rowH, viewportH, headH = 0, scrollTop }) {
      const top = index * rowH, bottom = top + rowH;
      if (top - scrollTop < headH) return top - headH;
      if (bottom - scrollTop > viewportH) return bottom - viewportH;
      return scrollTop;
    },
  };
})();
