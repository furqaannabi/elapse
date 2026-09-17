# The examples bundle their browser pages with esbuild instead of loading `@elapse/react` from a CDN
2026-09-17 · Decided by Furqaan · Status: accepted

## Context

With the hosted checkout retired (ADR 2026-09-17 delete now), both reference merchants must authorise and meter in their own pages with `@elapse/react` (FR-EXM-032, FR-EXM-152). Neither example had a build step: `examples/saas` serves plain HTML, and the Lambda console loads React 18 and Monaco as UMD globals from a CDN. `@elapse/react` is an ES module that imports `react`, so a page mixing a UMD React with an ESM `@elapse/react` would run two Reacts and its hooks would break. The package is also not yet published, which a CDN build would need.

## Decision

Each example gets a small esbuild script, `build:web`, that bundles its browser page(s) with `react`, `react-dom` and `@elapse/react` from `node_modules`. `npm start` runs it first, so a judge still runs one command. The bundle is written to a gitignored folder the server serves. esbuild is already in the workspace lockfile (through tsup and vite). Rejected: an import map pointing at CDN ESM builds, which needs a published package and forces the console off UMD React in the page anyway; serving `sdk/react/dist` from the monorepo, which breaks for anyone who copies an example out of the repo.

## Consequences

- One React per page; the examples work from the workspace before publishing and from npm after.
- `npm start` takes a second longer on first run.
- Monaco's editor workers may stay on the CDN; only React and the components are bundled.
- Supersedes the CDN-loading clauses of FR-EXM-032 and FR-EXM-152 and the "no build step" constraint of the Lambda console (examples-lambda 2026-09-13 amendment).
