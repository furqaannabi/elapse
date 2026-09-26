# Deploy EC2 redeploys the examples on every deploy
2026-09-26 · Decided by Furqaan · Status: accepted

## Context
Deploy EC2 runs `api/scripts/deploy-ec2.sh` on the host after every green push to `master`: it fast-forwards `/elapse` and rebuilds the API containers. The two examples at `examples.elapse.finance` (FR-EXM-037) run beside it as plain systemd services and were never part of it, so every change to them needed someone on the box to `git pull`, `npm ci` and restart. Both keep their live sessions in memory, so a restart drops any meter in flight. Three options were weighed: redeploy an example only when a push changes it, redeploy both on every deploy, or leave it to a manually triggered workflow.

## Decision
Every deploy redeploys both examples. After the API is healthy, the script runs `npm ci` in each example that has its service installed, hands the dependencies back to the service's user, restarts `elapse-saas` and `elapse-lambda`, and waits for each to answer on its own port. An example that does not come back fails the deploy. The workflow then checks both public pages as it already checks the API.

## Consequences
The examples are never out of step with `master`, and nobody has to log in to ship one. The cost is on every green push, including ones that touch only the API: any meter running on the examples at that moment is dropped. Under one session per run (ADR 2026-09-26, the Lambda session ends with its run) a Northwind session lasts about half a minute, and the unstarted sweep refunds anything stranded, so the exposure is short; for Acme GPU, whose meter can run for as long as its cap, it is not. Avoid pushing to `master` while a demo is live on the examples. An example whose service is not installed on the host is skipped rather than failing the deploy.

Scripts: `api/scripts/deploy-ec2.sh`, `.github/workflows/deploy-ec2.yml`. Hosting: examples FRD FR-EXM-037, ADR 2026-09-26 examples on one subdomain.
