/**
 * Chain-log bodies shaped exactly as the indexer's postIngest Effect sends them
 * (indexer FR-IDX-020/022): decimal-string uint256s, lowercase addresses, a `ledger` array.
 * The kill-gate numbers are the testnet run recorded in contracts/README.md.
 */
export const CHAIN = 10143;
export const FACTORY = "0x656fa8b348981602acf36fad07804e806cc15d5b";
export const STREAM = "0x86776c5be46d01242285aac66040b3bf0634cd8a";
export const MERCHANT_ADDR = "0x1111111111111111111111111111111111111111";
export const SUBSCRIBER = "0x2222222222222222222222222222222222222222";
export const TREASURY = "0xaf1444abf40afc91bcb4a6793765553c6bccea0d";
export const TOKEN = "0xb162dfde7073eb1b4dd6279efcd0568e9c09a21c";
export const T0 = 1_757_000_000;

let n = 0;
export function txHash(): string {
  n += 1;
  return "0x" + n.toString(16).padStart(64, "0");
}

type Ledger = Array<{ kind: "deposit" | "settlement" | "fee" | "refund"; amount: string; from: string; to: string }>;

export function log(
  event_name: string,
  args: Record<string, string>,
  opts: { address?: string; block?: number; ts?: number; tx?: string | undefined; logIndex?: number; ledger?: Ledger; chainId?: number } = {},
) {
  const block = opts.block ?? 59_876_449;
  return {
    chain_id: opts.chainId ?? CHAIN,
    block_number: block,
    block_hash: "0xb" + block.toString(16).padStart(63, "0"),
    block_timestamp: opts.ts ?? T0,
    tx_hash: opts.tx ?? txHash(),
    log_index: opts.logIndex ?? 0,
    address: opts.address ?? STREAM,
    event_name,
    args,
    ledger: opts.ledger ?? [],
  };
}

export const streamCreated = (tx?: string) =>
  log("StreamCreated", { stream: STREAM, merchant: MERCHANT_ADDR, subscriber: SUBSCRIBER, token: TOKEN, ratePerSecond: "4000", maxEscrow: "14400000" }, { address: FACTORY, tx: tx ?? txHash(), logIndex: 0 });
export const deposited = (tx?: string) =>
  log("Deposited", { from: SUBSCRIBER, amount: "14400000", totalDeposited: "14400000" }, { tx, logIndex: 1, ledger: [{ kind: "deposit", amount: "14400000", from: SUBSCRIBER, to: STREAM }] });
export const streamStarted = (tx?: string, at = T0) =>
  log("StreamStarted", { merchant: MERCHANT_ADDR, subscriber: SUBSCRIBER, ratePerSecond: "4000", startedAt: String(at) }, { tx, logIndex: 2, ts: at });
export const streamPaused = (at: number) => log("StreamPaused", { at: String(at), reason: "0" }, { ts: at, block: 59_876_500 });
export const streamResumed = (at: number) => log("StreamResumed", { at: String(at) }, { ts: at, block: 59_876_600 });
export const settled = (seconds: number, amount: string, fee: string, ts: number, tx?: string, block = 59_877_161) =>
  log("Settled", { seconds: String(seconds), amount, fee }, {
    tx, logIndex: 0, ts, block,
    ledger: [
      { kind: "settlement", amount: (BigInt(amount) - BigInt(fee)).toString(), from: STREAM, to: MERCHANT_ADDR },
      ...(fee === "0" ? [] : [{ kind: "fee" as const, amount: fee, from: STREAM, to: TREASURY }]),
    ],
  });
export const streamCanceled = (at: number, secondsElapsed: number, amountSettled: string, amountRefunded: string, tx?: string, block = 59_877_161) =>
  log("StreamCanceled", { at: String(at), secondsElapsed: String(secondsElapsed), amountSettled, amountRefunded }, {
    tx, logIndex: 1, ts: at, block,
    ledger: amountRefunded === "0" ? [] : [{ kind: "refund", amount: amountRefunded, from: STREAM, to: SUBSCRIBER }],
  });

/** The 220-second testnet kill gate: create+deposit+start in one tx, settle+cancel in another. */
export function killGate() {
  const startTx = txHash();
  const cancelTx = txHash();
  return [
    streamCreated(startTx),
    deposited(startTx),
    streamStarted(startTx, T0),
    settled(220, "880000", "8800", T0 + 220, cancelTx),
    streamCanceled(T0 + 220, 220, "880000", "13520000", cancelTx),
  ];
}
