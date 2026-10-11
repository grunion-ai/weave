(function (root) {
  const KIND_GLYPH = { entity: '#', table: '▦', space: '◇', workspace: '⬡' };
  const CARET = '›';
  const COMPUTED_GLYPHS = { formula: 'ƒ', rollup: 'Σ', lookup: '↳' };
  const ROUTE_GLYPH = '→';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const attr = (name, value) => (value == null || value === '' ? '' : ` ${name}="${esc(value)}"`);

  function iconHtml(icon, cls = 'ico wv-icon') {
    if (!icon) return '';
    const marks = root.weaveMarkIcons;
    const reg = root.weaveIconRegistry;
    const lucide = root.LUCIDE_MOVING;
    const name = marks?.twin(icon) ?? reg?.resolve(icon);
    if (name && lucide?.[name]) {
      return `<span class="${cls} mi mi-${name}" data-ms="${reg?.MOTION?.[name] || 0}">${lucide[name]}</span>`;
    }
    const mark = marks?.markSvg(icon);
    if (mark) {
      return `<span class="${cls}"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">${mark}</svg></span>`;
    }
    return '';
  }

  const hueOf = (x) => root.chipCore?.hueName(x?.hue) ?? 'slate';

  function stateClass(seg) {
    const core = root.chipCore;
    const cat = core.categoryOrDefault(seg.category);
    return `k k-state cat-${cat} hue-${core.stateHue(seg, cat)}`;
  }

  function meterHtml(meter, text) {
    const cg = root.weaveCellGraphics;
    if (!cg?.isGraphic(meter.display)) return esc(text);
    const shown = String(text ?? meter.value ?? '');
    return `<span class="cg-wrap cg-${esc(meter.display)} ${cg.colorClass(meter.color)}" role="img"`
      + attr('aria-label', shown) + attr('title', cg.meterTitle(shown, meter.value, meter.scale, null)) + '>'
      + cg.meterSvg(meter.display, cg.share(meter.value, meter.scale) ?? 0)
      + `<span class="cg-text" aria-hidden="true">${esc(shown)}</span></span>`;
  }

  function sparkHtml(spark, text) {
    const cg = root.weaveCellGraphics;
    const svg = cg?.sparkSvg(spark.style || 'line', spark.values);
    if (!svg) return esc(text);
    return `<span class="cg-wrap cg-sparkwrap cg-${esc(spark.style || 'line')} ${cg.colorClass(spark.color)}" role="img"`
      + attr('aria-label', cg.sparkLabel(spark.values)) + attr('title', cg.sparkTitle(spark.values)) + `>${svg}</span>`;
  }

  function oneRating(rating, value, title) {
    const cg = root.weaveCellGraphics;
    const { filled, max, label } = cg.ratingParts(value, rating.max);
    const glyph = iconHtml(rating.icon || 'lucide:star', 'wv-icon') || '★';
    const pips = Array.from({ length: max }, (_, i) =>
      `<span class="wv-rate-ico${i < filled ? ' on' : ''}" aria-hidden="true">${glyph}</span>`).join('');
    return `<span class="wv-rating ${cg.colorClass(rating.color)}" role="img" data-max="${max}"`
      + ` data-hue="${esc(cg.ratingHue(rating.icon))}" data-value="${value == null ? '' : esc(value)}"`
      + attr('aria-label', label) + attr('title', title ?? label) + '>'
      + `<span class="wv-rating-compact" aria-hidden="true"><span class="wv-rate-mini${filled > 0 ? ' on' : ''}">${glyph}</span>`
      + `<span class="wv-rating-n">${filled}/${max}</span></span>${pips}</span>`;
  }

  function ratingHtml(rating, label) {
    if (!rating.values) return oneRating(rating, rating.value, null);
    return `<span class="ms-box wv-rating-list" role="group"${attr('aria-label', label)}>`
      + rating.values.map((v) => oneRating({ ...rating, value: v }, typeof v === 'number' ? v : null, null)).join('')
      + '</span>';
  }

  function valueHtml(seg) {
    if (seg.spark) return sparkHtml(seg.spark, seg.value);
    if (seg.rating) return ratingHtml(seg.rating, seg.label);
    if (seg.meter) return meterHtml(seg.meter, seg.value);
    return esc(seg.value);
  }

  function segHtml(seg) {
    if (seg.kind === 'state') {
      return `<button type="button" class="${stateClass(seg)} wv-chip-mark" data-seg="state"`
        + attr('data-field', seg.label) + attr('title', `${seg.label}: ${seg.value} (click to change)`)
        + `>${esc(seg.value)}</button>`;
    }
    if (seg.type === 'select' && seg.option) {
      return `<button type="button" class="k k-select hue-${hueOf(seg.option)}" data-seg="select"`
        + attr('data-field', seg.label) + attr('title', `${seg.label}: ${seg.value} (click to change)`)
        + `>${iconHtml(seg.option.icon)}${esc(seg.value)}</button>`;
    }
    if (seg.type === 'multiselect' && seg.options) {
      return `<button type="button" class="mention-f" data-seg="multiselect"`
        + attr('data-field', seg.label) + attr('title', `${seg.label} (click to change)`)
        + `><span class="mention-f-label">${esc(seg.label)}</span>`
        + seg.options.map((o) => `<span class="k k-multi hue-${hueOf(o)}">${iconHtml(o.icon)}${esc(o.name)}</span>`).join('')
        + '</button>';
    }
    const mark = COMPUTED_GLYPHS[seg.type];
    return `<span class="mention-f" data-seg="field"${attr('data-field', seg.label)}>`
      + `<span class="mention-f-label">${esc(seg.label)}`
      + (mark ? `<sup class="field-mark"${attr('title', `${seg.type} — computed from other values, not editable`)}>${mark}</sup>` : '')
      + `</span>${valueHtml(seg)}</span>`;
  }

  function chipHtml(v, { kind = 'entity', href = null, home = null, removable = false, broken = false, label = null } = {}) {
    const title = label ?? String(v?.name ?? '');
    if (broken || !href) return `<span class="mention broken">${esc(title)}</span>`;
    const segs = root.weaveViewCore.viewSegments(v);
    const state = segs.find((s) => s.kind === 'state');
    const rest = segs.filter((s) => s !== state);
    const id = kind === 'entity' && v?.link && v?.publicId != null ? `#${v.publicId}` : null;
    const cls = ['k', 'k-rel', `kind-${kind}`];
    if (id) cls.push('has-id');
    if (rest.length) cls.push('has-segs');
    return `<span class="${cls.join(' ')}"${attr('data-eid', kind === 'entity' ? v?.id : null)}>`
      + (state ? segHtml(state) : '')
      + `<a class="mention mention-${kind}" href="${esc(href)}"${attr('title', title)}${attr('data-name', v?.name)}>`
      + (id ? `<span class="wv-chip-id">${esc(id)}</span>` : '')
      + `<span class="k-label">${esc(title)}</span></a>`
      + (rest.length ? `<span class="mention-fields">${rest.map(segHtml).join('')}</span>` : '')
      + (home ? `<span class="k-home">${esc(home)}</span>` : '')
      + (rest.length ? `<button type="button" class="mention-caret" aria-expanded="false" title="Show fields">${CARET}</button>` : '')
      + (removable ? `<button type="button" class="x" data-seg="remove" title="Remove">${iconHtml('lucide:x', 'wv-icon wv-icon-xs')}</button>` : '')
      + '</span>';
  }

  function cardHtml(v, { href = null, cover = null, compact = false } = {}) {
    const segs = root.weaveViewCore.viewSegments(v);
    const state = segs.find((s) => s.kind === 'state');
    const fields = segs.filter((s) => s.kind !== 'state');
    const id = v?.link && v?.publicId != null ? `#${v.publicId}` : '';
    return `<div class="wv-card${compact ? ' compact' : ''}" data-eid="${esc(v?.id)}">`
      + (cover ? `<span class="wv-card-cover"><img src="${esc(cover)}" alt=""></span>` : '')
      + '<div class="wv-card-head">'
      + `<a class="wv-card-title" href="${esc(href ?? `#/entity/${v?.id}`)}">`
      + (id ? `<span class="wv-card-id">${esc(id)}</span>` : '')
      + `${esc(v?.name || (v?.link ? '' : id))}</a></div>`
      + (v?.description ? `<div class="wv-card-desc">${esc(v.description)}</div>` : '')
      + (state ? `<div class="wv-card-state">${segHtml(state)}</div>` : '')
      + (fields.length
        ? `<dl class="wv-card-fields">${fields.map((f) =>
          `<dt>${esc(f.label)}</dt><dd${attr('data-field', f.label)}>${valueHtml(f)}</dd>`).join('')}</dl>`
        : '')
      + '</div>';
  }

  root.weaveChipView = { KIND_GLYPH, CARET, COMPUTED_GLYPHS, ROUTE_GLYPH, chipHtml, cardHtml, segHtml, valueHtml, stateClass, iconHtml, esc };
})(typeof window !== 'undefined' ? window : globalThis);
