import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
const HOSTED_MCP = 'https://weave.grunion.ai/mcp';

test('the repo is a Claude Code marketplace named weave with one plugin, so /plugin marketplace add grunion-ai/weave lists it', () => {
  const market = read('.claude-plugin/marketplace.json');
  const pkg = read('package.json');
  assert.equal(market.name, 'weave');
  assert.equal(market.owner.name, 'grunion-ai');
  assert.equal(market.plugins.length, 1);
  const [plugin] = market.plugins;
  assert.equal(plugin.name, 'weave');
  assert.equal(plugin.source, './plugins/weave');
  assert.equal(plugin.repository, pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''));
  assert.ok(plugin.description.length > 0);
});

test('the weave plugin points Claude Code at the hosted MCP server over HTTP, which signs in through OAuth on first use', () => {
  const manifest = read('plugins/weave/.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'weave');
  assert.equal(manifest.version, undefined, 'the plugin carries no version, so releases never have to restamp it');
  assert.deepEqual(read('plugins/weave/.mcp.json'), {
    mcpServers: { weave: { type: 'http', url: HOSTED_MCP } },
  });
});

test('the weave plugin carries the directory listing fields, so a directory submission reads its links and icon from the manifest', () => {
  const manifest = read('plugins/weave/.claude-plugin/plugin.json');
  assert.equal(manifest.documentationUrl, 'https://weave.grunion.ai/docs');
  assert.equal(manifest.supportUrl, 'https://weave.grunion.ai/support');
  assert.equal(manifest.privacyPolicyUrl, 'https://weave.grunion.ai/privacy');
  assert.equal(manifest.termsOfServiceUrl, 'https://weave.grunion.ai/terms');
  assert.equal(manifest.icon, './icon.png');
  assert.deepEqual(
    readFileSync(join(ROOT, 'plugins/weave/icon.png')),
    readFileSync(join(ROOT, 'brand/kit/png/badge-blue.png')),
    'the plugin icon is the brand kit badge-blue PNG, byte for byte',
  );
});

test('the marketplace entry leaves the directory listing fields to plugin.json, where the validator accepts them', () => {
  const [plugin] = read('.claude-plugin/marketplace.json').plugins;
  for (const key of ['icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) {
    assert.equal(Object.hasOwn(plugin, key), false, `marketplace entry sets ${key}`);
  }
});

test('no .mcp.json sits at the repo root, so a session developing weave is never wired to production', () => {
  assert.equal(existsSync(join(ROOT, '.mcp.json')), false);
});
