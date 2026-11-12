(function (root) {
  const PREFIX = 'wv-doc-draft:';
  const keyOf = (entityId, field) => `${PREFIX}${entityId}::${field}`;
  function keep(store, entityId, field, value, at) {
    try {
      store.setItem(keyOf(entityId, field), JSON.stringify({ value, at }));
      return true;
    } catch {
      return false;
    }
  }
  function drop(store, entityId, field) {
    try { store.removeItem(keyOf(entityId, field)); } catch {}
  }
  function read(store, entityId, field) {
    let raw = null;
    try { raw = store.getItem(keyOf(entityId, field)); } catch { return null; }
    if (raw === null || raw === undefined) return null;
    let held = null;
    try { held = JSON.parse(raw); } catch {}
    if (typeof held?.value !== 'string') {
      drop(store, entityId, field);
      return null;
    }
    return { value: held.value, at: typeof held.at === 'string' ? held.at : null };
  }
  const offer = (held, served) => !!held && held.value !== (served ?? '');
  function settle(store, entityId, field, served) {
    const held = read(store, entityId, field);
    if (offer(held, served)) return held;
    if (held) drop(store, entityId, field);
    return null;
  }
  root.WeaveDocDraft = { PREFIX, keyOf, keep, drop, read, offer, settle };
})(globalThis);
