import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2022",
  // Peers stay imports; the shared meter math is inlined so it is never a runtime dependency (ADR 2026-09-17).
  external: ["react", "react-dom", "react/jsx-runtime", "motion"],
  noExternal: ["@elapse/meter-core"],
});
