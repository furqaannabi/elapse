#!/usr/bin/env bash
# Run the Week 1 kill gate on Monad testnet with the `elapse-dev` keystore.
# Usage: ./killgate-testnet.sh start     then, after 83+ seconds:
#        ./killgate-testnet.sh cancel
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"
STEP="${1:?usage: ./killgate-testnet.sh start|cancel}"
forge script script/KillGate.s.sol --sig "${STEP}()" \
  --rpc-url monad_testnet \
  --broadcast \
  --account elapse-dev
