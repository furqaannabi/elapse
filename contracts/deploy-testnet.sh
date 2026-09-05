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

