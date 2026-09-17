import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2022",
  // Peers stay imports.
  external: ["react", "react-dom", "react/jsx-runtime", "motion"],
});
