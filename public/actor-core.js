(() => {
  const displayName = (handle) => String(handle ?? '').split(/[\s._-]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

  const parseActor = (actor) => {
    const s = String(actor ?? '').trim();
    if (!s) return { kind: 'none' };
    let m = /^workflow:(.+)$/.exec(s);
    if (m) return { kind: 'workflow', workflowId: m[1] };
    m = /^mcp:(.+)$/.exec(s) ?? /^(.+?) via .+$/.exec(s);
    if (m) return { kind: 'person', handle: m[1], name: displayName(m[1]), via: 'MCP' };
    return { kind: 'person', handle: s, name: displayName(s), via: null };
  };

  const actorText = (actor) => {
    const a = parseActor(actor);
    if (a.kind === 'none') return '';
    if (a.kind === 'workflow') return 'Automation';
    return a.via ? `${a.name} via ${a.via}` : String(actor).trim();
  };

  const workflowOf = (a) => /^workflow:(.+)$/.exec(a?.actor ?? '')?.[1] ?? null;
  const isAutomation = (a) => !!workflowOf(a) || a?.kind === 'automation-ran';

  const automationWrites = (activity, { now = Date.now(), windowMs = 10000 } = {}) => {
    const list = Array.isArray(activity) ? activity : [];
    let i = list.length;
    while (i > 0 && isAutomation(list[i - 1])) i -= 1;
    const tail = list.slice(i).filter((a) => !(Date.parse(a.ts) < now - windowMs));
    if (!tail.length) return null;
    const runs = [];
    const fields = [];
    let cur = { workflowId: null, fields: [] };
    for (const a of tail) {
      const wf = workflowOf(a);
      const f = wf ? a.detail?.field : null;
      if (wf) cur.workflowId = wf;
      if (f && !cur.fields.includes(f)) cur.fields.push(f);
      if (f && !fields.includes(f)) fields.push(f);
      if (a.kind === 'automation-ran') {
        runs.push({ name: a.detail?.name ?? null, workflowId: a.detail?.workflow ?? cur.workflowId ?? wf, fields: cur.fields });
        cur = { workflowId: null, fields: [] };
      }
    }
    if (cur.workflowId) runs.push({ name: null, workflowId: cur.workflowId, fields: cur.fields });
    const seq = Math.max(0, ...tail.map((a) => Number(a.seq) || 0));
    return { runs, fields, seq };
  };

  globalThis.weaveActor = { displayName, parseActor, actorText, automationWrites };
})();
