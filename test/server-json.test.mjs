import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '../scripts/validate-server-json.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const server = JSON.parse(read('server.json'));
const pkg = JSON.parse(read('package.json'));
const schema = JSON.parse(read('test/fixtures/server.schema.json'));
const workflow = read('.github/workflows/publish-image.yml');

test('server.json is valid against the registry schema it names, vendored at test/fixtures/server.schema.json', () => {
  assert.equal(server.$schema, schema.$id);
  assert.deepEqual(validate(schema, server), []);
});

test('the validator refuses what the schema refuses: a bare name, an unknown transport, a long description, a missing package field, a bare host', () => {
  const [oci] = server.packages;
  const errors = validate(schema, { ...server, name: 'weave', packages: [{ ...oci, transport: { type: 'pigeon' } }] });
  assert.ok(errors.some((e) => e.startsWith('$.name:')), errors.join('\n'));
  assert.ok(errors.some((e) => e.startsWith('$.packages[0].transport:')), errors.join('\n'));
  assert.equal(validate(schema, { ...server, description: 'x'.repeat(101) }).length, 1);
  assert.deepEqual(validate(schema, { ...server, packages: [{ registryType: 'oci', identifier: 'ghcr.io/x/y:1' }] }), ['$.packages[0]: missing transport']);
  assert.deepEqual(validate(schema, { ...server, websiteUrl: 'weave.grunion.ai' }), ['$.websiteUrl: not a uri']);
});

test('server.json names io.github.grunion-ai/weave at the package.json version, as one GHCR image over stdio that runs the mcp verb', () => {
  assert.equal(server.name, 'io.github.grunion-ai/weave');
  assert.equal(server.version, pkg.version);
  assert.equal(server.repository.url, pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''));
  assert.equal(server.packages.length, 1);
  const [oci] = server.packages;
  assert.equal(oci.registryType, 'oci');
  assert.equal(oci.identifier, `ghcr.io/grunion-ai/weave:${pkg.version}`);
  assert.deepEqual(oci.transport, { type: 'stdio' });
  assert.deepEqual(oci.packageArguments.map((a) => a.value), ['node', 'bin/weave.js', 'mcp']);
  assert.deepEqual(oci.runtimeArguments.map((a) => `${a.name} ${a.value}`), ['-v weave-data:/data']);
});

test('publish-image.yml builds on v tags and on dispatch, pushes only on a tag, labels the image with the server name, and publishes server.json with a pinned mcp-publisher over OIDC', () => {
  assert.match(workflow, /^on:\n  push:\n    tags: \["v\*"\]\n  workflow_dispatch:\n/m);
  assert.match(workflow, /^ {10}push: \$\{\{ github\.event_name == 'push' \}\}$/m);
  assert.match(workflow, /^ {4}if: github\.event_name == 'push'$/m);
  assert.match(workflow, /^ {12}\$\{\{ env\.IMAGE \}\}:\$\{\{ steps\.version\.outputs\.version \}\}\n {12}\$\{\{ env\.IMAGE \}\}:latest$/m);
  assert.match(workflow, /^ {2}IMAGE: ghcr\.io\/grunion-ai\/weave$/m);
  assert.ok(workflow.includes(`io.modelcontextprotocol.server.name=${server.name}`));
  assert.match(workflow, /^ {6}MCP_PUBLISHER_VERSION: "\d+\.\d+\.\d+"$/m);
  assert.match(workflow, /^ {6}MCP_PUBLISHER_SHA256: [a-f0-9]{64}$/m);
  assert.match(workflow, /releases\/download\/v\$\{MCP_PUBLISHER_VERSION\}\/mcp-publisher_linux_amd64\.tar\.gz/);
  assert.match(workflow, /sha256sum -c -/);
  assert.match(workflow, /node scripts\/validate-server-json\.mjs server\.json/);
  assert.match(workflow, /mcp-publisher login github-oidc/);
  assert.match(workflow, /mcp-publisher publish server\.json/);
  assert.match(workflow, /^ {6}id-token: write$/m);
  assert.match(workflow, /^ {6}packages: write$/m);
});
