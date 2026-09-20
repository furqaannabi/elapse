# web — landing, `/authorize`, subscriber account, merchant dashboard

One Next.js 16 App Router app, deployed on Vercel at <https://elapse.finance>.

| Route | What | Rendering | Spec |
| --- | --- | --- | --- |
| `/` | Landing for founders and finance owners | Server component, static | `docs/specs/landing-frd.md` |
| `/authorize` | The page `@elapse/react` opens in a window for every signature: Privy sign-in, cap, Face ID permit, Add funds. Framed only by the origin of the session's `success_url`; falls back to a window when a passkey cannot be enrolled in a frame. | Client | `docs/specs/checkout-frd.md` (FR-CHK-038) |
| `/c/[session]` | Retired. One sentence pointing an old link back to the merchant (FR-CHK-040) | Client | `docs/specs/checkout-frd.md` |
| `/account` | The subscriber's meters and receipts across merchants | Client | `docs/specs/checkout-frd.md` (FR-CHK-016..030) |
| `/login`, `/dashboard/*` | Merchant dashboard: home, products, subscriptions, customers, invoices, balance and payouts, developers (keys, webhooks, events), settings | Client, cookie session | `docs/specs/dashboard-frd.md` |

Visual world: [`DESIGN.md`](../DESIGN.md) at the repo root. Every surface inherits it; no new direction is rolled per page.

The subscriber's meter now lives in the merchant's page, not here: [`@elapse/react`](../sdk/react) renders it and frames `/authorize` for the signatures.

## Run

```sh
pnpm install
cp .env.example .env
pnpm dev                                   # :3000
```

Two data sources, chosen at build time:

- **Mock.** `NEXT_PUBLIC_DASHBOARD_MOCK=1` runs the dashboard against the in-memory mock with a seeded merchant (`demo@elapse.finance`; the sign-in page shows the link instead of emailing it). The checkout serves `/c/cs_demo`, `/c/cs_ready`, `/c/cs_short` and the other seeded sessions from its own mock without a chain.
- **Real.** `NEXT_PUBLIC_ELAPSE_API_URL` pointing at `api/` (local `:4000` or the hosted API) plus `NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_CHAIN_ID`. Every other session id then goes to the real API.

`NEXT_PUBLIC_*` values are baked into the bundle at build time; a change needs a rebuild.

## Test

```sh
pnpm test            # vitest + testing-library, every component and lib
pnpm typecheck
pnpm lint            # eslint with the React Compiler rules; CI enforces it
```

Tests are named after the FR they close. Coverage target is 70 % on `src/components/**` and `src/lib/**`. `scripts/*-shots.mjs` take Playwright screenshots of each surface at phone and desktop widths against the mock; `scripts/dashboard-e2e.mjs` drives the dashboard end to end.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Routes only; each page mounts one feature component |
| `src/components/ui/` | Primitives (shadcn), no business logic |
| `src/components/meter/` | The ticker: `rate × (now − started_at)` at 100 ms, tabular numerals, no layout shift. Unit tests cover elapsed, accrued, rounding, pause, cancel |
| `src/components/landing/`, `checkout/`, `account/`, `dashboard/`, `login/` | Feature components, each under about 200 lines |
| `src/lib/checkout/`, `src/lib/dashboard/` | Typed API clients: `mock-api.ts` and `real-api.ts` behind one interface, `client.ts` picks; hooks such as `use-poll` and `use-paged-list` |
| `src/lib/meter/math.ts` | Decimal money as integer micro-dollars; never `parseFloat` on a rate |

## Rules

- Mobile first: base classes target 375 px, `sm:`/`md:`/`lg:` enhance upward. Touch targets at least 44 px. Tables become card stacks on phones.
- Subscriber copy never mentions wallets, chains, transactions, or addresses. The judge-mode panel on the checkout is the one exception.
- Motion is orchestrated and respects `prefers-reduced-motion`. Nothing blinks per second; the meter ticks.
- Merchant tokens live in an HttpOnly cookie set by the API, never in local storage. Subscriber auth is the Privy session and identity token.
- API paths live in `src/lib/*/real-api.ts` only, never in components.
