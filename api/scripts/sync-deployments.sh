#!/usr/bin/env sh
# Copies contracts/deployments/<chainId>.json into api/deployments so the API deploy (Railway builds
# from api/ alone) knows the factory, token and treasury per chain. Never hand-edit.
set -eu
cd "$(dirname "$0")/.."
for f in ../contracts/deployments/[0-9]*.json; do
  case "$f" in *.killgate.json) continue;; esac
  cp "$f" deployments/
done
echo "deployments copied"
