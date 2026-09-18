# The CDN build of `@elapse/react` carries its own React and exposes one `mount()`
2026-09-18 · Decided by Furqaan · Status: accepted

## Context

`@elapse/react` 0.1.0 was about to be published without the pieces FR-RCT-001 promises: no stylesheet (the components reference `.elapse-card`, `.elapse-notice` and a dozen more classes that existed nowhere), no README, an `./math` export pointing at TypeScript source that only resolves inside this repo, and no browser build for `cdn.jsdelivr.net`.

The first three have one answer each. The CDN build does not: a page with no bundler has no React, and `<Meter>` is a React component. Three ways to give that page something that works were weighed.

## Decision

`dist/elapse.browser.js` bundles React, react-dom and motion and exposes two functions, `mount(target, options)` and `unmount(target)`, where `target` is an element or a CSS selector. The page writes one script tag and one call; the flow inside is the same one the components give a React app — the cap step, then the meter. It costs about 65 KB gzipped, and a page that already runs React would be shipping a second copy, so the README sends bundler users to the npm package instead.

Rejected: keeping react, react-dom and motion external and asking the merchant to write an import map from esm.sh (smaller, no duplicate React, but three versions to pin by hand and a blank component on any mismatch); and dropping the CDN build altogether by amendment, since both examples now bundle with esbuild (ADR 2026-09-17 examples bundle) — cheapest, but it removes the "paste this into your page" story before the submission.

Also settled, as consequences of the same review: `styles.css` is plain CSS scoped to `.elapse` with the DESIGN.md materials as CSS-variable defaults (`--elapse-accent`, `--elapse-bg`, `--elapse-fg`, `--elapse-muted`, `--elapse-radius`, `--elapse-font`), dark by default and light when the page or the system asks; `@elapse/react/math` is built to `dist/math.js` like any other entry; and the package ships a README.

## Consequences

- `mount` and `unmount` are public surface. They are not in §4.2 of the detailed document (that is the server SDK), but they are now in `react-sdk-frd.md` under FR-RCT-001 and must stay backward compatible after publish.
- Two supported shapes to keep working: the npm package with peers, and the self-contained CDN bundle. CI builds both; `test/packaging.test.ts` fails if the stylesheet stops covering a class the components render, if an export points back at `src/`, or if the CDN bundle starts importing React from outside itself.
- `web/` now needs `@elapse/react` built before it typechecks, because `@elapse/react/math` resolves to `dist`. The CI step builds first.
- FR-RCT-040's theme *prop* is still unbuilt; the variables it will set exist in the stylesheet now, so merchants can theme with CSS today.
- The 25 KB budget in FR-RCT-002 applies to the npm build (20 KB raw ESM today), not to the CDN bundle, which is React's size by definition.
