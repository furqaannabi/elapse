#!/usr/bin/env bash
# Deploy the factory (+ MockUSD) to Monad testnet with the `elapse-dev` keystore.
# Prompts for the keystore password. Writes deployments/10143.json.
# Usage: ./deploy-testnet.sh <treasury-address>
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"
TREASURY="${1:?usage: ./deploy-testnet.sh <treasury-address>}"
TREASURY="$TREASURY" forge script script/Deploy.s.sol \
  --rpc-url monad_testnet \
  --broadcast \
  --account elapse-dev
