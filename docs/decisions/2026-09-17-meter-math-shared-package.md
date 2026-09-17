# Meter math moves to a shared workspace package, `@elapse/meter-core`
2026-09-17 · Decided by Furqaan · Status: accepted

## Context

The per-second money math (integer nano-dollars, elapsed time with pauses, whole-second settlement, floored USD formatting; meter FRD FR-MTR, checkout BR-CHK-003) lives in `web/src/lib/meter/math.ts`, with tests, and 33 files in `web/` import it. `@elapse/react` (ADR 2026-09-17 React SDK) must draw the same meter by the same rules (BR-RCT-005), in merchants' apps.

## Decision

Move `math.ts` and its tests into an internal workspace package, `sdk/meter-core` (`@elapse/meter-core`, private, never published). `web/src/lib/meter/math.ts` re-exports it, so no importer changes. `@elapse/react` bundles it at build time rather than depending on it at runtime. Rejected: copying the functions into `sdk/react`, which leaves two copies of money math free to drift; importing `web`'s source from `sdk/react`, which would make the app's folder layout a public API.

## Consequences

- One implementation of the rounding and accrual rules for the checkout, `/account`, the dashboard, the landing and every merchant's `<Meter>`.
- `web` transpiles the package (Next.js `transpilePackages`); any host that builds `web/` alone must install the workspace.
- `use-meter.ts` stays in `web` for now; `@elapse/react` builds its own hook on the shared math.
