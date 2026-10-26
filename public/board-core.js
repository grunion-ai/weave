(function (root) {
  const GROUPS = ['stacked', 'side'];
  const PICTURES = ['off', 'small', 'medium', 'large'];
  const CARD_PX = { small: 132, medium: 188, large: 256 };
  const COLUMN_PX = { small: 184, medium: 232, large: 288 };
  const PHONE_COLUMNS = { small: 3, medium: 2, large: 2 };
  const PICTURE_MIME = /^image\/(png|jpeg|gif|webp)$/;

  const isPicture = (file) => PICTURE_MIME.test(String(file?.mime ?? '').split(';')[0].trim().toLowerCase());

  function coverField(db) {
    const hidden = new Set(db?.hiddenFields ?? []);
    return (db?.fields ?? []).find((f) => f.type === 'attachments' && f.preview === 'cover' && f.role !== 'name' && !hidden.has(f.name)) ?? null;
  }

  function coverOf(db, entity) {
    const f = coverField(db);
    if (!f) return null;
    const ids = entity?.raw?.[f.name] ?? [];
    return (entity?.files ?? []).find((x) => ids.includes(x.id) && !x.missing && isPicture(x)) ?? null;
  }

  function coverDrop(db, files) {
    const list = [...(files ?? [])];
    const file = list.find((f) => isPicture({ mime: f?.mime ?? f?.type }));
    if (!file) return { refuse: 'not-picture', name: list[0]?.name ?? '' };
    const field = coverField(db);
    return field ? { field, file } : { refuse: 'no-field', file };
  }

  function photoFieldName(db) {
    const taken = new Set((db?.fields ?? []).map((f) => String(f.name).toLowerCase()));
    let n = 1;
    while (taken.has((n === 1 ? 'photo' : `photo ${n}`))) n += 1;
    return n === 1 ? 'Photo' : `Photo ${n}`;
  }

  const PICK_MIN = 2;
  const PICK_CAP = 4;

  function togglePick(ids, id) {
    if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), refused: false };
    if (ids.length >= PICK_CAP) return { ids, refused: true };
    return { ids: [...ids, id], refused: false };
  }

  const sameKey = (v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
    if (Array.isArray(v)) return JSON.stringify(v.map(sameKey).sort());
    if (typeof v === 'object') return v.id != null ? `#${v.id}` : JSON.stringify(v);
    return JSON.stringify(v);
  };

  const compareRows = (fields, items) => fields.map((field) => ({
    field, differs: new Set(items.map((it) => sameKey(it?.raw?.[field.name]))).size > 1,
  }));

  const LIST = () => root.weaveListCore;

  function laneGrid(groups, lane = {}) {
    const columns = (groups ?? []).map(({ groups: _, ...c }) => c);
    const seen = new Map();
    for (const col of groups ?? []) for (const g of col.groups ?? []) if (!seen.has(g.value)) seen.set(g.value, g.path[g.path.length - 1]);
    const rank = new Map((lane.order === 'az' ? [] : lane.domain ?? []).map((d, i) => [d.key, i]));
    const turn = lane.dir === 'desc' ? -1 : 1;
    const keys = [...seen.keys()].sort((a, b) => {
      if ((a === '') !== (b === '')) return a === '' ? 1 : -1;
      const ra = rank.has(a) ? rank.get(a) : Infinity;
      const rb = rank.has(b) ? rank.get(b) : Infinity;
      if (ra !== rb) return ra === Infinity ? 1 : rb === Infinity ? -1 : (ra - rb) * turn;
      return String(seen.get(a).label).localeCompare(String(seen.get(b).label), undefined, { numeric: true }) * turn;
    });
    const lanes = keys.map((value) => {
      const bucket = seen.get(value);
      const cells = (groups ?? []).map((col) => col.groups?.find((g) => g.value === value)
        ?? { key: [...col.path, bucket].map((p) => p.label).join(LIST().SEP), label: bucket.label, value, level: 1, path: [...col.path, bucket], count: 0, items: [] });
      return { key: bucket.label, label: bucket.label, value, path: [bucket], cells, count: cells.reduce((n, c) => n + (c.count ?? 0), 0) };
    });
    return { columns, lanes };
  }

  const laneShut = (collapsed, lane) => Array.isArray(collapsed) && lane.cells.every((c) => collapsed.includes(c.key));

  function laneFold(collapsed, lane) {
    const now = collapsed == null ? [LIST().COMPLETED] : collapsed.slice();
    const keys = lane.cells.map((c) => c.key);
    if (laneShut(now, lane)) return now.filter((k) => !keys.includes(k));
    return [...now, ...keys.filter((k) => !now.includes(k))];
  }

  const groupsOf = (view) => (GROUPS.includes(view?.groups) ? view.groups : 'side');

  function pictureOf(db, view) {
    if (PICTURES.includes(view?.picture)) return view.picture;
    const f = coverField(db);
    return f ? (PICTURES.includes(f.size) ? f.size : 'medium') : 'off';
  }

  function widths(picture) {
    const size = picture === 'off' || !CARD_PX[picture] ? 'medium' : picture;
    return { card: CARD_PX[size], column: COLUMN_PX[size], phone: PHONE_COLUMNS[size] };
  }

  root.weaveBoardCore = { GROUPS, PICTURES, CARD_PX, COLUMN_PX, PHONE_COLUMNS, isPicture, coverField, coverOf, coverDrop, photoFieldName, PICK_MIN, PICK_CAP, togglePick, compareRows, laneGrid, laneShut, laneFold, groupsOf, pictureOf, widths };
})(typeof window !== 'undefined' ? window : globalThis);
