/**
 * FR-EXM-152 (ADR 2026-09-17 examples bundle): bundle the console — React, @elapse/react and its
 * stylesheet — from node_modules, so the page runs one React and needs no UMD build. Monaco still
 * loads from its own CDN. `npm start` runs this first.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/web/mount.tsx"],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  outfile: "dist/web.js",
  logLevel: "info",
});
