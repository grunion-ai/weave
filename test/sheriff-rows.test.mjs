import test from 'node:test';
import assert from 'node:assert/strict';
import { sheriff, dryIO, realIO, areaOf, rowArea, issueName, flakeName, AREA_PATHS } from '../scripts/sheriff.mjs';
import { AREA_LABELS } from '../agents/fixer/core.mjs';

const sha = (n) => n.toString(16).padStart(40, '0');
const repo = 'grunion-ai/weave';
const env = { WEAVE_TRACKER_TOKEN: 'token', WEAVE_TRACKER_URL: 'https://tracker.test/w/weave' };
const redRun = (id, head) => ({ id, name: 'tests', path: '.github/workflows/test.yml', event: 'push', head_branch: 'main', head_repository: { full_name: repo }, status: 'completed', conclusion: 'failure', run_attempt: 1, head_sha: head, html_url: `https://github.com/${repo}/actions/runs/${id}`, created_at: '2026-11-12T10:00:00Z' });
const pr = (s) => Number.parseInt(s, 16);

function github({ n = 100, paths = ['public/grid-keymap.js'], files = ['test/grid.test.mjs'], unresolved = [], timedOut = [], parent = 'success', parentRed = [], flakes = [] } = {}) {
  const culprit = { sha: sha(n), message: `change ${n} (#${n})` };
  const run = redRun(40000 + n, culprit.sha);
  const filed = [];
  const logs = [];
  const io = {
    repo,
    log: (line) => logs.push(line),
    run: async () => run,
    greenAfter: async () => null,
    failures: async () => ({ files, jobs: [{ name: 'tests browser-2', html_url: `${run.html_url}/job/1` }], cancelled: [], unresolved, timedOut }),
    rerunFailed: async () => {},
    waitRun: async (id) => ({ ...run, id, run_attempt: 2 }),
    gate: async () => 'failure',
    lastGreen: async () => ({ sha: sha(1), url: `https://github.com/${repo}/actions/runs/800` }),
    range: async () => [culprit],
    openReverts: async () => [],
    known: async () => null,
    probe: async (s) => ({ conclusion: s === sha(1) ? parent : 'failure', url: `https://github.com/${repo}/actions/runs/7${n}`, id: 7000 + n }),
    probeFiles: async () => parentRed,
    pathsOf: async () => paths,
    pullsFor: async (s) => [{ number: pr(s), html_url: `https://github.com/${repo}/pull/${pr(s)}` }],
    openRevert: async (spec) => ({ number: 5000 + n, html_url: `https://github.com/${repo}/pull/${5000 + n}`, branch: spec.branch, armed: true }),
    comment: async () => {},
    openFlakes: async (names) => names.filter((f) => flakes.includes(f)).map((file) => ({ file, publicId: 1109 })),
    logFlake: async () => {},
    reopenRow: async () => null,
    alert: async () => {},
    openIncidents: async () => [],
    appendRow: async (row) => ({ id: row.id, publicId: row.publicId, appended: true }),
    fileIssue: async (spec) => { filed.push(spec); return { url: 'https://tracker.test/w/weave/e/x' }; },
  };
  return { io, filed, logs, run };
}

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

function tracker(rows = []) {
  let next = 6000;
  const creates = [];
  const key = (name) => String(name ?? '').trim().toLowerCase();
  const value = (row, field) => (field === 'publicId' ? row.publicId : row.fields[field]);
  const match = (row, [field, op, want]) => (op === '=' ? value(row, field) === want : op === '!=' ? value(row, field) !== want : op === 'contains' ? String(value(row, field)).includes(want) : false);
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^\/w\/weave\/api/, '');
    const body = init.body ? JSON.parse(init.body) : {};
    if (path === '/tables/Issue/query') return reply({ items: rows.filter((row) => body.where.every((w) => match(row, w))) });
    if (path === '/tables/Issue/entities') {
      creates.push(body);
      const { dedupe, Name, Description, ...values } = body;
      const held = dedupe ? rows.filter((r) => key(r.fields.Name) === key(Name)).sort((a, b) => a.publicId - b.publicId)[0] : null;
      if (held) return reply({ entity: held, error: `Development/Issue already has a row named '${held.fields.Name}' (#${held.publicId}), so no row was created.`, code: 'conflict' }, 409);
      const row = { id: `row-${next}`, publicId: next++, fields: { Name, Status: 'Open', ...values }, doc: Description };
      rows.push(row);
      return reply(row, 201);
    }
    const [, id, what] = path.match(/^\/entities\/([^/]+)\/(doc|state)$/) ?? [];
    const row = rows.find((r) => r.id === id);
    if (!row) return reply({ error: 'not found' }, 404);
    if (what === 'doc') row.doc += body.doc;
    else row.fields[body.field] = body.state;
    return reply({});
  };
  return { rows, creates, fetch };
}

