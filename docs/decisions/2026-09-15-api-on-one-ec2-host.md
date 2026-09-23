# The API, the worker and Postgres move to one EC2 host
2026-09-15 · Decided by Furqaan · Status: accepted · Reverses the hosting half of [2026-09-05 Railway + Neon](../specs/api-frd.md) (API FRD Undecided 11)

## Context

Hosting was decided on 2026-09-05: Railway for the API and the worker as two services, Neon for
Postgres, Vercel for `web/`, Envio hosted for the indexer. That held for ten days.

Two things changed. We already had AWS credits, which made a small instance effectively free where
the managed pair was not — and `examples/lambda` had already taken us into AWS ([ADR
2026-09-12](./2026-09-12-examples-lambda-aws-only.md)), so it was an account we were using anyway.
The second is the demo. A hackathon submission is filmed, not monitored: when a meter does not start
on camera, the question is what the worker is doing *right now*, and the answer has to be one `ssh`
away — logs, the database, a restart of one container — rather than whatever a dashboard chooses to
show. Railway and Neon are the right answer for a product with on-call; they are the wrong one for a
system two people have to reason about live, in a room, in October.

What was weighed against that: the backups stop being someone else's job, a single host is a single
point of failure, and Postgres now lives on a volume we own. All three are acceptable for a
submission running on testnet, and none of them are acceptable for real money later.

## Decision

The API, one worker and Postgres run as three containers on **one EC2 instance**, from
`api/docker-compose.ec2.yml`, behind the host's nginx. nginx terminates TLS for `api.elapse.finance`
and proxies to `127.0.0.1:4000`, the only published port; Postgres publishes nothing at all and is
reached only across the compose network. `.github/workflows/deploy-ec2.yml` deploys after a green CI
run on `master`, piping `api/scripts/deploy-ec2.sh` over SSH: it fast-forwards the checkout to that
commit, rebuilds, and waits for `/v1/status`. It never force-resets, so a box that has diverged
fails the deploy rather than losing work.

Vercel still serves `web/`, Envio still hosts the indexer, and local development is unchanged
(`api/docker-compose.yml`).

## Consequences

- **Backups are ours.** The `elapse-pg` volume is the database. EBS snapshots or a `pg_dump` cron,
  or the data is gone. Nothing schedules that yet.
- **Exactly one worker**, enforced by the compose file: two keepers would both submit `settle` and
  `cancel` transactions and burn relayer gas.
- **One host, one failure.** No standby, no region. A submission on testnet can take that; real
  money cannot, and mainnet needs this decision taken again.
- `RELAYER_PRIVATE_KEY` now sits in `api/.env` on a disk we own. Secrets Manager or SSM is the better
  home for it and is not done.
- `railway.toml` is still in the repo root and no longer serves anything.
- Every spec and record written before today still says Railway + Neon, by design — they are dated.
  `api/README.md`, `docs/onboarding.md` and `docs/specs/technical-design.md` describe the EC2 host.

## Note on the date

Decided and built on 15–16 September; this record was written on 23 September, when a documentation
audit found the cutover had happened without it. The compose file had said so itself since the first
commit: *"Moving off Railway + Neon reverses the recorded hosting choice and needs an ADR before
cutover."*
