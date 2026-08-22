/* Mermaid flowchart source → plain nodes/edges (Feature #46). The whiteboard
   needs positions-free structure, not a rendering: tolerant line-by-line
   parsing of the `graph`/`flowchart` dialect weave actually writes (the
   relation map, doc diagrams). Unparsed lines are ignored, never fatal.
   Classic script + node-importable, same pattern as nl-date.js. */
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
        if (sm) { label = sm[1].replace(/^"|"$/g, ''); shape = sh; break; }
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
      // A later mention with a label wins over a bare id reference.
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
      // A -- label --> B: the label lives between the dashes.
      if ((m = line.match(/^(.+?)\s*[-=.]{2,}\s+"?([^"|]+?)"?\s+[-=.]{2,}>\s*(.+)$/))) {
        const from = seen(parseNodeRef(m[1]));
        const to = seen(parseNodeRef(m[3]));
        if (from && to) { edges.push({ from, to, label: m[2].trim() }); continue; }
      }
      // A --> B, A -->|label| B, A -.-> B, A ==> B.
      if ((m = line.match(/^(.+?)\s*(?:[-=.]{2,}>|[=]{3,})\s*(?:\|([^|]*)\|\s*)?(.+)$/))) {
        const from = seen(parseNodeRef(m[1]));
        const to = seen(parseNodeRef(m[3]));
        if (from && to) { edges.push({ from, to, label: (m[2] ?? '').trim() }); continue; }
      }
      // Bare node declarations.
      const ref = parseNodeRef(line);
      if (ref && /[[({>]/.test(line)) seen(ref);
    }
    return { direction, nodes: [...nodes.values()], edges };
  }

  root.parseMermaidGraph = parseMermaidGraph;
})(typeof window !== 'undefined' ? window : globalThis);
