# Onboarding

You have read `docs/README.md`. This gets you running and tells you how we work.

## Setup (15 minutes)

```bash
git clone git@github.com:furqaannabi/elapse.git && cd elapse
corepack enable            # pnpm 9.15 is pinned in package.json
pnpm install
```

There is no root env file. Each process loads its own, and each package ships an example next to it:

| Package | Env file | Loaded by |
| --- | --- | --- |
| `api/` (API and worker) | `api/.env` from `api/.env.example` | Bun, automatically |
| `web/` | `web/.env.local` | Next.js |
| `indexer/` | `indexer/.env` from `indexer/.env.example` | Envio |
| `examples/saas/` | `examples/saas/.env` from its `.env.example` | dotenv |

| Package | Run | Test | Notes |
| --- | --- | --- | --- |
| `api/` | `bun run migrate && bun src/index.ts` (:4000); worker `bun src/worker/index.ts` | `bun test` | Postgres in Docker on 55434; `bun run seed-merchant` prints a test key; `bun run openapi` after a public route change |
| `web/` | `pnpm --filter web dev` (:3000) | `pnpm --filter web test` · `typecheck` · `lint` | Next.js 16, Tailwind v4, shadcn, Motion |
| `indexer/` | `pnpm envio dev` (:8080) | `pnpm test` | Envio HyperIndex; posts to the API's `/internal/ingest` |
| `contracts/` | `forge build` | `forge test` | Foundry; install `forge-std` first (`forge install foundry-rs/forge-std`) |
| `sdk/ts/` | `pnpm build` | `pnpm test` | Published as `@elapse/sdk` |
| `cli/` | `pnpm build` then `node dist/elapse.js listen --forward …` | `pnpm test` | `@elapse/cli`, unpublished until Week 6 |
| `examples/saas/` | `npm start` (use `PORT=3001` when `web` holds 3000) | `pnpm test` | The Quickstart merchant; installs the published SDK |

Node 20+ for `web/`, the SDK, the CLI and the example; **Bun** for `api/` (decided by Furqaan); Foundry for `contracts/`. macOS, Linux, or WSL.

## How we work

1. **Find the FR.** Every task maps to an FR id in `docs/specs/`. If there is no FR, write or extend the spec first and get it signed (status table in `docs/specs/README.md`).
2. **Test first.** Name the failing test after the FR (`FR-MTR-004 settles on whole seconds`). Then implement. Components get tests too.
3. **Small PRs, one feature each.** PR description lists the FR ids it closes. Branch names `feat/<area>-<thing>`, `fix/…`.
4. **Domain language exactly** (`docs/glossary.md`). Ids are prefixed. Rates are decimal strings. Money is integer math.
5. **Security is a design constraint** (technical design §7). Webhook signature before parse; secrets hashed and shown once; no chain words on the subscriber side.
6. **Undecided means undecided.** If a spec says "Undecided (human)", ask Furqaan or William; do not pick silently.
7. **Frontend inherits `DESIGN.md`.** Tokens, type, components, motion are recorded there; no new palettes or fonts without updating it.

## Who owns what (2026-09-03)

| Area | Owner |
| --- | --- |
| Product direction, architecture decisions | Furqaan |
| Web (landing, checkout, dashboard), design system | William |
| Contracts, API, indexer, worker, SDK, docs site | Furqaan when available; William picks these up after the frontend, so the specs are written to be buildable by either |
| Anything else | ask in the team channel; record the answer in the relevant spec |

## Milestones

Six-week plan in the detailed doc §12. The gates that matter:

- **Week 1 — meter is real.** `AccrualStream` + factory on testnet; start → cancel → settle elapsed. If this cannot be done, the project is dead (doc §12 kill criterion).
- **Week 2 —** API keys, `products.create`, `checkout.sessions.create`, signed POST, `constructEvent` unit-tested.
- **Week 3 —** hosted checkout with Privy; docs shell; Envio → ingest → worker.
- **Week 4 —** dashboard keys/deliveries/resend; CLI listen; full event catalog; OpenAPI in docs.
- **Week 5 —** mainnet factory, real AUSD; Python SDK or freeze TS-only.
- **Week 6 —** video = demo script; judges can clone `examples/saas` and receive a webhook. **Submit 13 Oct.**

## Useful paths

| What | Where |
| --- | --- |
| Product truth | `docs/elapse-detailed-document.pdf` |
| Architecture | `docs/architecture.md` |
| Specs | `docs/specs/` |
| Design system | `DESIGN.md` (frontend), `docs/design-brief.md` (pages and states) |
| Webhook signature reference implementation | `sdk/ts/src/index.ts` |
| Meter math (the only money math in the UI) | `web/src/lib/meter/math.ts` |
