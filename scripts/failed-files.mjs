export default async function* failedFiles(source) {
  const failed = new Set();
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data?.file && !event.data.todo && !event.data.skip) failed.add(event.data.file);
  }
  yield [...failed].join('\n');
}
