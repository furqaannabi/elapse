import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** FR-SDK-033: the README's §4.2 snippet compiles under strict tsc, verbatim. */
describe("README snippet", () => {
  it("compiles under tsc --noEmit", () => {
    const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
    const snippet = /```ts\n(import \{ Elapse \}[\s\S]*?)```/.exec(readme)![1]!;
    const dir = mkdtempSync(join(tmpdir(), "elapse-readme-"));
    writeFileSync(
      join(dir, "snippet.ts"),
      `declare const rawBody: string;\ndeclare const headers: Record<string, string | undefined>;\n${snippet.replace('from "@elapse/sdk"', `from "${join(__dirname, "..", "src", "index").replace(/\\/g, "/")}"`)}\nexport {};\n`,
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", skipLibCheck: true, types: ["node"], typeRoots: [join(__dirname, "..", "node_modules", "@types")] },
        files: ["snippet.ts"],
      }),
    );
    const out = execFileSync("node", [join(__dirname, "..", "node_modules", "typescript", "bin", "tsc"), "-p", dir], { encoding: "utf8", stdio: "pipe" });
    expect(out).toBe("");
  });
});
