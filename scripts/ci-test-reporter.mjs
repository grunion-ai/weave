import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';

export default async function* report(source) {
  for await (const event of source) {
    let record;
    if (event.type === 'test:summary' && event.data.file) record = { type: 'summary', data: { ...event.data, file: relative(process.cwd(), event.data.file).split('\\').join('/') } };
    if ((event.type === 'test:pass' || event.type === 'test:fail') && event.data.file && !event.data.skip && !event.data.todo && event.data.details?.type !== 'suite') appendFileSync(process.env.WEAVE_CI_REPORT, JSON.stringify({ type: 'case', data: { file: relative(process.cwd(), event.data.file).split('\\').join('/'), name: event.data.name, nesting: event.data.nesting, pass: event.type === 'test:pass' } }) + '\n');
    if (event.type === 'test:pass' && event.data.skip) record = { type: 'skip', data: { file: relative(process.cwd(), event.data.file).split('\\').join('/'), reason: String(event.data.skip) } };
    if (record) appendFileSync(process.env.WEAVE_CI_REPORT, JSON.stringify(record) + '\n');
  }
  yield '';
}
