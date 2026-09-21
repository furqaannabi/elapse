import { defineConfig } from "tsup";

/**
 * One ESM file with a shebang: `dist/elapse.js`, the `elapse` bin (FR-CLI-030). `@elapse/sdk`
 * stays a dependency. The entry is `src/bin.ts`, whose only job is to run — `main.ts` exports and
 * never decides whether to execute, because that decision is what broke every installed copy
 * through 0.1.4 (see `src/bin.ts`).
 */
export default defineConfig({
  entry: { elapse: "src/bin.ts" },
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  outDir: "dist",
});
