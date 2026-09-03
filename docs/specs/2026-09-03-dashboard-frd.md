# Merchant dashboard (`/dashboard/*`) — FRD

Status: **Outline only** · Surface: Operate (merchant, desktop-first, responsive) · Sources: design brief Surface 3; detailed doc §3, §5.2, §8.

Fill in after the checkout is signed and built. The doc's MVP bar is "three pages, do not build Stripe Atlas": keys, products, subscriptions, webhook endpoints + delivery log with resend, payout address, test/live mode.

## Planned FR groups

| Range | Area |
| --- | --- |
| FR-DSH-001–009 | Shell: sidebar, top bar, test/live toggle with caution banner, search, user menu, mobile nav |
| FR-DSH-010–019 | Auth and onboarding: sign up, log in (method undecided), business name, payout address, first key reveal-once |
| FR-DSH-020–029 | Home: stat tiles, running meters with tiny readouts, recent events, quickstart checklist |
| FR-DSH-030–039 | Products: table, create/edit drawer (rate/s with per-min and per-hour), archive |
| FR-DSH-040–049 | Subscriptions: table with status chips, live inline readouts, detail with timeline and actions |
| FR-DSH-050–059 | Developers → API keys: publishable, secret list, create/reveal-once, roll/revoke, test vs live |
| FR-DSH-060–069 | Developers → Webhooks: endpoints, signing secret, event picker, send test, delivery log with resend |
| FR-DSH-070–079 | Developers → Events: log, filter, JSON viewer |
| FR-DSH-080–089 | Settings: profile, payout address, checkout branding with live preview, danger zone |
| FR-DSH-090–099 | Customers, Invoices (after MVP) |

## Business rules (known now)

| Id | Rule |
| --- | --- |
| BR-DSH-001 | Secrets are shown once; the UI never stores or re-displays them. |
| BR-DSH-002 | Test and live data never mix; the mode is always visible. |
| BR-DSH-003 | Status is carried by a word in a chip, never colour alone. |
| BR-DSH-004 | Tables become card stacks below `md`; never horizontal scroll. |
| BR-DSH-005 | Chain detail on the merchant side is understated: short tx id + external link. |

## Undecided (human)

- Merchant auth: email magic link vs passkey.
- Whether Customers and Invoices ship for 13 Oct.
