# Elapse specs

Spec-driven development for the whole project. **No code without a signed spec.**

## Hierarchy

1. `docs/elapse-detailed-document.pdf` — the product and build doc. What Elapse is, the frozen SDK surface, webhooks, architecture, six-week plan. Source of truth for product behaviour.
2. `docs/design-brief.md` — every surface, page, state, and rule for the frontend.
3. `docs/specs/*-frd.md` — **functional requirements per package or surface**, plus `…-technical-design.md` for the platform's data model, API, auth, webhook pipeline and environments. Numbered FRs and BRs that every feature, test, and PR maps to. Written by the agent from 1 and 2 (via `to-prd`), signed by the human before any build.
4. `DESIGN.md` — the recorded visual world. Tokens, type, components, motion. Every surface inherits it.

## Id scheme

| Prefix | Surface |
| --- | --- |
| `FR-LND-nnn` | Landing (`/`) |
| `FR-CHK-nnn` | Hosted checkout (`/c/[session]`) |
| `FR-DSH-nnn` | Merchant dashboard (`/dashboard/*`) |
| `FR-MTR-nnn` | Meter primitives (math, `useMeter`, `Readout`, `ChartStrip`) shared by all surfaces |
| `FR-CON-nnn` | Contracts (`StreamFactory`, `AccrualStream`) |
| `FR-API-nnn` | Platform API |
| `FR-IDX-nnn` | Indexer (Envio HyperIndex → ingest) |
| `FR-WRK-nnn` | Webhook worker and keeper |
| `FR-SDK-nnn` | `@elapse/sdk` TypeScript (and `elapse` Python stretch) |
| `FR-CLI-nnn` | `@elapse/cli` (`listen --forward`, login, resend) |
| `FR-DOC-nnn` | Docs site (docs.elapse.finance) |
| `FR-EXM-nnn` | `examples/saas` reference merchant |
| `FR-RCT-nnn` | `@elapse/react` (`sdk/react`): authorise, meter, receipt components, hooks, theme, sound |
| `BR-xxx-nnn` | Business rules the surface must enforce (money, security, copy) |

**Naming.** Specs are living documents, so file names carry no date: `checkout-frd.md`, `technical-design.md`. Each ends with a Revision table (date, who, change). Dated files belong in `docs/decisions/` (ADRs), which never change after they are written.

FRs are user-facing behaviour ("As a subscriber I can…"). BRs are constraints ("Amounts never round up"). Both are testable.

## Status

