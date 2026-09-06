import { defineConfig } from "tsup";

/** One ESM file with a shebang: `dist/elapse.js`, the `elapse` bin (FR-CLI-030). `@elapse/sdk` stays a dependency. */
export default defineConfig({
  entry: { elapse: "src/main.ts" },
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  outDir: "dist",
});