const live = (io) => {
  const tracked = realIO(env);
  return Object.assign(io, { openIncidents: tracked.openIncidents, appendRow: tracked.appendRow, fileIssue: tracked.fileIssue });
};

test('the Area of a sheriff row is read off the paths its convicted commits changed (Feature #372)', () => {
  assert.equal(areaOf(['public/grid-keymap.js', 'changelog.d/grid-keys-372.md']), 'Grid');
  assert.equal(areaOf(['src/engine.js', 'src/formula.js', 'src/handbook/fields/formula.md', 'test/formula-rename.test.mjs']), 'Formula', 'PR #923 changed the formula engine');
  assert.equal(areaOf(['public/style.css', 'test/board-swimlanes-browser.test.mjs']), 'Grid', 'a tie goes to the more specific area');
  assert.equal(areaOf(['public/app.js', 'src/mcp.js', 'src/runs.js', 'src/server.js']), 'Server', 'the area most paths name wins');
  assert.equal(areaOf(['.github/workflows/test.yml', 'scripts/test.mjs']), 'Gate');
  assert.equal(areaOf(['public/vendor/mermaid/mermaid.min.js']), 'Vendor');
  assert.equal(areaOf(['src/supervisor.js', 'Dockerfile']), 'Hosting');
  assert.equal(areaOf(['src/oidc.js']), 'Auth');
  assert.equal(areaOf(['test/security/headers.test.mjs']), 'Security');
  assert.equal(areaOf(['test/picker-toggle-browser.test.mjs']), 'Picker');
  assert.equal(areaOf(['test/entity-dock-resize-browser.test.mjs']), 'Dock');
  assert.equal(areaOf(['test/crumb-fold-browser.test.mjs']), 'Nav');
  assert.equal(areaOf(['test/phone-row-header-browser.test.mjs']), 'Grid');
  assert.equal(areaOf(['test/phone-touch-targets-browser.test.mjs']), 'Layout');
  assert.equal(areaOf(['public/app.js', 'src/engine.js', 'src/commands.js', 'README.md', 'changelog.d/a-1.md', 'docs/PARITY.md']), null, 'the monoliths and the docs name no area');
  assert.equal(areaOf([]), null);
  const labels = Object.values(AREA_LABELS);
  for (const area of [...AREA_PATHS.map(([name]) => name), 'Gate', 'Other']) assert.ok(labels.includes(area), `${area} is an Area option the fixer reads`);
});

test('a convicted commit names the Area; one whose paths name none falls back to the failing tests, and a red no commit explains is a Gate row (Feature #372)', () => {
  assert.equal(rowArea({ blamed: [{ paths: ['public/grid-keymap.js'] }], files: ['test/picker-toggle-browser.test.mjs'] }), 'Grid');
  assert.equal(rowArea({ blamed: [{ paths: ['public/app.js'] }, { paths: ['src/formula.js'] }], files: [] }), 'Formula', 'every convicted commit of a range votes');
  assert.equal(rowArea({ blamed: [{ paths: ['public/app.js'] }], files: ['test/picker-toggle-browser.test.mjs'] }), 'Picker');
  assert.equal(rowArea({ blamed: [{ paths: ['public/app.js'] }], files: ['test/modifier-click-browser.test.mjs'] }), 'Other');
  assert.equal(rowArea({ blamed: [], files: ['test/grid.test.mjs'] }), 'Gate');
  assert.equal(rowArea({ files: [], timedOut: ['browser-1'] }), 'Gate');
});

