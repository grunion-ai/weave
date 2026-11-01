import test from 'node:test';

const pw = await import('playwright').catch(() => null);
const engines = new Map();
test.after(async () => {
  for (const engine of engines.values()) await engine?.close().catch(() => {});
});
export async function barsOnEngine(name) {
  if (!pw) return null;
  if (!engines.has(name)) engines.set(name, await pw[name].launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }).catch(() => null));
  return engines.get(name);
}