| Spec | Status | Signed |
| --- | --- | --- |
| `technical-design.md` | Draft — aligned 2026-09-05 with the signed API FRD, which is authoritative where they differ | — |
| `meter-frd.md` | Built (retro-documented) | — |
| `landing-frd.md` | Built (retro-documented) · FR-LND-014–019 founders-and-finance rework **signed and built 2026-09-08** | — |
| `checkout-frd.md` | **Signed** · built against the mock API · Surface 4 `/account` (FR-CHK-016–026) **signed 2026-09-04**, built on the mock; real-data amendments and FR-CHK-029 **signed and built 2026-09-07** · FR-CHK-007 start-again amendment **signed and built 2026-09-07** · FR-CHK-027 identity proof **signed and built 2026-09-07** · FR-CHK-030 pause/resume and the FR-CHK-005/018 Stop amendments **signed and built 2026-09-07** · FR-CHK-031 Add funds **signed and built 2026-09-07** · FR-CHK-032 meter follows the server **signed and built 2026-09-09** · AUSD-only token amendments **signed 2026-09-13** · FR-CHK-033–036 + FR-CHK-032 amendment (held state, auto-return) **signed 2026-09-16 (Furqaan)** · FR-CHK-037–040 (merchant stops; Elapse popup; `/c` retired) **signed 2026-09-17 (Furqaan)** · FR-CHK-040 amendment (delete `/c` now) **signed 2026-09-17 (Furqaan)** · FR-CHK-038 amendment (framed authorise, `frame-ancestors`) **signed 2026-09-19 (Furqaan)** · FR-CHK-034 amendment (held view without Stop) **signed 2026-09-19 (Furqaan)** · FR-CHK-030 **withdrawn, signed and built 2026-09-20** (no subscriber pause) | William, 2026-09-03 and 2026-09-04 |
| `dashboard-frd.md` | **Signed** · built against the mock API (all FR-DSH except the subscriber `/account` which lives in the checkout spec) · FR-DSH-093 event context line **signed and built 2026-09-09** · FR-DSH-114–118 forms hardening **signed and built 2026-09-07** · FR-DSH-005 search as you type **signed and built 2026-09-09** · FR-DSH-126 lists page with Load more **signed and built 2026-09-09** · AUSD-only token amendments **signed 2026-09-13** | William, 2026-09-03 |
| `contracts-frd.md` | FR-CON-022/023 amendments + FR-CON-074 (keeper may pause/resume) **signed, built and redeployed 2026-09-19**, factory 0x6D6A…8695, Sourcify-verified, fee 200 bps from the constructor · **Signed** · built and **deployed to Monad testnet 2026-09-05**; 51 tests + invariants green; kill gate FR-CON-073 passed on chain (indexer clause pending Week 3). Furqaan reviews money movement on arrival · FR-CON-018 relayed pause/resume **signed and built 2026-09-07** (redeployed 2026-09-07, factory 0x4B76…2840) · AUSD-only token amendments **signed 2026-09-13**  · FR-CON-019/055/056 merchant-started metering **signed 2026-09-14 (Furqaan)** (money movement) · **redeployed 2026-09-14**, factory 0x4C35…3649, Sourcify-verified; fee 200 bps (set 2026-09-14) · FR-CON-056 amendment (subscriber Stop before start, test only) **signed 2026-09-16 (Furqaan)** · FR-CON-057 only the merchant stops a merchant-started meter **signed 2026-09-17 (Furqaan)** · FR-CON-057/056 amendments (the subscriber cannot stop a held meter either) **signed, built and redeployed 2026-09-19**, factory 0xD585…7907, Sourcify-verified · FR-CON-018 relay pause/resume **withdrawn, signed and redeployed 2026-09-20**, factory 0x9Df0…8052, Sourcify-verified | William, 2026-09-05 |
| `api-frd.md` | FR-API-141/142 (merchant pause/resume) **signed 2026-09-19 (Furqaan)** · **Signed** · grilled 2026-09-05 · FR-API-136 event context **signed and built 2026-09-09** · FR-API-135 dashboard search **signed and built 2026-09-09** · FR-API-120/125 and the FR-API-032 amendment (identity token) **signed and built 2026-09-07** · FR-API-044..047 subscriber pause/resume **signed and built 2026-09-07** · FR-API-048 balance + FR-API-034 AUSD amendment **signed and built 2026-09-07** · FR-API-075 relayer runway **signed 2026-09-08** · FR-API-040 `manage_url` amendment **signed and built 2026-09-09** · AUSD-only token amendments **signed 2026-09-13**  · FR-API-049/127 + FR-API-033/071 amendments **signed 2026-09-14** · FR-API-137/138 (start mode and refund time for the subscriber) **signed 2026-09-16 (Furqaan)** · FR-API-139/140 (merchant stops; no hosted checkout) **signed 2026-09-17 (Furqaan)** · FR-API-137 amendment (no subscriber cancel while held) **signed 2026-09-19 (Furqaan)** · FR-API-143 (`start_tx`/`end_tx` on the public session) **signed 2026-09-19 (Furqaan)** · FR-API-044–047 subscriber pause/resume **withdrawn, signed and built 2026-09-20** | William, 2026-09-05 |
| `indexer-frd.md` | **Signed** · Undecided 1–5 closed; FR-IDX-024/062 deferred to Week 4 | William, 2026-09-05 |
| `worker-frd.md` | **Signed** · Week 2 delivery loop first; keeper/heartbeat Week 3, notices/CLI Week 4 · FR-WRK-074 relayer gas sample **signed 2026-09-08** · FR-WRK-042 expiry notices **built 2026-09-09**  · FR-WRK-075 unstarted sweep **signed 2026-09-14** | William, 2026-09-05 |
| `sdk-frd.md` | FR-SDK-044 (0.3.0 pause/resume, frozen-surface change) **signed 2026-09-19 (Furqaan)** · **Signed** · `@elapse/sdk@0.1.0` on npm; **Python frozen out of the submission 2026-09-07** (FR-SDK-041) · FR-SDK-005 `manage_url` amendment **signed and built 2026-09-09**  · FR-SDK-009 `subscriptions.start` — **frozen-surface change signed 2026-09-14** · FR-SDK-042 (0.1.4, `Product.start_mode`) **signed 2026-09-16 (Furqaan)** · FR-SDK-043 (0.2.0, no `url`) **signed 2026-09-17 (Furqaan)** | William, 2026-09-05 |
| `react-sdk-frd.md` | FR-RCT-046 (the request's waiting line lives in `<Meter>`) **signed 2026-09-21 (Furqaan)** · FR-RCT-020 amendment (held follows `subscriber_can_stop`) **signed 2026-09-19 (Furqaan)** · FR-RCT-042 docked meter **signed and built 2026-09-19** · FR-RCT-043/044 authorise in a modal frame **signed 2026-09-19 (Furqaan)** · FR-RCT-045 proof drop + FR-RCT-023 `<TxLink>` **signed 2026-09-19 (Furqaan)** · **Signed 2026-09-17 (Furqaan)** · `@elapse/react` replaces the hosted checkout; every signature in the Elapse popup · FR-RCT-001 amendment (stylesheet, README, `./math` built, CDN `mount()`) **built 2026-09-18, awaiting sign-off** · FR-RCT-045 amendment (an ended meter proves both ends) **signed and built 2026-09-20** · FR-RCT-010 amendment (merchant-chosen cap) **signed and built 2026-09-20** · FR-RCT-043/044 (window only, modal frame withdrawn) **signed and built 2026-09-20** · FR-RCT-045 amendment (the proof stays) **signed and built 2026-09-20** · **`@elapse/react@0.2.0` on npm 2026-09-20** · FR-RCT-021 amendment (Stop only) **signed 2026-09-20**; Pause/Resume as requests to the merchant **signed and built 2026-09-21** · FR-RCT-020 (the homepage's instrument UI) **built, awaiting sign-off 2026-09-21** | — |
| `cli-frd.md` | **Signed** · built 2026-09-06 (API FR-API-130–134 + `cli/`), proven on the local API; npm publish pending the `@elapse` scope check | William, 2026-09-06 |
| `docs-site-frd.md` | **Signed** · built 2026-09-06 (`docs-site/`, snippet sync, surface check, CI workflow); Mintlify hosting connect and hosted API URL pending · FR-DOC-022 manage section **signed and built 2026-09-09** · FR-DOC-047 React page **signed 2026-09-17, built 2026-09-19** | William, 2026-09-06 |
| `examples-frd.md` | FR-EXM-033/034 (pause asked of the merchant; FR-EXM-035 withdrawn for React FR-RCT-046) + the FR-EXM-003 and FR-EXM-032 amendments **signed 2026-09-21 (Furqaan)** · **Signed** · built and proven 2026-09-06, including the FR-EXM-031 CI job · FR-EXM-032 `@elapse/react` **signed 2026-09-17 (Furqaan)** · FR-EXM-032 amendment (esbuild bundle) **signed 2026-09-17 (Furqaan)** | William, 2026-09-06 |
| `examples-lambda-frd.md` | FR-EXM-153/154 (meter runs only while code runs) **signed 2026-09-19 (Furqaan)** · **Signed** · per-second serverless-compute example on real AWS Lambda; auto-lifecycle (first-Run start, heartbeat/idle/beacon/cap end); runner infra live 2026-09-12; build in progress · merchant-start amendments FR-EXM-102/114/115/125/126/133 **signed 2026-09-16 (Furqaan)** · FR-EXM-152 `@elapse/react` **signed 2026-09-17 (Furqaan)** · FR-EXM-152 amendment (esbuild bundle) **signed 2026-09-17 (Furqaan)** · merchant-start + `@elapse/react` console **built 2026-09-18** · FR-EXM-153/154 amendments (the session ends with the run) **signed and built 2026-09-20** · FR-EXM-152 amendment (no cap step) **signed and built 2026-09-20** | Furqaan, 2026-09-12 |

## Process

1. Agent runs `grill-me` on the surface: developer questions, one at a time, with a recommended answer each.
2. Agent runs `to-prd` to write the FRD from the answers, the detailed doc, and the design brief. Every FR has an acceptance test in mind.
3. Human signs (edits the Status row above to "Signed" with the date).
4. Build: `tdd` per FR — failing test named after the FR id, then implementation. Visual work through `/impeccable`.
5. PR description lists the FR ids it closes.
