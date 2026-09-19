#!/usr/bin/env bash
# Deploy the factory to Monad testnet from a cast keystore account.
# Prompts for the keystore password. Writes deployments/10143.json.
# Usage: ./deploy-testnet.sh <treasury-address> <keeper-address> [account]
# The keeper is the relayer wallet; it is set in the deploy run itself. The account is the
# keystore name the deploy signs with (`cast wallet list` shows them) and becomes the factory's
# owner, so it is the wallet that can later call setFee or setKeeper: pass the same one that owns
# the factory you are replacing. Defaults to `elapse-dev`.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"
TREASURY="${1:?usage: ./deploy-testnet.sh <treasury-address> <keeper-address> [account]}"
KEEPER="${2:?usage: ./deploy-testnet.sh <treasury-address> <keeper-address> [account]}"
ACCOUNT="${3:-elapse-dev}"

echo "Deploying with keystore account: $ACCOUNT  (treasury $TREASURY, keeper $KEEPER)"
TREASURY="$TREASURY" KEEPER="$KEEPER" forge script script/Deploy.s.sol \
  --rpc-url monad_testnet \
  --broadcast \
  --account "$ACCOUNT"

# Replace the simulation block with the real receipt block, and record the tx.
python3 - <<'PY'
import json
import glob
for path in glob.glob('deployments/*.json'):
    cid = path.split('/')[-1][:-5]
    try:
        b = json.load(open(f'broadcast/Deploy.s.sol/{cid}/run-latest.json'))
    except FileNotFoundError:
        continue
    d = json.load(open(path))
    d['deployedAtBlock'] = min(int(r['blockNumber'], 16) for r in b['receipts'])
    d['deployTx'] = b['receipts'][0]['transactionHash']
    json.dump(d, open(path, 'w'), indent=2); open(path, 'a').write('\n')
PY

# Verification is a separate step so a failed or rate-limited Sourcify run never leaves the
# deployment record unwritten, and so it can be re-run on its own.
./verify-testnet.sh "${CHAIN_ID:-10143}"
