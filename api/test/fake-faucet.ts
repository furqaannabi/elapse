/**
 * A `FaucetClient` that never touches a chain (FR-API-147/148). It records every transfer and how
 * many were in flight at once, so a test can prove that drops go out one at a time.
 */
import type { Hex } from "viem";
import type { FaucetClient } from "../src/chain/faucet";

export function fakeFaucet() {
  const transfers: Array<{ to: string; units: bigint }> = [];
  const balances = new Map<string, bigint>();
  let failure: Error | null = null;
  let delayMs = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const client: FaucetClient = {
    address: "0xfa0ce7000000000000000000000000000000fa0c",
    async balanceOf(wallet) {
      return balances.get(wallet.toLowerCase()) ?? 0n;
    },
    async transfer(to, units) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (delayMs) await Bun.sleep(delayMs);
        if (failure) throw failure;
        transfers.push({ to: to.toLowerCase(), units });
        return `0x${transfers.length.toString(16).padStart(64, "0")}` as Hex;
      } finally {
        inFlight -= 1;
      }
    },
  };

  return {
    client,
    transfers,
    balances,
    failWith(e: Error | null) {
      failure = e;
    },
    slow(ms: number) {
      delayMs = ms;
    },
    get maxInFlight() {
      return maxInFlight;
    },
  };
}
