# `@elapse/cli`

```
npx @elapse/cli listen --forward localhost:3000/webhooks
```

Receive your Elapse webhooks on localhost. The CLI opens a session with the platform, streams every Delivery addressed to your CLI endpoint, prints the signed body and its `X-Elapse-Signature`, POSTs the **exact bytes** to your local server, and reports the status code back so the dashboard's delivery log shows it. Nothing is re-signed: `constructEvent` in your server verifies the platform's real signature.

Spec: `docs/specs/cli-frd.md` (FR-CLI-*). Decision: `docs/decisions/2026-09-06-cli-transport-and-session.md`.

## Commands

```
elapse login                                   paste a secret key (hidden), saved to ~/.config/elapse/config.json (0600)
elapse logout
elapse listen --forward <url> [--events a,b] [--compact] [--no-forward] [--print-secret] [--live]
elapse events list [--limit n] [--type t]
elapse events resend <evt_id>                  redeliver an Event to every endpoint (and the CLI, while listening)
elapse products create --name <s> --rate <decimal>
elapse checkout create --product <prod_id> --success-url <u> --cancel-url <u>
Global: --api-key, --base-url, --json, --help, --version · Env: ELAPSE_SECRET_KEY, ELAPSE_BASE_URL, NO_COLOR
```

Exit codes: 0 ok · 1 runtime error · 2 usage or auth error.

## How it works

- `POST /v1/cli/sessions` returns your one persistent CLI endpoint per mode and its `whsec_`. Put that secret in `ELAPSE_WEBHOOK_SECRET`; it is the same on every run.
- `GET /v1/cli/sessions/:id/stream` is server-sent events. The CLI reconnects with 1 s → 30 s backoff; frames not acked are re-sent.
- The CLI endpoint receives Deliveries only while a stream is open (60 s grace). Frames nobody acks for 10 minutes are marked skipped.
- Live keys print a `LIVE` banner and `listen` refuses without `--live`.

## Develop

```
pnpm install
pnpm test          # vitest: parser, forwarder, listen against a mock platform, commands
pnpm build         # dist/elapse.js (single ESM file with shebang)
ELAPSE_SECRET_KEY=sk_test_… ELAPSE_BASE_URL=http://localhost:4000 node dist/elapse.js listen --forward localhost:3000/webhooks
```

Dependencies: `@elapse/sdk` only. Argument parsing is Node's `util.parseArgs`.
