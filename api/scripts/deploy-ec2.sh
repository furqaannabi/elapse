#!/usr/bin/env bash
# Runs ON the EC2 host, piped over SSH by .github/workflows/deploy-ec2.yml.
# Fast-forwards the checkout to the commit CI just passed, rebuilds, and waits for the API to be healthy.
# Never force-resets: a checkout that has diverged on the box fails the deploy instead of losing work.
set -euo pipefail

APP_DIR="${APP_DIR:-/elapse}"
COMPOSE="docker compose -f api/docker-compose.ec2.yml"
SHA="${1:?usage: deploy-ec2.sh <commit sha>}"

cd "$APP_DIR"
git fetch --quiet origin master
git merge --ff-only --quiet "$SHA"
echo "checked out $(git rev-parse --short HEAD)"

# Migrations run when the api container starts; the worker waits for api to be healthy (see the compose file).
$COMPOSE up -d --build --remove-orphans

for i in $(seq 1 45); do
  if curl -fsS -m 5 http://127.0.0.1:4000/v1/status >/dev/null; then
    echo "api healthy after ~$((i * 2))s"
    $COMPOSE ps
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

echo "api did not become healthy in 90s" >&2
$COMPOSE ps >&2
docker logs --tail 40 api-api-1 >&2 || true
exit 1
