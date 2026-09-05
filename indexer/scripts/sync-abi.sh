#!/usr/bin/env sh
# FR-IDX-003: copy event ABIs from the Foundry build output. Never hand-edit abis/.
# Usage: pnpm sync-abi   (run `forge build` in contracts/ first)
set -eu
cd "$(dirname "$0")/.."
for c in StreamFactory AccrualStream; do
  src="../contracts/out/$c.sol/$c.json"
  [ -f "$src" ] || { echo "missing $src — run forge build in contracts/" >&2; exit 1; }
  jq '.abi' "$src" > "abis/$c.json"
done
# Deployment records (factory, treasury, feeBps, deployedAtBlock) travel with the indexer so
# Envio Cloud, which builds from indexer/ alone, can seed the Factory entity (FR-IDX-013).
mkdir -p deployments
for f in ../contracts/deployments/[0-9]*.json; do
  case "$f" in *.killgate.json) continue;; esac
  cp "$f" deployments/
done
echo "abis synced from contracts/out; deployments copied"
