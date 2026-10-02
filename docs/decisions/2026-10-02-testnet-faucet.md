# A testnet faucet drops 15 AUSD from a wallet the API holds
2026-10-02 · Decided by Furqaan · Status: accepted

## Context
A judge cannot try Elapse unaided. Nothing mints AUSD (ADR 2026-09-13), and the Add funds step only shows the subscriber's address and asks them to send AUSD to it. Testnet AUSD comes from Agora's undocumented faucet (ADR 2026-09-11), which drips a fixed 10,000 AUSD per call behind a 60-second cooldown shared by every caller, and which that record keeps to team and demo wallets. A one-tap "Get testnet AUSD" button was deferred to after the hackathon, leaving the judge pass as "a driven demo with pre-funded wallets" — while the submission form asks for steps a judge can follow alone.

Three sources were weighed for a drop of our own size: a separate wallet held by the API, an on-chain faucet contract, and the relayer. The relayer was ruled out by its own record: it holds MON for gas and never AUSD (ADR 2026-09-04), and it is also the factory keeper. A contract would have meant new money-moving Solidity, a deploy and its verification inside the eleven days left.

## Decision
The API holds a separate faucet wallet under `FAUCET_PRIVATE_KEY`, and a hidden route beside the checkout balance sends one drop of **15 AUSD** to the signed-in subscriber's wallet. 15 is the smallest amount that lets a judge try both examples in turn — Acme GPU's one-hour cap escrows $14.40 and Northwind's $7.20 — because every session refunds what it did not use. Limits run over a rolling 24 hours: one drop per wallet, and none for a wallet already holding 15 AUSD or more; five per IP; 300 across the faucet. The faucet serves test-mode sessions only, its chain (10143) and token (testnet AUSD) are constants in code rather than configuration, and it is off unless the key is set. In the Elapse window it is one button on the Add funds step, "Get 15 test AUSD"; the step's existing balance poll moves the window on when the money lands.

## Consequences
Judges can start a meter with no help from the team, and the steps on the submission can say so. The cost is a second hot key on the host, holding only test money and never the relayer's. The faucet wallet needs a little MON for gas and is topped up with one Agora `requestFunds` call (10,000 AUSD, about 666 drops); the Agora faucet stays a team tool, as ADR 2026-09-11 has it. The daily ceiling of 300 drops (4,500 AUSD) caps what account farming can take, at the price that a busy day can run out until the window rolls. The per-IP limit is only as good as nginx overwriting `X-Forwarded-For`, which the EC2 compose header documents. This takes the "Get testnet AUSD" item out of the post-hackathon list, in a different shape than the one deferred: our wallet pays, not the API relaying Agora's faucet.

Specs: [api-frd](../specs/api-frd.md) FR-API-147/148/149, BR-API-009 · [checkout-frd](../specs/checkout-frd.md) FR-CHK-041.
