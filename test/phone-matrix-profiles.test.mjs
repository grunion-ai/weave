import test from 'node:test';
import assert from 'node:assert/strict';
import { PHONES } from './lib/browser.mjs';

const duoClosed = PHONES.find((p) => p.name === 'iPhone Duo closed');

test('iPhone Duo closed models the Safari page viewport measured on the iOS 27.1 simulator', { skip: !duoClosed && 'playwright not installed' }, () => {
  assert.deepEqual(duoClosed.page.viewport, { width: 382, height: 580 });
  assert.deepEqual(duoClosed.page.screen, { width: 466, height: 678 });
  assert.equal(duoClosed.page.deviceScaleFactor, 3);
});
