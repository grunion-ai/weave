/* The row window, the pure half (Issue #271).

   A grid draws the rows in view plus a buffer and stands two spacer rows in
   for the rest, so the scrollbar and the scroll position stay honest while
   the DOM holds a hundred rows instead of two thousand. The buffer is one
   viewport of rows (never fewer than 20), doubled AHEAD of the direction of
   travel so the next rows are painted before they scroll in, single behind.
   Data comes in pages of PAGE rows in the table's sort and filter order; the
   page past the window's leading edge is the one to have ready.

   Geometry is body-relative throughout: `scrollTop` is how many pixels of
   the <tbody> sit above the viewport's top edge, whichever box scrolls (the
   grid's own wrap, or the page), and `headH` is the sticky header covering
   that edge. No DOM here — public/app.js measures and paints. */
(() => {
  const PAGE = 200;
  const MIN_BUFFER = 20;
  // Fallbacks until a row has painted; both densities, measured in Chromium.
  const ROW_H = { comfortable: 38, compact: 24 };
  const pageOf = (i, page) => Math.floor(i / page) * page;

  globalThis.WeaveGridWindow = {
    PAGE,
    ROW_H,

    /* { scrollTop, viewportH, rowH, total, direction? } →
       { start, end, topPad, bottomPad, prefetchOffset }
       Rows [start, end) are real; topPad and bottomPad are the spacer heights
       in px; prefetchOffset is the offset of the page to fetch next, or null
       when there is none (loaded or not — the caller knows which pages it
       holds). direction: 1 down (default), -1 up. */
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

    /* The page offsets a window [start, end) touches, ascending. */
    pagesFor({ start, end }, page = PAGE, total = Infinity) {
      const out = [];
      const stop = Math.min(end, total);
      for (let o = pageOf(start, page); o < stop; o += page) out.push(o);
      return out;
    },

    /* The body-relative scrollTop that puts row `index` in view with the least
       motion — unchanged when it already is, at the bottom edge when it is
       below, just under the header when it is above (or hidden under it). */
    scrollTopFor({ index, rowH, viewportH, headH = 0, scrollTop }) {
      const top = index * rowH, bottom = top + rowH;
      if (top - scrollTop < headH) return top - headH;
      if (bottom - scrollTop > viewportH) return bottom - viewportH;
      return scrollTop;
    },
  };
})();
