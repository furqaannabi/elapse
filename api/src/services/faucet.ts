/**
 * The testnet faucet's rules, in one place (FR-API-147/148, BR-API-009; ADR 2026-10-02).
 *
 * `dropFaucet` either sends one drop of 15 testnet AUSD to the subscriber's wallet or refuses with
 * the limit that stopped it and when it eases. Nothing is sent on a refusal, and nothing is recorded
 * unless a transfer was actually broadcast, so a failure never counts against anyone.
 *
 * Drops go out one at a time. The API is a single process, so an in-process queue is enough to keep
 * two presses from racing past the limits or reusing the faucet wallet's nonce.
 */
import type { Address, Hex } from "viem";
import { FAUCET_DROP_UNITS, faucetClient } from "../chain/faucet";
import { dropWindow, recordDrop } from "../db/faucet";

/** FR-API-148: rolling 24-hour limits. */
export const FAUCET_LIMITS = { perWallet: 1, perIp: 5, perDay: 300 } as const;
/** FR-API-151: the dashboard door's own limit, per merchant over a rolling 24 hours. */
export const DASHBOARD_FAUCET_PER_MERCHANT = 3;
/** The drop as a decimal string, as the API speaks money. */
export const FAUCET_AMOUNT_USD = "15";

export type FaucetCode = "faucet_unavailable" | "faucet_merchant_daily" | "faucet_wallet_daily" | "faucet_wallet_funded" | "faucet_ip_daily" | "faucet_daily";

export class FaucetRefusal extends Error {
  constructor(
    readonly status: 403 | 429 | 503,
    readonly code: FaucetCode,
    message: string,
    /** Unix seconds when the limit eases; absent when it does not ease with time. */
    readonly resetsAt?: number,
  ) {
    super(message);
  }
}

/** FR-API-149: whether a session's Add funds step should offer a drop at all. */
export function faucetOffered(session: { livemode: boolean }): boolean {
  return !session.livemode && faucetClient() !== null;
}

const aDayAfter = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) + 86_400 : Math.floor(Date.now() / 1000) + 86_400);

let queue: Promise<unknown> = Promise.resolve();

export interface DropInput {
  /** The mode the request came in: a live-mode request is refused before anything else. */
  livemode: boolean;
  wallet: Address;
  ip: string | null;
  /** FR-API-151: who asked — the checkout session's merchant, or the signed-in merchant. */
  merchantId: string;
  /** Which door. A dashboard drop counts toward the merchant's three a day unless `exempt`. */
  via: "checkout" | "dashboard";
  /** FR-API-151: the demo merchant is spared the per-merchant limit, and only that one. */
  exempt?: boolean;
}

export function dropFaucet(input: DropInput): Promise<{ amountUsd: string; txHash: Hex }> {
  const turn = queue.then(() => dropNow(input));
  queue = turn.catch(() => {});
  return turn;
}

async function dropNow({ livemode, wallet, ip, merchantId, via, exempt }: DropInput) {
  // BR-API-009: test mode only. A live request is refused before the key is even looked at.
  if (livemode) {
    throw new FaucetRefusal(403, "faucet_unavailable", "The test faucet serves test mode only.");
  }
  const faucet = faucetClient();
  if (!faucet) {
    throw new FaucetRefusal(503, "faucet_unavailable", "The test faucet is not available.");
  }

  const mine = await dropWindow({ wallet });
  if (mine.count >= FAUCET_LIMITS.perWallet) {
    throw new FaucetRefusal(429, "faucet_wallet_daily", "This wallet already had its test AUSD today.", aDayAfter(mine.oldest));
  }
  if (via === "dashboard" && !exempt) {
    const ours = await dropWindow({ merchant: merchantId });
    if (ours.count >= DASHBOARD_FAUCET_PER_MERCHANT) {
      throw new FaucetRefusal(429, "faucet_merchant_daily", "You've used your 3 test drops for today.", aDayAfter(ours.oldest));
    }
  }
  // Without a forwarded address there is no IP to count; behind nginx there always is one.
  if (ip) {
    const theirs = await dropWindow({ ip });
    if (theirs.count >= FAUCET_LIMITS.perIp) {
      throw new FaucetRefusal(429, "faucet_ip_daily", "Too many test AUSD requests from this network today.", aDayAfter(theirs.oldest));
    }
  }
  const all = await dropWindow("all");
  if (all.count >= FAUCET_LIMITS.perDay) {
    throw new FaucetRefusal(429, "faucet_daily", "The test faucet has given out its share for today.", aDayAfter(all.oldest));
  }
  if ((await faucet.balanceOf(wallet)) >= FAUCET_DROP_UNITS) {
    throw new FaucetRefusal(429, "faucet_wallet_funded", "This wallet already holds 15 test AUSD or more.");
  }

  let txHash: Hex;
  try {
    txHash = await faucet.transfer(wallet, FAUCET_DROP_UNITS);
  } catch {
    // Out of AUSD, out of gas, or the RPC is down. The reason is the operator's to read on chain;
    // the subscriber is told the faucet cannot pay and keeps the address as the way forward.
    throw new FaucetRefusal(503, "faucet_unavailable", "The test faucet can't pay right now.");
  }
  await recordDrop({ wallet, ip, units: FAUCET_DROP_UNITS, txHash, merchantId, via });
  return { amountUsd: FAUCET_AMOUNT_USD, txHash };
}
