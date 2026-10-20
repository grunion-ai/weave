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

  root.weaveBoardCore = { GROUPS, PICTURES, CARD_PX, COLUMN_PX, PHONE_COLUMNS, isPicture, coverField, coverOf, coverDrop, photoFieldName, PICK_MIN, PICK_CAP, togglePick, compareRows, groupsOf, pictureOf, widths };
})(typeof window !== 'undefined' ? window : globalThis);
