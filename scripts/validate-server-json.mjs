#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isType = (v, t) => (t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isUri = (s) => { try { new URL(s); return true; } catch { return false; } };
const deref = (root, ref) => ref.slice(2).split('/').reduce((o, k) => o[k.replace(/~1/g, '/').replace(/~0/g, '~')], root);

export function validate(schema, data, root = schema, path = '$') {
  if (schema === true) return [];
  if (schema === false) return [`${path}: nothing is allowed here`];
  if (schema.$ref) return validate(deref(root, schema.$ref), data, root, path);
  const errors = [];
  const fail = (why) => errors.push(`${path}: ${why}`);
  const nested = (s, v, p) => errors.push(...validate(s, v, root, p));
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(data, t))) fail(`expected ${types.join(' or ')}, got ${typeOf(data)}`);
  }
  if (schema.enum && !schema.enum.some((e) => same(e, data))) fail(`expected one of ${JSON.stringify(schema.enum)}`);
  if ('const' in schema && !same(schema.const, data)) fail(`expected ${JSON.stringify(schema.const)}`);
  if (typeof data === 'string') {
    if (schema.minLength != null && data.length < schema.minLength) fail(`shorter than ${schema.minLength}`);
    if (schema.maxLength != null && data.length > schema.maxLength) fail(`longer than ${schema.maxLength} (${data.length})`);
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) fail(`does not match ${schema.pattern}`);
    if (schema.format === 'uri' && !isUri(data)) fail('not a uri');
  }
  if (Array.isArray(data) && schema.items) data.forEach((v, i) => nested(schema.items, v, `${path}[${i}]`));
  if (typeOf(data) === 'object') {
    for (const k of schema.required ?? []) if (!(k in data)) fail(`missing ${k}`);
    for (const [k, v] of Object.entries(data)) {
      if (schema.properties && k in schema.properties) nested(schema.properties[k], v, `${path}.${k}`);
      else if (schema.additionalProperties === false) fail(`unexpected property ${k}`);
      else if (typeOf(schema.additionalProperties) === 'object') nested(schema.additionalProperties, v, `${path}.${k}`);
    }
  }
  for (const s of schema.allOf ?? []) nested(s, data, path);
  if (schema.anyOf && !schema.anyOf.some((s) => validate(s, data, root, path).length === 0)) fail(`matches none of ${schema.anyOf.length} alternatives`);
  if (schema.not && validate(schema.not, data, root, path).length === 0) fail('matches a forbidden shape');
  return errors;
}

export async function loadSchema(from) {
  if (!/^https?:/.test(from)) return JSON.parse(readFileSync(from, 'utf8'));
  const res = await fetch(from);
  if (!res.ok) throw new Error(`${from}: HTTP ${res.status}`);
  return res.json();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--schema');
  const file = args.find((a, i) => !a.startsWith('--') && i !== at + 1) ?? 'server.json';
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const from = at >= 0 ? args[at + 1] : data.$schema;
  if (!from) throw new Error(`${file} names no $schema; pass --schema <file or url>`);
  const errors = validate(await loadSchema(from), data);
  console.log(errors.length ? errors.join('\n') : `${file} is valid against ${from}`);
  process.exitCode = errors.length ? 1 : 0;
}
