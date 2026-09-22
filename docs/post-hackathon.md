# Post-hackathon — what we knowingly left

Everything here is **known and deliberately not fixed before 13 October 2026**. Nothing on this
page blocks the submission; each item names where it is recorded, so the spec stays the source of
truth and this page stays an index.

Two rules for this file. An item arrives here only after the human decides to defer it, never
because the agent judged it unimportant. An item leaves only when it is fixed or superseded, and
the spec that owns it is updated in the same change.

## Defects found and deferred

| Item | Where recorded | Reach | Fix |
| --- | --- | --- | --- |
| **Merchant-fixed cap is unusable on the page.** A session created with `max_duration_seconds` is rejected at `prepare` with `cap_fixed` for any cap the subscriber picks. `real-api.ts` types the field but its mapper surfaces only `last_max_duration_seconds`, so `CapStep` never learns the cap is fixed and always renders a free picker. | [`specs/checkout-frd.md`](./specs/checkout-frd.md) → Open, 2026-09-11 | Not the dashboard (no UI sets the field) and not `examples/saas`. Does reach anyone following `checkout.mdx`, `sdks.mdx` or `testing.mdx`, all of which teach the parameter. | Client only, the API is correct: carry `max_duration_seconds` through the mapper and render a fixed cap as a stated duration instead of a picker. One mapper field, one branch, plus tests. |
| **A subscriber who picks an unaffordable cap is stranded.** The Add funds screen polls and advances by itself once the balance covers the cap, but offers no way back to the cap step — only "Not now", which leaves checkout. | This page. William decided 2026-09-11 to leave it. | A judge who tops up less than the cap on their own phone reaches a dead end. Does not affect a demo the team drives. | A Back control on the cap-step entry path only. The ready-view path has no cap step to return to, so it keeps funding or "Not now". Changes FR-CHK-031. |

## Deferred by decision

