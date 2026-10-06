export default async function* failedFiles(source) {
  const failed = new Set();
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data?.file) failed.add(event.data.file);
  }
  yield [...failed].join('\n');
}
