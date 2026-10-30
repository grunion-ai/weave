import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Weave } from '../src/engine.js';
import { dispatchTool, QUERY_PAGE } from '../src/mcp.js';
import { startServer } from '../src/server.js';

const ROWS = QUERY_PAGE + 37;

function stocked() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  w.createTable({ space: 'Sales', name: 'Company' });
  w.createTable({ space: 'Sales', name: 'Deal' });
  w.addRelation('Sales/Deal', { name: 'Company', targetDb: 'Sales/Company', cardinality: 'many-to-one' });
  w.createEntity('Sales/Company', { Name: 'Acme' });
  for (let i = 0; i < ROWS; i++) w.createEntity('Sales/Deal', { Name: `Deal ${i}`, Company: 'Acme' });
  return w;
}

function call(port, path, { method = 'POST', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

const post = (port, path, body) => call(port, path, { body });

test('weave_query with no limit answers one page and says how to get the next', () => {
  const w = stocked();
  const page = dispatchTool(w, 'weave_query', { db: 'Sales/Deal' });
  assert.equal(page.total, ROWS, 'total counts every matching row, not the page');
  assert.equal(page.items.length, QUERY_PAGE, 'no limit argument answers the default page');
  assert.equal(page.nextOffset, QUERY_PAGE, 'nextOffset points at the first row the page left out');

  const rest = dispatchTool(w, 'weave_query', { db: 'Sales/Deal', offset: page.nextOffset });
  assert.equal(rest.items.length, ROWS - QUERY_PAGE, 'the next page carries the remainder');
  assert.equal(rest.nextOffset, undefined, 'the last page names no next offset');
  assert.equal(rest.items[0].name, `Deal ${QUERY_PAGE}`, 'paging does not repeat or skip a row');
});

test('weave_query honours an explicit limit and keeps -1 as the whole-table read', () => {
  const w = stocked();
  assert.equal(dispatchTool(w, 'weave_query', { db: 'Sales/Deal', limit: null }).items.length, QUERY_PAGE, 'an explicit null limit answers the default page');
  assert.equal(dispatchTool(w, 'weave_query', { db: 'Sales/Deal', limit: 5 }).items.length, 5, 'a page size is honoured');
  const whole = dispatchTool(w, 'weave_query', { db: 'Sales/Deal', limit: -1 });
  assert.equal(whole.items.length, ROWS, '-1 still reads every row');
  assert.equal(whole.nextOffset, undefined, 'a whole-table read names no next offset');
});

test('weave_query sends relation summaries once, in chips, unless the caller asks for full', () => {
  const w = stocked();
  const chipped = dispatchTool(w, 'weave_query', { db: 'Sales/Deal', limit: 3 });
  assert.ok(chipped.chips, 'the default answer carries the chips map');
  const value = chipped.items[0].fields.Company;
  const chip = Array.isArray(value) ? value[0] : value;
  assert.deepEqual(Object.keys(chip).sort(), ['id', 'name', 'publicId'], 'a chipped relation value is the reference alone');

  const full = dispatchTool(w, 'weave_query', { db: 'Sales/Deal', limit: 3, relations: 'full' });
  assert.equal(full.chips, undefined, 'relations: full keeps the embedded summaries');
  assert.ok(JSON.stringify(full).length > JSON.stringify(chipped).length, 'full is the larger answer');
});

test('POST /api/tables/<t>/query with no limit answers one page, and -1 the whole table', async () => {
  const w = stocked();
  const { server, port } = await startServer(w, { port: 0 });
  try {
    const page = await post(port, '/api/tables/Sales%2FDeal/query', {});
    assert.equal(page.status, 200);
    assert.equal(page.json.total, ROWS, 'total counts every matching row');
    assert.equal(page.json.items.length, QUERY_PAGE, 'an empty body answers the default page, not the whole table');
    assert.equal(page.json.nextOffset, QUERY_PAGE, 'nextOffset pages the caller forward');

    const whole = await post(port, '/api/tables/Sales%2FDeal/query', { limit: -1 });
    assert.equal(whole.json.items.length, ROWS, '-1 still reads every row');
    assert.equal(whole.json.nextOffset, undefined, 'a whole-table read names no next offset');

    const sized = await post(port, '/api/tables/Sales%2FDeal/query', { limit: 10, offset: 5 });
    assert.equal(sized.json.items.length, 10, 'a page size is honoured');
    assert.equal(sized.json.nextOffset, 15, 'nextOffset follows the offset the caller asked for');

    const listed = await call(port, '/api/tables/Sales%2FDeal/entities', { method: 'GET' });
    assert.equal(listed.json.items.length, QUERY_PAGE, 'GET entities with no limit answers the default page too');
    assert.equal(listed.json.nextOffset, QUERY_PAGE, 'and says where the next page starts');
    const listedWhole = await call(port, '/api/tables/Sales%2FDeal/entities?limit=-1', { method: 'GET' });
    assert.equal(listedWhole.json.items.length, ROWS, 'GET entities with limit=-1 still reads every row');
  } finally {
    server.close();
  }
});
