/** Shared addresses and helpers for indexer tests. Lowercase because config sets address_format: lowercase. */
export const CHAIN = 10143 as const;
export const FACTORY = "0x656fa8b348981602acf36fad07804e806cc15d5b";
export const STREAM = "0x86776c5be46d01242285aac66040b3bf0634cd8a";
export const MERCHANT = "0x1111111111111111111111111111111111111111";
export const SUBSCRIBER = "0x2222222222222222222222222222222222222222";
export const TREASURY = "0xaf1444abf40afc91bcb4a6793765553c6bccea0d";
export const TOKEN = "0xb162dfde7073eb1b4dd6279efcd0568e9c09a21c";

/** 0.004 USD/s in 6-decimal base units, the kill-gate rate. */
export const RATE = 4_000n;
export const MAX_ESCROW = 14_400_000n;

/** Simulated blocks are offsets from the factory deployment block in config.yaml (start_block). */
export const START_BLOCK = 60_009_700;

let txCounter = 0;
/** Block/transaction metadata for a simulated event; `block` is an offset from START_BLOCK, each call gets a fresh tx hash. */
export function meta(block: number, logIndex = 0, timestamp = 1_757_000_000 + block) {
  txCounter += 1;
  const number = START_BLOCK + block;
  const hash = ("0x" + txCounter.toString(16).padStart(64, "0")) as `0x${string}`;
  return {
    block: { number, timestamp, hash: ("0xb" + number.toString(16).padStart(63, "0")) as `0x${string}` },
    transaction: { hash },
    logIndex,
  };
}

export function created(block = 100) {
  return {
    contract: "StreamFactory" as const,
    event: "StreamCreated" as const,
    params: { stream: STREAM, merchant: MERCHANT, subscriber: SUBSCRIBER, token: TOKEN, ratePerSecond: RATE, maxEscrow: MAX_ESCROW },
    ...meta(block),
  };
}

type StreamEventName = "Deposited" | "StreamStarted" | "StreamPaused" | "StreamResumed" | "Settled" | "StreamCanceled";
/** A simulated log on the kill-gate clone. */
export function onStream<N extends StreamEventName>(event: N, params: Record<string, unknown>, block: number, logIndex = 0) {
  return {
    contract: "AccrualStream" as const,
    event,
    srcAddress: STREAM as `0x${string}`,
    params: params as never,
    ...meta(block, logIndex),
  };
}
export const deposited = (block = 101, amount = MAX_ESCROW, total = amount) =>
  onStream("Deposited", { from: SUBSCRIBER, amount, totalDeposited: total }, block);

export const T0 = 1_757_000_000;
export const started = (block = 102, at = T0) =>
  onStream("StreamStarted", { merchant: MERCHANT, subscriber: SUBSCRIBER, ratePerSecond: RATE, startedAt: BigInt(at) }, block);
export const paused = (block: number, at: number) => onStream("StreamPaused", { at: BigInt(at), reason: 0n }, block);
export const resumed = (block: number, at: number) => onStream("StreamResumed", { at: BigInt(at) }, block);
export const settled = (block: number, seconds: bigint, amount: bigint, fee: bigint, logIndex = 0) =>
  onStream("Settled", { seconds_: seconds, amount, fee }, block, logIndex);
export const canceled = (block: number, at: number, secondsElapsed: bigint, amountSettled: bigint, amountRefunded: bigint, logIndex = 1) =>
  onStream("StreamCanceled", { at: BigInt(at), secondsElapsed, amountSettled, amountRefunded }, block, logIndex);
export const feeChanged = (block: number, bps: number, treasury = TREASURY) => ({
  contract: "StreamFactory" as const,
  event: "FeeChanged" as const,
  params: { bps: BigInt(bps), treasury },
  ...meta(block),
});

/** Kill gate (contracts FR-CON-073 as run on testnet): 220 s at 4000/s, 1 % fee, 14.4 escrow. */
export const KILL_GATE = {
  seconds: 220n,
  gross: 880_000n,
  fee: 8_800n,
  refund: 13_520_000n,
  sequence: () => [
    feeChanged(99, 100),
    created(100),
    deposited(101),
    started(102, T0),
    settled(150, 220n, 880_000n, 8_800n, 0),
    canceled(150, T0 + 220, 220n, 880_000n, 13_520_000n, 1),
  ],
};
