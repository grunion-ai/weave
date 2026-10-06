import { WeaveError } from './engine.js';
import { create } from './vendor/decklet/create.mjs';
import { validate } from './vendor/decklet/validate.mjs';

export const DECK = Object.freeze({
  slides: 'Slides',
  model: 'Model',
  chrome: 'Chrome',
  style: 'Style',
  order: 'Order',
  space: 'Space',
  format: 'Format',
  layout: 'Layout',
  version: 'Version',
  key: 'Key',
  supersedes: 'Supersedes',
});

const fieldsOf = (db) => Object.values(db.fields ?? {});
const named = (db, name) => fieldsOf(db).find((f) => f.name === name);

const isSlideTable = (db) => named(db, DECK.model)?.type === 'document';

export function deckRole(db, tables = null) {
  if (!db) return null;
  const slides = named(db, DECK.slides);
  if (slides?.type === 'relation' && slides.config?.many
    && (!tables || isSlideTable(tables[slides.config.targetDb]))) return 'deck';
  if (isSlideTable(db)) return 'slide';
  return null;
}

export function parseJsonDoc(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json|js|javascript)?\s*\n([\s\S]*?)\n?```/);
  return JSON.parse(fenced ? fenced[1] : raw);
}

const errorSlide = (label, message) => ({
  name: label,
  els: [
    { role: 'H1', x: 60, y: 190, w: 840, text: `${label} could not be read` },
    { role: 'Body', x: 60, y: 250, w: 840, color: 'var(--muted)', text: String(message).slice(0, 240) },
  ],
});

const placeholderSlide = (title) => ({
  name: title,
  els: [
    { role: 'H1', x: 60, y: 190, w: 840, text: title },
    { role: 'Body', x: 60, y: 250, w: 840, color: 'var(--muted)', text: 'Link slides to this deck and they compose here, in link order.' },
  ],
});

function slideFrom(weave, summary, warnings) {
  const ent = weave.readEntity(summary.id);
  const label = `${ent.db.split('/').pop()}#${ent.publicId}`;
  let parsed;
  try {
    parsed = parseJsonDoc(ent.docs?.[DECK.model]);
  } catch (err) {
    warnings.push(`${label} — ${DECK.model} is not JSON: ${err.message}`);
    return errorSlide(label, err.message);
  }
  if (parsed == null) {
    warnings.push(`${label} — ${DECK.model} is empty`);
    return errorSlide(label, `${DECK.model} is empty`);
  }
  const slide = Array.isArray(parsed) ? { els: parsed } : { ...parsed };
  if (!Array.isArray(slide.els)) {
    warnings.push(`${label} — no els array in ${DECK.model}`);
    return errorSlide(label, 'the model has no els array');
  }
  slide.name = slide.name ?? ent.name ?? label;
  const layout = ent.fields?.[DECK.layout];
  if (layout) slide.layout = typeof layout === 'object' ? layout.name : String(layout);
  return slide;
}

