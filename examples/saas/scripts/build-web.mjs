/**
 * FR-EXM-032 (ADR 2026-09-17 examples bundle): bundle the product page's island with React and
 * @elapse/react from node_modules, so the page runs one React and needs no CDN. `npm start` runs this.
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
