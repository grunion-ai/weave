import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';

export default async function* report(source) {
  for await (const event of source) {
    let record;
    if (event.type === 'test:summary' && event.data.file) record = { type: 'summary', data: { ...event.data, file: relative(process.cwd(), event.data.file).split('\\').join('/') } };
    if (event.type === 'test:pass' && event.data.skip) record = { type: 'skip', data: String(event.data.skip) };
    if (record) appendFileSync(process.env.WEAVE_CI_REPORT, JSON.stringify(record) + '\n');
  }
  yield '';
}