function ordered(summaries, order) {
  const list = String(order ?? '').split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return summaries;
  const picked = [];
  for (const ref of list) {
    const bare = ref.replace(/^.*#/, '');
    const hit = summaries.find((s) => s.id === ref || String(s.publicId) === bare
      || s.name?.toLowerCase() === ref.toLowerCase());
    if (hit && !picked.includes(hit)) picked.push(hit);
  }
  return picked.length ? picked : summaries;
}

const docJson = (ent, field, warnings) => {
  try {
    return parseJsonDoc(ent.docs?.[field]) ?? null;
  } catch (err) {
    warnings.push(`${field} is not JSON: ${err.message}`);
    return null;
  }
};

const plainValue = (v) => (v && typeof v === 'object' ? (v.name ?? null) : v);

export function composeDeckModel(weave, ref) {
  const ent = weave.readEntity(ref);
  const db = weave.state.tables[ent.dbId];
  if (deckRole(db, weave.state.tables) !== 'deck') {
    throw new WeaveError(`'${ent.db}#${ent.publicId}' is not a deck — a deck table has a many-relation named '${DECK.slides}'`, 'invalid');
  }
  const warnings = [];
  const chrome = docJson(ent, DECK.chrome, warnings) ?? {};
  const style = docJson(ent, DECK.style, warnings);
  const linked = ent.fields?.[DECK.slides] ?? [];
  const picked = ordered(linked, ent.fields?.[DECK.order]);
  const slides = picked.map((s) => slideFrom(weave, s, warnings));
  if (!slides.length) {
    warnings.push('this deck has no slides yet');
    slides.push(placeholderSlide(ent.name || 'Empty deck'));
  }
  const model = { ...chrome, title: ent.name || 'deck', slides };
  return {
    model, style, warnings, entity: ent,
    options: {
      title: ent.name || undefined,
      format: plainValue(ent.fields?.[DECK.format]) || undefined,
      space: plainValue(ent.fields?.[DECK.space]) || undefined,
    },
  };
}

export function composeSlideModel(weave, ref) {
  const ent = weave.readEntity(ref);
  const db = weave.state.tables[ent.dbId];
  if (deckRole(db, weave.state.tables) !== 'slide') {
    throw new WeaveError(`'${ent.db}#${ent.publicId}' is not a slide — a slide table has a document field named '${DECK.model}'`, 'invalid');
  }
  const warnings = [];
  const parent = firstDeckOf(weave, ent);
  const context = parent ? composeDeckModel(weave, parent.id) : null;
  const slide = slideFrom(weave, { id: ent.id }, warnings);
  const model = context
    ? { ...context.model, title: ent.name || context.model.title, slides: [slide] }
    : { title: ent.name || 'slide', slides: [slide] };
  return {
    model, style: context?.style ?? null, warnings, entity: ent,
    options: { ...(context?.options ?? {}), title: ent.name || undefined },
  };
}

function firstDeckOf(weave, ent) {
  const db = weave.state.tables[ent.dbId];
  for (const f of fieldsOf(db)) {
    if (f.type !== 'relation') continue;
    if (deckRole(weave.state.tables[f.config?.targetDb], weave.state.tables) !== 'deck') continue;
    const val = ent.fields?.[f.name];
    const first = Array.isArray(val) ? val[0] : val;
    if (first) return first;
  }
  return null;
}

export function renderDeck(weave, ref, { template } = {}) {
  const ent = weave.readEntity(ref);
  const role = deckRole(weave.state.tables[ent.dbId], weave.state.tables);
  const composed = role === 'slide' ? composeSlideModel(weave, ref) : composeDeckModel(weave, ref);
  const { html, deck } = create(composed.model, { ...composed.options, style: composed.style, template });
  const v = validate(deck);
  return { html, model: deck, errors: v.errors, warnings: [...composed.warnings, ...v.warnings] };
}

export function newSlideVersion(weave, ref, { promote = false } = {}) {
  const ent = weave.readEntity(ref);
  const db = weave.state.tables[ent.dbId];
  if (deckRole(db, weave.state.tables) !== 'slide') {
    throw new WeaveError(`'${ent.db}#${ent.publicId}' is not a slide — versioning is for slide tables (a document field named '${DECK.model}')`, 'invalid');
  }
  if (!named(db, DECK.version)) {
    throw new WeaveError(`'${ent.db}' has no '${DECK.version}' field — a slide table versions on ${DECK.version} + ${DECK.key}`, 'invalid');
  }
  const values = {};
  for (const f of fieldsOf(db)) {
    if (f.system || ['lookup', 'rollup', 'formula', 'document', 'attachments'].includes(f.type)) continue;
    if (f.name === DECK.version || f.name === DECK.supersedes) continue;
    if (f.type === 'relation' && f.config?.many) continue;
    const raw = ent.raw?.[f.name];
    const val = f.type === 'relation' ? (Array.isArray(raw) ? raw[0] : raw) : raw;
    if (val != null && val !== '') values[f.name] = val;
  }
  const current = Number(ent.fields?.[DECK.version] ?? 1);
  values[DECK.version] = (Number.isFinite(current) ? current : 1) + 1;
  if (named(db, DECK.supersedes)?.type === 'relation') values[DECK.supersedes] = ent.id;
  const docs = {};
  for (const [name, text] of Object.entries(ent.docs ?? {})) if (text) docs[name] = text;
  const next = weave.createEntity(db.id, { values, docs });
  if (promote) {
    for (const f of fieldsOf(db)) {
      if (f.type !== 'relation' || !f.config?.many) continue;
      if (deckRole(weave.state.tables[f.config?.targetDb], weave.state.tables) !== 'deck') continue;
      for (const deckRow of ent.fields?.[f.name] ?? []) {
        const holder = weave.readEntity(deckRow.id);
        const list = (holder.fields?.[DECK.slides] ?? []).map((s) => (s.id === ent.id ? next.id : s.id));
        weave.updateEntity(deckRow.id, { [DECK.slides]: list });
      }
    }
  }
  return next;
}
