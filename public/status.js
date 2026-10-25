const $ = (selector) => document.querySelector(selector);
const labels = { operational: 'Operational', degraded: 'Degraded performance', outage: 'Outage', unknown: 'No current data' };
const summaries = { operational: 'All systems operational', degraded: 'Some systems are degraded', outage: 'Service disruption', unknown: 'Current status unavailable' };
const status = (value) => Object.hasOwn(labels, value) ? value : 'unknown';
const fresh = (value) => Number.isFinite(Date.parse(value)) && Math.abs(Date.now() - Date.parse(value)) < 180000;
const date = (value, dayOnly = false) => !Number.isFinite(Date.parse(value)) ? 'Unknown time' : new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...(dayOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }).format(new Date(value));
const percent = (value) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : null;
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
let data;
let visibleIncidents = 10;
let loading = false;
let previousComponents;
let previousIncidents;
function component(item, generatedAt) {
  const root = element('article', 'component');
  root.dataset.id = item.id;
  root.dataset.status = fresh(item.checkedAt) ? status(item.status) : 'unknown';
  const heading = element('div', 'component-heading');
  heading.append(element('h3', '', item.name), element('span', 'component-status', labels[root.dataset.status]));
  const uptime = percent(item.uptimePercent);
  const meta = element('p', 'component-meta', `${uptime ? `${uptime} uptime across recorded checks` : 'Uptime not yet available'}${Number.isFinite(item.latencyMs) ? ` · ${Math.round(item.latencyMs)} ms last response` : ''}${item.checkedAt ? ` · Checked ${date(item.checkedAt)} UTC` : ''}`);
  const bars = element('div', 'bars');
  bars.setAttribute('role', 'group');
  bars.setAttribute('aria-label', `${item.name} daily uptime. Use arrow keys to explore.`);
  const detail = element('p', 'day-detail', 'Select a day to view monitoring details.');
  const days = new Map((item.days || []).map((day) => [day.date, day]));
  const today = Date.parse(`${generatedAt.slice(0, 10)}T00:00:00Z`);
  for (let i = 89; i >= 0; i--) {
    const key = new Date(today - i * 86400000).toISOString().slice(0, 10);
    const day = days.get(key);
    const known = day && day.checks > 0;
    const text = `${date(key, true)}: ${known ? `${labels[status(day.status)]}, ${percent(day.uptimePercent) ?? 'unknown'} uptime, ${day.checks} checks, ${day.failures} failed` : 'No monitoring data'}`;
    const bar = element('button', 'day');
    bar.type = 'button';
    bar.dataset.date = key;
    bar.dataset.status = known ? status(day.status) : 'unknown';
    bar.tabIndex = i === 0 ? 0 : -1;
    bar.setAttribute('aria-label', text);
    bar.title = text;
    const show = () => { detail.textContent = text; };
    bar.addEventListener('pointerenter', show);
    bar.addEventListener('click', show);
    bar.addEventListener('focus', () => { bars.querySelector('[tabindex="0"]').tabIndex = -1; bar.tabIndex = 0; show(); });
    bar.addEventListener('keydown', (event) => {
      const target = event.key === 'ArrowLeft' ? bar.previousElementSibling : event.key === 'ArrowRight' ? bar.nextElementSibling : event.key === 'Home' ? bars.firstElementChild : event.key === 'End' ? bars.lastElementChild : null;
      if (target) { event.preventDefault(); target.focus(); }
    });
    bars.append(bar);
  }
  const axis = element('div', 'uptime-axis');
  axis.append(element('span', '', '89 days ago'), element('span', '', 'Today'));
  root.append(heading, meta, bars, axis, detail);
  return root;
}
function incident(item) {
  const root = element('article', 'incident');
  root.dataset.status = item.status === 'resolved' ? 'operational' : item.impact === 'major' ? 'outage' : item.impact === 'minor' ? 'degraded' : status(item.impact);
  const heading = element('div', 'incident-heading');
  heading.append(element('h3', '', item.title), element('span', 'incident-state', item.status.charAt(0).toUpperCase() + item.status.slice(1)));
  const updates = element('ol', 'updates');
  for (const update of [...item.updates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const row = element('li', 'update');
    const time = element('time', '', `${date(update.createdAt)} UTC`);
    time.dateTime = update.createdAt;
    row.append(element('span', 'update-label', update.status.charAt(0).toUpperCase() + update.status.slice(1)), element('p', '', update.message), time);
    updates.append(row);
  }
  root.append(heading, element('p', 'incident-date', `${date(item.startedAt)} UTC${item.automatic ? ' · Detected by monitoring' : ''}`), updates);
  return root;
}
function renderIncidents() {
  const active = data.incidents.filter((item) => item.status !== 'resolved');
  const past = data.incidents.filter((item) => item.status === 'resolved');
  $('#active-incidents').hidden = !active.length;
  $('#active-incidents').replaceChildren(element('h2', '', 'Active incidents'), ...active.map(incident));
  $('#incidents').replaceChildren(...(past.length ? past.slice(0, visibleIncidents).map(incident) : [element('p', 'empty', 'No incidents recorded.')]));
  $('#more').hidden = visibleIncidents >= past.length;
}
function render() {
  const isFresh = fresh(data.checkedAt);
  const current = isFresh ? status(data.status) : 'unknown';
  $('#overall').dataset.status = current;
  $('#summary').textContent = summaries[current];
  $('#checked').textContent = data.checkedAt ? `${isFresh ? 'Last checked' : 'Monitoring data is delayed. Last checked'} ${date(data.checkedAt)} UTC` : 'Waiting for the first monitoring check.';
  const components = JSON.stringify(data.components.map((item) => ({ ...item, status: fresh(item.checkedAt) ? item.status : 'unknown' })));
  if (components !== previousComponents) {
    const focused = document.activeElement;
    const selected = focused?.classList.contains('day') && { id: focused.closest('.component').dataset.id, date: focused.dataset.date };
    $('#components').replaceChildren(...data.components.map((item) => component(item, data.generatedAt)));
    if (selected) {
      const row = [...document.querySelectorAll('.component')].find((item) => item.dataset.id === selected.id);
      [...(row?.querySelectorAll('.day') || [])].find((item) => item.dataset.date === selected.date)?.focus({ preventScroll: true });
    }
    previousComponents = components;
  }
  const incidents = JSON.stringify(data.incidents);
  if (incidents !== previousIncidents) { renderIncidents(); previousIncidents = incidents; }
}
async function refresh() {
  if (loading) return;
  loading = true;
  $('#refresh').disabled = true;
  $('#retry').disabled = true;
  try {
    const response = await fetch(document.body.dataset.api, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Status unavailable');
    const result = await response.json();
    if (!Array.isArray(result.components) || !Array.isArray(result.incidents) || !Number.isFinite(Date.parse(result.generatedAt)) || result.components.some((item) => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.days)) || result.incidents.some((item) => !item || typeof item.status !== 'string' || typeof item.startedAt !== 'string' || !Array.isArray(item.updates) || item.updates.some((update) => typeof update.status !== 'string' || typeof update.createdAt !== 'string'))) throw new Error('Invalid status data');
    data = result;
    render();
    $('#error').hidden = true;
  } catch {
    previousComponents = undefined;
    for (const row of document.querySelectorAll('.component')) {
      row.dataset.status = 'unknown';
      row.querySelector('.component-status').textContent = labels.unknown;
    }
    $('#overall').dataset.status = 'unknown';
    $('#summary').textContent = summaries.unknown;
    $('#error-message').textContent = data ? 'Status updates are unavailable. Displayed data may be out of date.' : 'Status could not be loaded. Try again to check service availability.';
    $('#error').hidden = false;
    if (!data) {
      $('#checked').textContent = 'The monitoring service could not be reached.';
      $('#components').replaceChildren(element('p', 'empty', 'Service status is unavailable.'));
      $('#incidents').replaceChildren(element('p', 'empty', 'Incident history is unavailable.'));
    }
  } finally {
    loading = false;
    $('#refresh').disabled = false;
    $('#retry').disabled = false;
  }
}
$('#refresh').addEventListener('click', refresh);
$('#retry').addEventListener('click', refresh);
$('#more').addEventListener('click', () => { visibleIncidents += 10; renderIncidents(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
refresh();
