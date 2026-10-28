import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURES = [
  { name: 'Action Items' },
  { name: 'Action Items', term: { singular: 'action item', plural: 'action items' } },
  { name: 'Meeting Notes' },
  { name: 'Deal' },
  { name: 'Deal', term: { singular: 'deal', plural: 'deals' } },
  { name: 'deal', term: { singular: 'deal' } },
  { name: 'Status' },
  { name: 'Status', term: { singular: 'status', plural: 'statuses' } },
  { name: 'Address' },
  { name: 'Business', term: { singular: 'business', plural: 'businesses' } },
  { name: 'Bus' },
  { name: 'Box' },
  { name: 'Box', term: { singular: 'box' } },
  { name: 'Company' },
  { name: 'Company', term: { singular: 'company' } },
  { name: 'Categories' },
  { name: 'Person' },
  { name: 'Person', term: { singular: 'person' } },
  { name: 'People' },
  { name: 'Series' },
  { name: 'Glass', term: { singular: 'glass', plural: 'glasses' } },
];

const PATHS = {
  'add relation': (w, source, target) => {
    const { inverse } = w.addRelation(source, { name: 'Hub', targetDb: target, cardinality: 'many-to-one' });
    return inverse.name;
  },
  'text field to relation': (w, source, target) => {
    w.addField(source, { name: 'Hub', type: 'text' });
    const field = w.updateField(source.id, 'Hub', { type: 'relation', config: { targetDb: target.id } });
    return w.getField(target.id, field.config.inverseFieldId).name;
  },
};

function inverseFor(fixture, path) {
  const w = new Weave();
  w.createSpace({ name: 'Guard' });
  const target = w.createTable({ space: 'Guard', name: 'Hub' });
  const source = w.createTable({ space: 'Guard', name: fixture.name });
  if (fixture.term) w.updateField(source.id, source.nameFieldId, { config: { term: fixture.term } });
  return { name: PATHS[path](w, source, target), term: w.termOf(source) };
}

for (const path of Object.keys(PATHS)) {
  test(`the default inverse from ${path} never grows a suffix s onto a table name`, () => {
    for (const fixture of FIXTURES) {
      const { name, term } = inverseFor(fixture, path);
      const label = `${fixture.name}${fixture.term ? ` (term ${term.plural})` : ''} via ${path}: ${name}`;
      const allowed = new Set([fixture.name]);
      if (term.set) allowed.add(globalThis.WeaveTerm.inverseName(fixture.name, term, true));
      assert.ok(allowed.has(name), `${label} is the table name or its plural term`);
      assert.ok(!(name.length === fixture.name.length + 1 && name.startsWith(fixture.name) && name.endsWith('s') && !(term.set && name.toLowerCase() === term.plural)),
        `${label} is the table name with a bare s appended`);
      if (/ss$/i.test(name)) assert.ok(/ss$/i.test(fixture.name) || (term.set && /ss$/.test(term.plural)), `${label} ends in a doubled s no name or term holds`);
    }
  });
}

function sources(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory()) return d.name === 'vendor' ? [] : sources(join(dir, d.name));
    return d.name.endsWith('.js') ? [join(dir, d.name)] : [];
  });
}

test('no code path builds an inverse name by appending s to a string', () => {
  const suffix = /\+\s*\(?[^;\n]*['"`]s['"`]|\}s`/;
  const hits = [];
  for (const file of [...sources('src'), ...sources('public'), ...sources('bin')]) {
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      if (/inverse|invName|autoName/i.test(line) && suffix.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
  const engine = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
  assert.match(engine, /inverseName \?\? this\.#inverseName\(db, card\.targetMany\)/, 'addRelation names through the shared helper');
  assert.match(engine, /config\.inverseName \?\? this\.#inverseName\(db, true\)/, 'textToRelation names through the shared helper');
});
