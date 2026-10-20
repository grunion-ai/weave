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

  root.weaveBoardCore = { GROUPS, PICTURES, CARD_PX, COLUMN_PX, PHONE_COLUMNS, isPicture, coverField, coverOf, groupsOf, pictureOf, widths };
})(typeof window !== 'undefined' ? window : globalThis);