| Item | Decided | Where |
| --- | --- | --- |
| **Python SDK.** TypeScript only for the submission; Python is the first SDK item after it, built against the same FRD. | 2026-09-07, William | [ADR](./decisions/2026-09-07-sdk-typescript-only-for-submission.md), [`specs/sdk-frd.md`](./specs/sdk-frd.md) |
| **Amount-based settlement.** The keeper settles on a clock (hourly). Settling on accrued amount is the mainnet question. | 2026-09-08, William | [ADR](./decisions/2026-09-08-keeper-cadence-one-hour.md), [`specs/contracts-frd.md`](./specs/contracts-frd.md) |
| **Reorg handling.** `rollback_on_reorg: false` with `block_hash` stored on every row, to be revisited (FR-IDX-030). | 2026-09-06 | [`specs/indexer-frd.md`](./specs/indexer-frd.md) |
| **CLI device-code login.** `elapse login` pastes the key at a hidden prompt; a device-code flow is post-hackathon (FR-CLI-002). | 2026-09-06, William | [ADR](./decisions/2026-09-06-cli-transport-and-session.md), [`specs/cli-frd.md`](./specs/cli-frd.md) |
| **Test clocks / time travel** (FR-API-090/091). The demo cancels after real seconds; the docs page became "Testing" instead. | 2026-09-06, William | [`specs/api-frd.md`](./specs/api-frd.md) |
| **Delivery rate limiting per endpoint** (e.g. max 20 in flight). Not needed at MVP volume. | — | [`specs/worker-frd.md`](./specs/worker-frd.md) |
| **Mera wallet.** Privy only for subscribers; Mera revisited after submission. | — | [`architecture.md`](./architecture.md) |
| **Merchant-set cap in the dashboard.** `max_duration_seconds` is API-only; the dashboard's checkout link always leaves the cap to the subscriber. Defensible, but worth deciding on its own merits rather than by omission. | Raised 2026-09-11, William | This page |
| **One-tap "Get testnet AUSD" on the Add funds step.** With MockUSD removed no mode is self-serve; a faucet button (our API relays `requestFunds` to the subscriber's wallet) would restore a judge's solo checkout at the cost of a user path through the undocumented faucet and its 60 s global cooldown. Until then the judge pass is a driven demo with pre-funded wallets. | 2026-09-13, William (grill Q5, option A) | [ADR 2026-09-13](./decisions/2026-09-13-ausd-only-mockusd-to-test-fixture.md) |
| **A grace window for a CLI that reconnects.** FR-API-134 gives a disconnected `elapse listen` endpoint no Delivery at all, so events created while it is down are never recoverable — a merchant who restarts the CLI mid-session silently loses whatever passed in between. Queueing within a few minutes of the last connection would return those without growing a backlog for merchants who ran `elapse listen` once in August. Deferred because the failure it fixes is the one a merchant notices least, and it reverses a signed decision about queue growth three weeks from submission; FR-API-146 makes the loss visible instead. | 2026-09-22, William (grill Q1, option a) | [`specs/api-frd.md`](./specs/api-frd.md) FR-API-134, FR-API-146 |
| **A failed stop in `<Meter>` says the same thing whichever way it failed.** FR-RCT-062 asks for three treatments keyed on `SignatureError.reason` — a subscriber who closed the window, one whose browser blocked it, and one whose stop genuinely failed. Today all three set one string in one amber plate while the foot still reads "Running · stop any time" and the amount keeps climbing, so only the third is telling the truth. Written and unsigned. | 2026-09-22, William | [`specs/react-sdk-frd.md`](./specs/react-sdk-frd.md) FR-RCT-062 |

## Operational

| Item | Note |
| --- | --- |
| **Mainnet.** The submission runs on Monad testnet 10143. Live mode moves to chain 143 and mainnet AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` afterwards; MockUSD never leaves testnet. | [ADR 2026-09-07](./decisions/2026-09-07-add-money-and-ausd-live-on-testnet.md) |
| **`hello@elapse.finance` has no inbox.** The dashboard settings links point at it. William sets one up after the hackathon, probably Zoho. Do not build a contact form or change the address before then. | William, 2026-09-09 |
| **Testnet AUSD depends on an undocumented faucet.** Agora's `requestFunds` on Monad testnet funds team and demo wallets. If it empties or disappears the fallback is a direct request to Agora; no *platform* code path depends on it (reaffirmed 2026-09-13 — MockUSD is a test fixture now, so the faucet also fills the holding wallet that pre-funds demo subscriber wallets; check its AUSD alongside relayer MON before demos). The docs' Testing page names it as the self-serve source of testnet AUSD (William, 2026-09-13), so if it dies the page needs a new answer. | [ADR 2026-09-11](./decisions/2026-09-11-testnet-ausd-from-agora-faucet.md) |

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-11 | Claude (for William) | Created after the first live-mode run on the hosted app. Collected the items already deferred across the FRDs and ADRs, and added the four findings from that run. |
| 2026-09-11 | Claude (for William) | Docs gap fixed, so removed: the quickstart's first step now says an `export` lasts only as long as the terminal and to put both variables in `.env` and the host's environment settings. |
| 2026-09-11 | Claude (for William) | CLI version banner fixed, so removed: `listen.ts` had a hardcoded `0.1.0` and the test fixture pinned it, which is how it drifted. The banner now reads `CLI_VERSION`, the test asserts the running version, and `cli-listen.mdx` on the docs site regenerated to 0.1.2. |
| 2026-09-13 | Claude (for William) | AUSD-only decision ([ADR](./decisions/2026-09-13-ausd-only-mockusd-to-test-fixture.md)): added the deferred faucet-button candidate, updated the faucet note — MockUSD is no longer a fallback and demo wallets are pre-funded from the holding wallet. |
| 2026-09-22 | Claude (for William) | Recorded the FR-RCT-062 deferral, which I had told William was already on this page when it was not. The reason as I first gave it — "no subscriber Stop in the console" — was also wrong on its face: the Lambda console does show a stop, but it is Northwind's **End session** button in its own chrome (`console.tsx`), not `<Meter>`'s. `<Meter>` renders Stop only when `subscriber_can_stop` is true (`use-meter.ts`), which FR-API-139 makes false for a merchant-started meter, so the control FR-RCT-062 describes never appears in the demo and cannot fail there. Any merchant shipping a subscriber-stoppable meter with `<Meter controls>` does reach it; `/account` does not, having its own stop and its own error handling. |
