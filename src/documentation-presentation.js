import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { buildPresentation } from './handbook/presentation.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const protectedTables = new Set(['Issue', 'Feature', 'Suite', 'Case']);
const slots = [
  { key: 'banner', name: 'Documentation banner', preview: 'cover' },
  { key: 'introduction', name: 'Documentation introduction', preview: 'intro' },
];

function targets(w, presentation) {
  const result = [];
  for (const kind of ['spaces', 'tables']) {
    const registry = Object.values(w.state.tables).find(t => t.system === kind && !t.deletedAt);
    if (!registry) continue;
    for (const item of presentation[kind] ?? []) {
      const subject = kind === 'spaces' ? w.listSpaces().find(s => s.name === item.name) : w.findTable(item.name);
      if (!subject || subject.deletedAt) continue;
      const row = Object.values(w.state.entities).find(e => e.dbId === registry.id && e.sysId === subject.id && !e.deletedAt);
      if (row) result.push({ item, row, table: registry, subject, kind });
    }
  }
  for (const [kind, name] of [['guides', 'Handbook/Guide'], ['releases', 'Development/Release']]) {
    const table = w.findTable(name);
    if (!table) continue;
    for (const item of presentation[kind] ?? []) {
      const matches = w.listEntities(table.id).filter(row => !row.deletedAt && w.entityName(row) === item.name);
      const row = matches.length === 1 ? matches[0] : null;
      if (row) result.push({ item, row, table, kind });
    }
  }
  return result;
}

function sourceFiles(item) {
  const files = {};
  if (item.bannerPath) {
    const extension = extname(String(item.bannerPath)).toLowerCase();
    const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extension];
    if (!mime) throw new Error(`Unsupported documentation banner: ${extension}`);
    files.banner = { bytes: readFileSync(item.bannerPath), name: `documentation-banner${extension}`, mime };
  }
  if (typeof item.html === 'string') files.introduction = { bytes: Buffer.from(item.html), name: 'documentation-introduction.html', mime: 'text/html' };
  return files;
}

export function syncDocumentationPresentation(w, { presentation } = {}) {
  const result = { applied: false, attached: 0, fields: 0, descriptions: 0, conflicts: [] };
  if (w.registryHost || w.state.meta.registry === 'hub') return result;
  const selected = targets(w, presentation ?? buildPresentation(w));
  if (!selected.length) return result;
  const prepared = selected.map(target => ({ ...target, files: sourceFiles(target.item) }));
  const existing = w.state.meta.documentationPresentation;
  if (existing && existing.version !== 1) {
    result.conflicts.push('Documentation presentation has an unsupported ownership version');
    return result;
  }
  const ledger = existing ?? { version: 1, tables: {}, rows: {} };
  const before = JSON.stringify(ledger);
  const actor = w.actor;
  w.actor = 'documentation-sync';
  try {
    w.state.meta.documentationPresentation = ledger;
    for (const { item, row, table, subject, kind, files } of prepared) {
      const tableOwner = ledger.tables[table.id] ??= { fields: {} };
      const rowOwner = ledger.rows[row.id] ??= {};
      for (const slot of slots) {
        const file = files[slot.key];
        if (!file) continue;
        let field = table.fields[tableOwner.fields[slot.key]];
        if (!field) {
          if (tableOwner.fields[slot.key] || w.findField(table, slot.name)) {
            result.conflicts.push(`${item.name}: ${slot.name} is independently managed or removed`);
            continue;
          }
          field = w.addField(table.id, { name: slot.name, type: 'attachments', config: { multiple: false, preview: slot.preview } });
          tableOwner.fields[slot.key] = field.id;
          result.fields++;
        }
        if (field.type !== 'attachments' || field.config.multiple !== false || field.config.preview !== slot.preview) {
          result.conflicts.push(`${item.name}: ${field.name} presentation was edited`);
          continue;
        }
        const owned = rowOwner[slot.key];
        const current = row.values[field.id] ?? [];
        if (owned ? !same(current, [owned.id]) : current.length > 0) {
          result.conflicts.push(`${item.name}: ${field.name} attachment was edited`);
          continue;
        }
        if (owned) {
          let actual;
          try { actual = hash(w.readFile(owned.id).bytes); } catch { actual = null; }
          if (actual !== owned.hash) {
            result.conflicts.push(`${item.name}: ${field.name} file was edited or is unavailable`);
            continue;
          }
          if (owned.hash === hash(file.bytes)) continue;
        }
        const attached = w.attachToField(row.id, field.id, file);
        rowOwner[slot.key] = { id: attached.id, hash: hash(file.bytes) };
        result.attached++;
        w.save();
      }
      if (table.fields[tableOwner.fields.introduction] && !tableOwner.bodyOrder) {
        const field = table.fields[tableOwner.fields.introduction];
        const order = [field.name, ...w.bodyBlocks(table).filter(name => name !== field.name)];
        w.updateTable(table.id, { bodyOrder: order });
        tableOwner.bodyOrder = [...table.bodyOrder];
      } else if (tableOwner.bodyOrder && !same(table.bodyOrder, tableOwner.bodyOrder)) {
        result.conflicts.push(`${item.name}: body order was edited`);
      }
      if (subject && typeof item.description === 'string' && !(kind === 'tables' && protectedTables.has(subject.name))) {
        const current = subject.description ?? '';
        if ((!rowOwner.description && (!current || (typeof item.previousDescription === 'string' && current === item.previousDescription))) || rowOwner.description === hash(current)) {
          if (current !== item.description) {
            if (kind === 'spaces') w.updateSpace(subject.id, { description: item.description });
            else w.updateTable(subject.id, { description: item.description });
            result.descriptions++;
          }
          rowOwner.description = hash(item.description);
        }
      }
    }
    result.applied = before !== JSON.stringify(ledger) || result.attached > 0 || result.fields > 0 || result.descriptions > 0;
    if (result.applied) w.save();
  } finally {
    w.actor = actor;
  }
  return result;
}
