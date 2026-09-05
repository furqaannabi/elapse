#!/usr/bin/env bash
# Run the Week 1 kill gate on Monad testnet with the `elapse-dev` keystore.
# Usage: ./killgate-testnet.sh start [token]   then, after 83+ seconds:
#        ./killgate-testnet.sh cancel
# Without a token it runs on the deployment's MockUSD and mints. With one
# (e.g. AUSD 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) the wallet must already
# hold at least 14.40 of it.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"
STEP="${1:?usage: ./killgate-testnet.sh start|cancel [token]}"
if [ -n "${2:-}" ]; then export TOKEN="$2"; fi
forge script script/KillGate.s.sol --sig "${STEP}()" \
  --rpc-url monad_testnet \
  --broadcast \
  --account elapse-dev
