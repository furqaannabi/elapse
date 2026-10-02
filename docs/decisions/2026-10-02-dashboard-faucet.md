# The merchant dashboard sends test AUSD to any address
2026-10-02 · Decided by Furqaan · Status: accepted

## Context
The testnet faucet (ADR 2026-10-02 testnet-faucet) lives on the Add funds step of the Elapse window, so it only reaches a subscriber who is already inside a checkout. A merchant mid-integration needs test AUSD elsewhere too: in the wallet they will pay their own checkout from, in a teammate's wallet, or in a test script's. Three destinations were weighed: an address the merchant types, the merchant's own subscriber wallet, and the merchant's payout address. The dashboard sign-in (a magic link) is not linked to any Privy wallet, so there is no "own subscriber wallet" for the dashboard to send to, and the checkout button already covers that case. A payout address only receives settlements, and many merchants have not set one.

## Decision
A **Get test AUSD** card on the dashboard's Developers page, in test mode only, sends one 15 AUSD drop from the same faucet wallet to any Monad testnet address the merchant types. It shares the checkout faucet's limits — one drop per receiving address per 24 hours and none to an address holding 15 AUSD or more, five per IP, 300 across the faucet — and adds a fourth: **three drops per merchant per 24 hours**. The demo merchant (ADR 2026-10-02 demo-account) is exempt from the per-merchant limit, because every judge shares it; the per-IP and global limits still apply. The route is a hidden dashboard route that accepts the session cookie only, never a secret key, so the frozen SDK surface does not grow. Each drop writes an `audit_log` row and carries the merchant's id; it creates no event and no webhook, because it is not a billing object. A success shows the short address and a short tx id linking to the testnet explorer — the merchant surface's rule for chain detail.

## Consequences
A merchant can fund a test wallet without leaving the dashboard or asking the team. The faucet's daily pool now has two doors, so a busy day can empty it sooner; the 300-drop ceiling and the faucet wallet's 10,000 AUSD (about 666 drops per top-up) are unchanged. The demo exemption means the demo account is effectively a public faucet bounded only by IP and the daily pool — the same bound the checkout button already has. BR-API-009 (testnet only, test mode only, constants in code) covers this route as it covers the checkout one.

Builds on [2026-10-02 testnet faucet](./2026-10-02-testnet-faucet.md); does not supersede it.

Specs: [api-frd](../specs/api-frd.md) FR-API-150/151 · [dashboard-frd](../specs/dashboard-frd.md) FR-DSH-145.
