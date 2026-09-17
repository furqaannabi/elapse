# Meter math lives inside `@elapse/react`; `@elapse/meter-core` is removed
2026-09-17 · Decided by Furqaan · Status: accepted · Supersedes [2026-09-17 meter math shared package](./2026-09-17-meter-math-shared-package.md)

## Context

Earlier the same day the meter math moved from `web` into a private workspace package, `@elapse/meter-core`, bundled into `@elapse/react` and imported by `web`. Furqaan asked to delete that package ("also delete meter core"). `web` still needs the math for the dashboard, landing and `/account` after the hosted checkout is removed.

## Decision

`math.ts` and its tests move into `@elapse/react` (`sdk/react/src/math.ts`). The package's main entry exports the functions, so merchants can build their own meter on the same rules. `web` imports them through the `@elapse/react/math` subpath, which points at the TypeScript source and is transpiled by Next.js (`transpilePackages`), so `web` needs no build of the SDK first. `@elapse/meter-core` is deleted. Rejected: moving the math back into `web` with a copy in `@elapse/react`, which gives two copies of money math free to drift.

## Consequences

- Still one implementation of the accrual, rounding and formatting rules.
- One fewer package; `@elapse/react` becomes the public home of the math (`formatUsd`, `accruedNano`, `elapsedMs`, …).
- The `./math` subpath is for workspace consumers; published installs use the main entry.
