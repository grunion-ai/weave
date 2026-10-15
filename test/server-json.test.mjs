import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const server = JSON.parse(read('server.json'));
const pkg = JSON.parse(read('package.json'));
const release = read('.github/workflows/release.yml');

test('server.json names io.github.grunion-ai/weave at the package.json version, as one GHCR image over stdio that runs the mcp verb', () => {
  assert.match(server.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
  assert.equal(server.name, 'io.github.grunion-ai/weave');
  assert.equal(server.version, pkg.version);
  assert.ok(server.description.length <= 100, 'the registry caps description at 100 characters');
  assert.equal(server.repository.url, pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''));
  assert.equal(server.packages.length, 1);
  const [oci] = server.packages;
  assert.equal(oci.registryType, 'oci');
  assert.equal(oci.identifier, `ghcr.io/grunion-ai/weave:${pkg.version}`);
  assert.deepEqual(oci.transport, { type: 'stdio' });
  assert.deepEqual(oci.packageArguments.map((a) => a.value), ['node', 'bin/weave.js', 'mcp']);
  assert.deepEqual(oci.runtimeArguments.map((a) => `${a.name} ${a.value}`), ['-v weave-data:/data']);
});

test('the release pushes the image the registry entry names, labelled with the server name, then publishes server.json with a pinned mcp-publisher over OIDC', () => {
  assert.ok(release.includes(`io.modelcontextprotocol.server.name=${server.name}`));
  assert.ok(release.includes("${{ !inputs.historical && 'ghcr.io/grunion-ai/weave:latest' || '' }}"));
  assert.match(release, /ref: \$\{\{ needs.publish.outputs.sha \}\}/);
  assert.match(release, /^ {6}MCP_PUBLISHER_VERSION: "\d+\.\d+\.\d+"$/m);
  assert.match(release, /^ {6}MCP_PUBLISHER_SHA256: [a-f0-9]{64}$/m);
  assert.match(release, /sha256sum -c -/);
  assert.match(release, /mcp-publisher login github-oidc/);
  assert.match(release, /mcp-publisher publish server\.json/);
});
