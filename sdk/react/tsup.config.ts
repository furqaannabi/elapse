import { defineConfig } from "tsup";

export default defineConfig([
  {
    // `./math` is its own entry so `@elapse/react/math` resolves to a build output off npm,
    // not to TypeScript source (FR-RCT-001).
    entry: ["src/index.ts", "src/math.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    target: "es2022",
    // Peers stay imports.
    external: ["react", "react-dom", "react/jsx-runtime", "motion"],
  },
  {
    /*
     * The CDN build (FR-RCT-001; ADR 2026-09-18). A page with no bundler has no React, so this one
     * carries its own: React, react-dom and motion are bundled in and nothing is left to import.
     * Bundler users install the package instead and keep their single React.
     */
    entry: { "elapse.browser": "src/browser.tsx" },
    format: ["esm"],
    dts: false,
    clean: false,
    minify: true,
    platform: "browser",
    target: "es2022",
    noExternal: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "motion"],
    define: { "process.env.NODE_ENV": '"production"' },
  },
]);
