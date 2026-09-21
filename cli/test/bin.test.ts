/**
 * FR-CLI-030: `npx @elapse/cli …` runs on a clean machine. npm installs the `elapse` bin as a
 * **symlink** (`node_modules/.bin/elapse → ../@elapse/cli/dist/elapse.js`), and that is the only
 * way a merchant or a judge ever invokes it.
 *
 * Every other test in this package calls `main()` directly, so none of them exercise the binary.
 * `@elapse/cli` 0.1.0–0.1.4 shipped an entry guard comparing `import.meta.url` with
 * `pathToFileURL(process.argv[1])`: Node resolves the entry to its realpath but leaves `argv[1]`
 * as the symlink path, so the guard was false, `main()` never ran, and every command printed
 * nothing and exited 0. This test invokes the built binary through a symlink, the way npm does.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

const dist = resolve(__dirname, "../dist/elapse.js");

/** The binary is the artifact under test, so build it if this is a cold checkout. */
beforeAll(() => {
  if (!existsSync(dist)) execFileSync("npm", ["run", "build"], { cwd: resolve(__dirname, ".."), stdio: "ignore" });
}, 60_000);

/**
 * Invoke the binary the way npm does: through a symlink pointing at `dist/elapse.js`.
 *
 * The child gets an empty `XDG_CONFIG_HOME` and no `ELAPSE_*` key, so it sees the clean machine
 * this test is about rather than whoever is running it. Without that, "no key" means "no key
 * unless the developer happens to be logged in", and the keyless assertion below passes or fails
 * on the contents of `~/.config/elapse/config.json`.
 */
function throughSymlink(args: string[]): { stdout: string; status: number } {
  const home = mkdtempSync(join(tmpdir(), "elapse-bin-"));
  const link = join(home, "elapse");
  symlinkSync(dist, link);
  const env = { ...process.env, XDG_CONFIG_HOME: join(home, "config") };
  for (const k of Object.keys(env)) if (k.startsWith("ELAPSE_")) delete env[k];
  try {
    return { stdout: execFileSync(process.execPath, [link, ...args], { encoding: "utf8", env }), status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? 1 };
  }
}

describe("FR-CLI-030 the installed binary runs", () => {
  test("--version prints the version when invoked through a symlink", () => {
    const { stdout, status } = throughSymlink(["--version"]);
    expect(stdout.trim(), "the bin produced no output — main() never ran").not.toBe("");
    expect(stdout).toContain(".");
    expect(status).toBe(0);
  });

  test("--help prints usage when invoked through a symlink", () => {
    const { stdout } = throughSymlink(["--help"]);
    expect(stdout, "the bin produced no output — main() never ran").toContain("elapse listen --forward");
  });

  test("a command that needs a key still reports the auth error, rather than exiting silently", () => {
    const { stdout, status } = throughSymlink(["events", "list"]);
    expect(stdout + String(status), "a keyless invocation must say something").not.toBe("0");
    expect(status, "no key is a usage/auth error (FR-CLI-032), never a silent success").not.toBe(0);
  });
});
