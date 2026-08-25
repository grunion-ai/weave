/* The slide composer (Feature #118).

   A deck is not a file in weave — it is a read over rows. Any table with a
   many-relation named `Slides` is a deck table; any table with a document
   field named `Model` is a slide table. A slide's document holds ONE decklet
   slide object (`{layout, els:[…]}`); the deck's own `Chrome` and `Style`
   documents hold the deck-wide layer (layouts + master chrome) and the type
   scale. Composition assembles them into one decklet model and the vendored
   decklet engine turns that into one self-contained, editable HTML deck.

   Because it is a read, a deck can never be stale with respect to its slides,
   and one slide can sit in as many decks as it likes — which is the whole
   point of the many-to-many. Versioning lives in the rows, not in the file:
   a deck links a specific slide row, so it stays pinned to the version it
   linked until someone promotes a newer one (`newSlideVersion`). */
import { WeaveError } from './engine.js';
import { create } from './vendor/decklet/create.mjs';
import { validate } from './vendor/decklet/validate.mjs';

// The field names the composer reads. Conventions, not schema: a workspace
// opts in by naming its fields these things.
export const DECK = Object.freeze({
  slides: 'Slides',       // deck  · many-relation to the slide table
  model: 'Model',         // slide · document holding the decklet slide JSON
  chrome: 'Chrome',       // deck  · document: {layouts, master, slots}
  style: 'Style',         // deck  · document: {tokens, roles, pad}
  order: 'Order',         // deck  · text: refs, in the order they present
  space: 'Space',         // deck  · text: "960x540" | "1600x900"
  format: 'Format',       // deck  · slides | carousel | carousel-4x5 | document-letter | document-a4
  layout: 'Layout',       // slide · text: overrides the layout the model names
  version: 'Version',     // slide · number
  key: 'Key',             // slide · text: what the versions of one slide share
  supersedes: 'Supersedes', // slide · relation to the version this replaces
});

const fieldsOf = (db) => Object.values(db.fields ?? {});
const named = (db, name) => fieldsOf(db).find((f) => f.name === name);

const isSlideTable = (db) => named(db, DECK.model)?.type === 'document';

/* What a table is, for the composer: 'deck', 'slide', or nothing. Deck wins if
   a table somehow carries both, because a deck's Slides relation is the more
   specific claim. Pass the table registry and the Slides relation must point
   at an actual slide table — otherwise any table that happens to collect
   something called Slides (a customer's library, say) would answer the deck
   routes with nothing to compose. */
export function deckRole(db, tables = null) {
  if (!db) return null;
  const slides = named(db, DECK.slides);
  if (slides?.type === 'relation' && slides.config?.many
    && (!tables || isSlideTable(tables[slides.config.targetDb]))) return 'deck';
  if (isSlideTable(db)) return 'slide';
  return null;
}

/* A document may be the JSON itself or prose with a fenced block in it — the
   Model field is a document, and people write notes above their models. */
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

// One slide row → one decklet slide object. Never throws: a slide that cannot
// be read becomes a slide that says so, in its own place in the deck.
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

/* The Order field re-orders and subsets a deck without touching a single link:
   a list of refs ("#4, #7" or names). Anything it does not name is left out,
   which is how one library of slides serves a short and a long cut. */
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

/* deck entity → {model, style, options}. The model is the decklet model minus
   the things create() owns (size, format, title) — those ride along in
   `options` so renderDeck can hand them over unchanged. */
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

/* One slide, previewed on its own — wearing the chrome and scale of the first
   deck it belongs to, so a slide looks in isolation exactly as it will in the
   room. A slide in no deck previews bare. */
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

// The first deck a slide is linked to, through whichever relation points at a
// deck table (the inverse of Deck.Slides, whatever the workspace named it).
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

// entity ref → one self-contained deck HTML file, plus what the decklet
// validator makes of the composed model.
export function renderDeck(weave, ref, { template } = {}) {
  const ent = weave.readEntity(ref);
  const role = deckRole(weave.state.tables[ent.dbId], weave.state.tables);
  const composed = role === 'slide' ? composeSlideModel(weave, ref) : composeDeckModel(weave, ref);
  const { html, deck } = create(composed.model, { ...composed.options, style: composed.style, template });
  const v = validate(deck);
  return { html, model: deck, errors: v.errors, warnings: [...composed.warnings, ...v.warnings] };
}

/* A new version of a slide: same key, same content, Version + 1, pointing back
   at what it supersedes. Decks stay where they are — a deck is pinned to the
   row it linked — unless `promote` swaps the new row into every deck the old
   one sits in, in place, keeping its position in each running order. */
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
    // Collections do not clone: a new version starts in no deck of its own,
    // and single-valued relations (its customer, say) travel with it.
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
