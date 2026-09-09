/* A node --test reporter that emits nothing but the paths of the files that
   failed, one per line, so scripts/test.mjs can re-run exactly those and no
   others. It runs alongside the tap/spec reporter — `--test-reporter` may be
   given more than once, each with its own `--test-reporter-destination` — so
   the human-readable stream on stdout is untouched.

   Parsing the TAP text for `location:` would have worked and would have had
   to keep working across node's output changes; the event stream is the
   supported surface and carries the absolute path already. */
export default async function* failedFiles(source) {
  const failed = new Set();
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data?.file) failed.add(event.data.file);
  }
  yield [...failed].join('\n');
}
