/**
 * The `elapse` binary (FR-CLI-030). This file exists only to run `main`, so there is no condition
 * left that could decide not to.
 *
 * It replaces an entry guard in `main.ts` that compared `import.meta.url` with
 * `pathToFileURL(process.argv[1])`. npm installs a bin as a symlink, Node resolves the entry to
 * its realpath for `import.meta.url` but leaves `argv[1]` as the symlink path, so the two never
 * matched and every `npx @elapse/cli …` printed nothing and exited 0. `main.ts` is now a module
 * that only exports; running is this file's single job.
 */
import { main } from "./main";

const ac = new AbortController();
process.on("SIGINT", () => {
  process.stderr.write("\n");
  ac.abort();
});

void main(process.argv.slice(2), {
  env: process.env,
  stdout: (l) => process.stdout.write(l + "\n"),
  stderr: (l) => process.stderr.write(l + "\n"),
  isTTY: process.stdout.isTTY === true,
  signal: ac.signal,
}).then((code) => process.exit(code));
