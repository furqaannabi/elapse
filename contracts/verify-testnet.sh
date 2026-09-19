#!/usr/bin/env bash
# Verify the deployed factory and its AccrualStream implementation on Sourcify.
# Reads deployments/<chainId>.json, so it runs after deploy-testnet.sh and again whenever a
# verification failed or timed out — verifying twice is harmless.
#
# Usage: ./verify-testnet.sh [chainId]            # default 10143 (Monad testnet)
#   VERIFIER_URL=…  a different Sourcify server (Monad's explorer uses
#                   https://sourcify-api-monad.blockvision.org; the default is sourcify.dev,
#                   which knows chain 10143 and 143).
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"

CHAIN="${1:-10143}"
FILE="deployments/${CHAIN}.json"
[ -f "$FILE" ] || { echo "no $FILE — deploy first"; exit 1; }
VERIFIER_URL="${VERIFIER_URL:-https://sourcify.dev/server}"

read -r FACTORY IMPL TREASURY <<<"$(python3 -c "
import json
d = json.load(open('$FILE'))
print(d['factory'], d['implementation'], d['treasury'])
")"

echo "chain $CHAIN · factory $FACTORY · implementation $IMPL"
echo "verifier $VERIFIER_URL"

# The factory takes the treasury; the implementation is deployed by the factory's constructor and
# takes none (FR-CON-062: every clone is an EIP-1167 proxy to it, so verifying it covers them all).
forge verify-contract "$FACTORY" src/StreamFactory.sol:StreamFactory \
  --chain-id "$CHAIN" --verifier sourcify --verifier-url "$VERIFIER_URL" \
  --constructor-args "$(cast abi-encode 'constructor(address)' "$TREASURY")" \
  --watch

forge verify-contract "$IMPL" src/AccrualStream.sol:AccrualStream \
  --chain-id "$CHAIN" --verifier sourcify --verifier-url "$VERIFIER_URL" \
  --watch

echo "Verified. Check https://testnet.monadscan.com/address/$FACTORY"
