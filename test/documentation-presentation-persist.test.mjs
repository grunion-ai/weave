import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
import { Weave } from '../src/engine.js';
import { syncDocumentationPresentation } from '../src/documentation-presentation.js';

const dir = tempDir('weave-docs-persist-');
const bannerPath = join(dir, 'banner.svg');
writeFileSync(bannerPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 2"/>');

const presentation = { guides: [{ name: 'Start here', bannerPath, html: '<p>Start with a workspace.</p>' }] };

test('an applied presentation sync is on disk, so a reopened workspace has nothing left to apply', () => {
  const path = join(dir, 'handbook.db');
  const w = new Weave({ path });
  w.createSpace({ name: 'Handbook' });
  const guide = w.createTable({ space: 'Handbook', name: 'Guide' });
  w.createEntity(guide, { name: 'Start here', doc: '# Keep my prose' });
  assert.ok(syncDocumentationPresentation(w, { presentation }).applied);

  const reopened = new Weave({ path });
  const again = syncDocumentationPresentation(reopened, { presentation });
  assert.equal(again.applied, false);
  assert.equal(again.attached, 0);
  assert.equal(again.fields, 0);
  assert.equal(reopened.bodyBlocks('Handbook/Guide')[0], 'Documentation introduction');
});