test('every Issue row the sheriff files carries Area and Symptom, under one name per detector (Feature #372)', async () => {
  const convicted = github();
  assert.equal((await sheriff(40100, convicted.io)).action, 'revert');
  assert.deepEqual(convicted.filed.map((s) => [s.name, s.area, s.symptom]), [['Error: test/grid.test.mjs fails on main', 'Grid', ['Error']]]);
  assert.match(convicted.filed[0].description, /Original PR: #100 https:\/\/github\.com\/grunion-ai\/weave\/pull\/100/, 'the PR the name no longer carries stays in the evidence');

  const appOnly = github({ paths: ['public/app.js', 'changelog.d/toggle-372.md'], files: ['test/picker-toggle-browser.test.mjs'] });
  await sheriff(40100, appOnly.io);
  assert.deepEqual(appOnly.filed.map((s) => [s.name, s.area]), [['Error: test/picker-toggle-browser.test.mjs fails on main', 'Picker']]);

  const predates = github({ parent: 'failure', parentRed: ['test/grid.test.mjs'] });
  assert.equal((await sheriff(40100, predates.io)).action, 'escalate');
  assert.deepEqual(predates.filed.map((s) => [s.name, s.area, s.symptom]), [['Error: test/grid.test.mjs fails on main', 'Gate', ['Error']]]);

  const tracked = github({ files: ['test/feedback-budget-browser.test.mjs'], flakes: ['test/feedback-budget-browser.test.mjs'] });
  assert.equal((await sheriff(40100, tracked.io)).action, 'escalate');
  assert.deepEqual(tracked.filed.map((s) => [s.area, s.symptom]), [['Gate', ['Error']]]);

  const stalled = github({ files: [], timedOut: ['browser-1', 'browser-2'] });
  assert.equal((await sheriff(40100, stalled.io)).action, 'escalate');
  assert.deepEqual(stalled.filed.map((s) => [s.name, s.area, s.symptom]), [['Error: tests shards time out on main', 'Gate', ['Error']]]);
  assert.match(stalled.filed[0].description, /Shards that hit the test manager timeout: browser-1, browser-2/);

  const silent = github({ files: [] });
  await sheriff(40100, silent.io);
  assert.deepEqual(silent.filed.map((s) => s.name), ['Error: the tests suite fails on main']);
});

test('the row name is the detector: two reds of one test after different PRs, shards or commits read the same (Feature #372)', () => {
  const first = issueName({ files: ['test/grid.test.mjs', 'test/sort.test.mjs'], prs: [{ number: 7 }], run: redRun(1, sha(7)) });
  const second = issueName({ files: ['test/grid.test.mjs'], prs: [{ number: 8 }, { number: 9 }], run: redRun(2, sha(9)) });
  assert.equal(first, 'Error: test/grid.test.mjs fails on main');
  assert.equal(second, first);
  assert.equal(issueName({ files: [], timedOut: ['browser-1'], run: redRun(3, sha(3)) }), issueName({ files: [], timedOut: ['unit-2', 'browser-4'], run: redRun(4, sha(4)) }));
});

test('the rows the sheriff creates set Area and Symptom and ask the tracker to dedupe (Feature #372)', async (t) => {
  const stub = tracker();
  t.mock.method(globalThis, 'fetch', stub.fetch);
  const io = realIO(env);
  await io.fileIssue({ name: 'Error: test/grid.test.mjs fails on main', description: 'evidence', area: 'Grid', symptom: ['Error'] });
  await io.logRetried({ run: { head_sha: sha(9), html_url: `https://github.com/${repo}/actions/runs/9` }, file: 'test/backup-stream.test.mjs', shard: 'unit-2', cases: [] });
  await io.logFlake({ run: { head_sha: sha(10), html_url: `https://github.com/${repo}/actions/runs/10` }, files: ['test/grid-browser.test.mjs'], jobs: [] });
  assert.deepEqual(stub.creates.map((c) => [c.Name, c.Severity, c.Area, c.Symptom, c.dedupe]), [
    ['Error: test/grid.test.mjs fails on main', 'High', 'Grid', ['Error'], true],
    [flakeName('test/backup-stream.test.mjs'), 'Low', 'Gate', ['Error'], true],
    [flakeName('test/grid-browser.test.mjs'), 'Low', 'Gate', ['Error'], true],
  ]);
  for (const row of stub.rows) {
    assert.ok(row.fields.Area, row.fields.Name);
    assert.deepEqual(row.fields.Symptom, ['Error'], row.fields.Name);
  }
});

test('a second conviction of the same detector updates its row instead of filing a new one, In Progress and Fixed rows included (Feature #372)', async (t) => {
  const stub = tracker();
  t.mock.method(globalThis, 'fetch', stub.fetch);
  const io = realIO(env);
  const name = 'Error: test/grid.test.mjs fails on main';
  const first = await io.fileIssue({ name, description: 'conviction of PR #100', area: 'Grid', symptom: ['Error'] });
  const second = await io.fileIssue({ name, description: 'conviction of PR #200', area: 'Style', symptom: ['Error'] });
  assert.equal(stub.rows.length, 1);
  assert.equal(second.publicId, first.publicId);
  assert.equal(second.appended, true);
  const [row] = stub.rows;
  assert.match(row.doc, /conviction of PR #100\n\nconviction of PR #200$/);
  assert.equal(row.fields.Area, 'Grid', 'a later conviction leaves the Area the row was filed with');

  row.fields.Status = 'In Progress';
  await io.fileIssue({ name, description: 'conviction of PR #300', area: 'Grid' });
  assert.equal(row.fields.Status, 'In Progress', 'a row someone works on only takes the line');
  row.fields.Status = 'Fixed';
  const back = await io.fileIssue({ name, description: 'conviction of PR #400', area: 'Grid' });
  assert.equal(back.reopened, true);
  assert.equal(row.fields.Status, 'Open');
  assert.match(row.doc, /conviction of PR #400\n\nReopened: this happened again after the row was marked Fixed\.$/);
  assert.equal(stub.rows.length, 1);
  assert.equal(stub.creates.length, 1, 'only the first conviction created a row');
});

test('a create the tracker refuses as a duplicate lands on the row the refusal names (Feature #372)', async (t) => {
  const stub = tracker([{ id: 'r1736', publicId: 1736, fields: { Name: ' error: TEST/GRID.TEST.MJS fails on main', Status: 'Fixed' }, doc: 'ledger' }]);
  t.mock.method(globalThis, 'fetch', stub.fetch);
  const out = await realIO(env).fileIssue({ name: 'Error: test/grid.test.mjs fails on main', description: 'conviction of PR #500', area: 'Grid' });
  assert.equal(out.publicId, 1736);
  assert.equal(stub.rows.length, 1);
  assert.equal(stub.rows[0].fields.Status, 'Open');
  assert.match(stub.rows[0].doc, /^ledger\n\nconviction of PR #500\n\nReopened: /);
  t.mock.method(globalThis, 'fetch', async (url) => (String(url).endsWith('/query') ? reply({ items: [] }) : reply({ error: 'revision conflict', code: 'conflict' }, 409)));
  await assert.rejects(realIO(env).fileIssue({ name: 'Error: test/sort.test.mjs fails on main', description: 'x', area: 'Grid' }), /tracker \/tables\/Issue\/entities: HTTP 409/, 'a 409 that names no row is an error, not a row');
});

test('two reds of one test after two PRs leave one standing row with both convictions, and a third after Fixed reopens it (Feature #372)', async (t) => {
  const stub = tracker();
  t.mock.method(globalThis, 'fetch', stub.fetch);
  for (const n of [100, 200]) {
    const { io } = github({ n });
    assert.equal((await sheriff(40000 + n, live(io))).action, 'revert');
  }
  assert.equal(stub.rows.length, 1);
  const [row] = stub.rows;
  assert.deepEqual([row.fields.Name, row.fields.Severity, row.fields.Area, row.fields.Symptom, row.fields.Status], ['Error: test/grid.test.mjs fails on main', 'High', 'Grid', ['Error'], 'Open']);
  assert.match(row.doc, /pull\/100/);
  assert.match(row.doc, /pull\/200/);
  row.fields.Status = 'Fixed';
  const { io } = github({ n: 300 });
  const out = await sheriff(40300, live(io));
  assert.equal(out.issue.publicId, row.publicId);
  assert.equal(row.fields.Status, 'Open');
  assert.match(row.doc, /pull\/300/);
  assert.equal(stub.rows.length, 1);
});

test('a dry run appends nothing to an open incident row it finds, and reads on without a tracker token', async (t) => {
  const stub = tracker([{ id: 'r1317', publicId: 1317, fields: { Name: 'Error: test/grid.test.mjs fails on main after PR #7', Status: 'Open' }, doc: 'ledger' }]);
  t.mock.method(globalThis, 'fetch', stub.fetch);
  const { io, logs } = github();
  const out = await sheriff(40100, dryIO(live(io)), { dryRun: true });
  assert.equal(out.action, 'revert');
  assert.equal(stub.rows[0].doc, 'ledger');
  assert.ok(logs.some((l) => l.startsWith('dry run, would append to Issue #1317')), logs.join('\n'));

  const bare = github();
  const tracked = realIO({});
  Object.assign(bare.io, { openIncidents: tracked.openIncidents, appendRow: tracked.appendRow, fileIssue: tracked.fileIssue });
  assert.equal((await sheriff(40100, dryIO(bare.io), { dryRun: true })).action, 'revert');
  assert.ok(bare.logs.some((l) => /dry run could not read the open rows: WEAVE_TRACKER_TOKEN missing/.test(l)), bare.logs.join('\n'));
  assert.ok(bare.logs.some((l) => /dry run, would file Issue: Error: test\/grid\.test\.mjs fails on main \(Area Grid, Symptom Error\)/.test(l)), bare.logs.join('\n'));
});
