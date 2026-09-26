#!/usr/bin/env bash
# Runs ON the EC2 host, piped over SSH by .github/workflows/deploy-ec2.yml.
# Fast-forwards the checkout to the commit CI just passed, rebuilds, and waits for the API to be healthy.
# Then redeploys both examples (ADR 2026-09-26, Deploy EC2 redeploys the examples on every deploy).
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

api_ok=""
for i in $(seq 1 45); do
  if curl -fsS -m 5 http://127.0.0.1:4000/v1/status >/dev/null; then
    echo "api healthy after ~$((i * 2))s"
    $COMPOSE ps
    docker image prune -f >/dev/null
    api_ok=1
    break
  fi
  sleep 2
done
if [ -z "$api_ok" ]; then
  echo "api did not become healthy in 90s" >&2
  $COMPOSE ps >&2
  docker logs --tail 40 api-api-1 >&2 || true
  exit 1
fi

# The examples (FR-EXM-037). Plain systemd services beside the API, redeployed on every deploy.
# Their sessions live in memory, so this drops any meter running on them right now — the cost the
# ADR accepted in exchange for never having to log in to ship one.
if [ "$(id -u)" = 0 ]; then SUDO=(); else SUDO=(sudo -n); fi
if [ ${#SUDO[@]} -gt 0 ] && ! sudo -n true 2>/dev/null; then
  echo "the deploy user needs passwordless sudo to restart the examples" >&2
  exit 1
fi

for ex in saas lambda; do
  dir="$APP_DIR/examples/$ex"
  unit="elapse-$ex"
  # Not every host runs the examples: skip one whose service was never installed rather than fail.
  if ! systemctl cat "$unit" >/dev/null 2>&1; then
    echo "examples/$ex: $unit is not installed here — skipped"
    continue
  fi
  owner="$(stat -c %U "$dir")"
  # `npm ci`, never `npm install`: it installs exactly the lockfile and never rewrites it. Run with
  # sudo so it can replace a node_modules someone installed by hand as root, then handed back to
  # the user the service runs as, who has to read it.
  "${SUDO[@]}" bash -c "cd '$dir' && npm ci --no-audit --no-fund --silent && chown -R '$owner' node_modules"
  "${SUDO[@]}" systemctl restart "$unit"

  port="$("${SUDO[@]}" grep -E '^PORT=' "$dir/.env" | cut -d= -f2 | tr -d "\"'\r ")"
  ex_ok=""
  # `npm start` bundles the page and creates a Checkout session before it listens: allow it a minute.
  for i in $(seq 1 30); do
    if curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$port/"; then
      echo "examples/$ex healthy on :$port after ~$((i * 2))s"
      ex_ok=1
      break
    fi
    sleep 2
  done
  if [ -z "$ex_ok" ]; then
    echo "examples/$ex did not answer on :$port in 60s" >&2
    "${SUDO[@]}" journalctl -u "$unit" -n 40 --no-pager -o cat >&2 || true
    exit 1
  fi
done
