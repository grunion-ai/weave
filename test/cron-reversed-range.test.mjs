import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCron } from '../src/schedule.js';

test('a reversed cron range is refused in every field', () => {
  assert.throws(() => parseCron('0 0 5-2 * *'), /day field '5-2' is out of range 1-31/);
  assert.throws(() => parseCron('30-10 * * * *'), /minute field '30-10' is out of range 0-59/);
  assert.throws(() => parseCron('* 20-8 * * *'), /hour field '20-8' is out of range 0-23/);
});

test('a single-value range and an ascending range still parse', () => {
  assert.doesNotThrow(() => parseCron('0 0 5-5 * *'));
  assert.doesNotThrow(() => parseCron('0 0 2-5 * *'));
});
