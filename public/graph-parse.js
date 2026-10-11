(function (root) {
  const SHAPES = [
    [/^\(\((.*)\)\)$/, 'circle'],
    [/^\{(.*)\}$/, 'diamond'],
    [/^\(\[(.*)\]\)$/, 'pill'],
    [/^\[\[(.*)\]\]$/, 'subroutine'],
    [/^\[(.*)\]$/, 'box'],
    [/^\((.*)\)$/, 'round'],
    [/^>(.*)\]$/, 'flag'],
  ];

  const BREAK = /<br\s*\/?>|\\n/gi;
  const withBreaks = (text) => String(text).replace(BREAK, '\n');

  function parseNodeRef(token) {
    const m = token.trim().match(/^([A-Za-z0-9_.:-]+)\s*(.*)$/s);
    if (!m) return null;
    const id = m[1];
    let label = id;
    let shape = 'box';
    const rest = m[2].trim();
    if (rest) {
      for (const [re, sh] of SHAPES) {
        const sm = rest.match(re);
        if (sm) { label = withBreaks(sm[1].replace(/^"|"$/g, '')); shape = sh; break; }
      }
    }
    return { id, label, shape };
  }

  function parseMermaidGraph(src) {
    const nodes = new Map();
    const edges = [];
    let direction = 'TD';
    const seen = (ref) => {
      if (!ref) return null;
      const cur = nodes.get(ref.id);
      if (!cur || (ref.label !== ref.id && cur.label === cur.id)) nodes.set(ref.id, ref);
      return ref.id;
    };
    for (const raw of String(src ?? '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('%%')) continue;
      let m;
      if ((m = line.match(/^(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)?/i))) {
        direction = (m[1] ?? 'TD').toUpperCase();
        continue;
      }
      if (/^(subgraph\b|end$|classDef\b|class\b|style\b|linkStyle\b|click\b)/i.test(line)) continue;
      if ((m = line.match(/^(.+?)\s*[-=.]{2,}\s+"?([^"|]+?)"?\s+[-=.]{2,}>\s*(.+)$/))) {
        const from = seen(parseNodeRef(m[1]));
        const to = seen(parseNodeRef(m[3]));
        if (from && to) { edges.push({ from, to, label: withBreaks(m[2].trim()) }); continue; }
      }
      if ((m = line.match(/^(.+?)\s*(?:[-=.]{2,}>|[=]{3,})\s*(?:\|([^|]*)\|\s*)?(.+)$/))) {
        const from = seen(parseNodeRef(m[1]));
        const to = seen(parseNodeRef(m[3]));
        if (from && to) { edges.push({ from, to, label: withBreaks((m[2] ?? '').trim()) }); continue; }
      }
      const ref = parseNodeRef(line);
      if (ref && /[[({>]/.test(line)) seen(ref);
    }
    return { direction, nodes: [...nodes.values()], edges };
  }

  root.parseMermaidGraph = parseMermaidGraph;
})(typeof window !== 'undefined' ? window : globalThis);
