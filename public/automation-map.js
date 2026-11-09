'use strict';
const AUTO_ACTION = { 'set-field': (x) => `set ${x.field}`, 'append-doc': (x) => `append ${x.field}`, 'add-comment': () => 'comment' };

function automationTrigger(t) {
  return t.type === 'state-changed' ? `${t.field}→${t.toState ?? '*'}`
    : t.type === 'field-updated' ? `${t.field} changed`
    : t.type === 'schedule' ? `cron ${t.cron}` : 'created';
}

function drawAutomationPills(svg, n, list) {
  const y = n.y - n.h / 2;
  list.forEach((a, i) => {
    const ay = y + n.h + 6 + i * 25;
    const actions = a.actions.map((x) => (AUTO_ACTION[x.type] ?? (() => 'webhook'))(x)).join(', ');
    const full = `⚡ ${automationTrigger(a.trigger)} ⇒ ${actions}`;
    const fits = Math.floor((n.w - 16) / 5.8);
    const label = full.length > fits ? full.slice(0, fits - 1).trimEnd() + '…' : full;
    const tw = Math.min(n.w, label.length * 5.8 + 14);
    svg.append(svgEl('line', { x1: n.x, y1: y + n.h, x2: n.x, y2: ay, class: 'auto-line' }));
    const pill = svgEl('g', { class: 'auto' });
    pill.append(svgEl('title', {}, full));
    pill.append(svgEl('rect', { x: n.x - tw / 2, y: ay, width: tw, height: 17, rx: 8.5, class: 'auto-pill' + (a.enabled ? '' : ' off') }));
    pill.append(svgEl('text', { x: n.x, y: ay + 12, 'text-anchor': 'middle', class: 'auto-label' }, label));
    svg.append(pill);
  });
}
