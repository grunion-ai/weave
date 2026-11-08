'use strict';
(function (root) {
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 8;
  const clamp = (k) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

  function boardSource(source) {
    return String(source ?? '').replace(/\\n/g, '<br/>');
  }

  function panZoom(body, stage) {
    const view = { x: 0, y: 0, k: 1 };
    const paint = () => { stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; };
    const svg = stage.querySelector('svg');
    const w = svg?.viewBox?.baseVal?.width || stage.offsetWidth || 1;
    const h = svg?.viewBox?.baseVal?.height || stage.offsetHeight || 1;
    if (svg) { svg.style.maxWidth = 'none'; svg.setAttribute('width', w); svg.setAttribute('height', h); }
    const fit = () => {
      const pad = 80;
      view.k = clamp(Math.min((body.clientWidth - pad) / w, (body.clientHeight - pad) / h, 2));
      view.x = (body.clientWidth - w * view.k) / 2;
      view.y = (body.clientHeight - h * view.k) / 2;
      paint();
    };
    body.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = body.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const k = clamp(view.k * Math.exp(-e.deltaY * 0.002));
      view.x = px - ((px - view.x) * k) / view.k;
      view.y = py - ((py - view.y) * k) / view.k;
      view.k = k;
      paint();
    }, { passive: false });
    let drag = null;
    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX - view.x, y: e.clientY - view.y };
      body.setPointerCapture?.(e.pointerId);
      body.style.cursor = 'grabbing';
    });
    body.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      view.x = e.clientX - drag.x;
      view.y = e.clientY - drag.y;
      paint();
    });
    const end = () => { drag = null; body.style.cursor = 'grab'; };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
    body.addEventListener('dblclick', fit);
    requestAnimationFrame(fit);
    return view;
  }

  async function drawWhiteboard(body, source, mermaidReady) {
    Object.assign(body.style, { position: 'relative', overflow: 'hidden', cursor: 'grab', touchAction: 'none' });
    await mermaidReady;
    if (!root.mermaid) { body.textContent = 'mermaid failed to load'; return null; }
    const stage = document.createElement('div');
    stage.className = 'wb-stage';
    Object.assign(stage.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0' });
    const pre = document.createElement('pre');
    pre.className = 'mermaid';
    pre.style.margin = '0';
    pre.textContent = boardSource(source);
    stage.append(pre);
    body.replaceChildren(stage);
    try { await root.mermaid.run({ nodes: [pre] }); } catch {}
    if (!pre.querySelector('svg')) { body.textContent = 'Nothing drawable in this diagram.'; return null; }
    body.weaveBoard = panZoom(body, stage);
    return body.weaveBoard;
  }

  root.weaveWhiteboard = { boardSource, drawWhiteboard };
})(typeof window !== 'undefined' ? window : globalThis);
