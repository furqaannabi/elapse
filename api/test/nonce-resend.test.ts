/**
 * FR-API-157: relayer sends survive a nonce collision (ADR 2026-10-03). Found by demo:seed on
 * testnet: a createWithPermit reused nonce 222 one second after the same process's cancelFor,
 * because the RPC's pending count lagged, and Monad refused it — "An existing transaction had
 * higher priority".
 */
import { describe, it, expect, afterEach } from "bun:test";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { isNonceClash, RESEND_DELAYS_MS, sendWithResend } from "../src/chain/nonce-resend";
import { viemChainClient } from "../src/chain/relayer";

const clash = (message: string) => Object.assign(new Error("Missing or invalid parameters."), { details: message });

function recorder() {
  const waits: number[] = [];
  const logs: Array<Record<string, unknown>> = [];
  return { waits, logs, sleep: async (ms: number) => void waits.push(ms), log: (e: Record<string, unknown>) => void logs.push(e) };
}

describe("FR-API-157 the resend wrapper", () => {
  it.each(["An existing transaction had higher priority", "nonce too low", "replacement transaction underpriced"])("resends once after '%s', with a fresh send", async (message) => {
    const r = recorder();
    let sends = 0;
    const hash = await sendWithResend("createWithPermit", async () => {
      sends += 1;
      if (sends === 1) throw clash(message);
      return "0xabc" as Hex;
    }, r);
    expect(hash).toBe("0xabc");
    expect(sends).toBe(2);
    expect(r.waits).toEqual([600]);
  });

  it("finds the clash in a viem error's cause chain", () => {
    const viemLike = new Error("Missing or invalid parameters.", { cause: new Error("RPC error", { cause: { details: "An existing transaction had higher priority" } }) });
    expect(isNonceClash(viemLike)).toBe(true);
    expect(isNonceClash(new Error("execution reverted: StreamNotActive"))).toBe(false);
  });

  it("gives up after the fourth clash with the clash error, having waited 0.6, 1.2 and 1.8 s", async () => {
    const r = recorder();
    let sends = 0;
    const err = await sendWithResend("cancelFor", async () => {
      sends += 1;
      throw clash("An existing transaction had higher priority");
    }, r).catch((e) => e);
    expect(isNonceClash(err)).toBe(true);
    expect(sends).toBe(4);
    expect(r.waits).toEqual([...RESEND_DELAYS_MS]);
    expect(RESEND_DELAYS_MS).toEqual([600, 1200, 1800]);
  });

  it("never resends any other error: a send the RPC accepted, or whose fate is unknown, goes once", async () => {
    for (const other of [new Error("execution reverted"), new Error("fetch failed"), Object.assign(new Error("x"), { details: "already known" })]) {
      const r = recorder();
      let sends = 0;
      await sendWithResend("settleBatch", async () => {
        sends += 1;
        throw other;
      }, r).catch(() => {});
      expect(sends).toBe(1);
      expect(r.waits).toEqual([]);
    }
  });

  it("logs the call and the attempt, never the transaction", async () => {
    const r = recorder();
    let sends = 0;
    await sendWithResend("createWithPermit", async () => {
      sends += 1;
      if (sends < 3) throw clash("nonce too low");
      return "0x1" as Hex;
    }, r);
    expect(r.logs).toEqual([
      { msg: "relayer nonce clash, resending", call: "createWithPermit", attempt: 2, wait_ms: 600 },
      { msg: "relayer nonce clash, resending", call: "createWithPermit", attempt: 3, wait_ms: 1200 },
    ]);
  });
});

describe("FR-API-157 the relayer client resends through a real RPC refusal", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  afterEach(() => server?.stop(true));

  it("refetches the nonce and resends a createWithPermit the RPC refused as a clash", async () => {
    const seen: string[] = [];
    let raws = 0;
    let nonceReads = 0;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { id: number; method: string } | Array<{ id: number; method: string }>;
        const one = (r: { id: number; method: string }) => {
          seen.push(r.method);
          const ok = (result: unknown) => ({ jsonrpc: "2.0", id: r.id, result });
          switch (r.method) {
            case "eth_chainId": return ok("0x279f");
            case "eth_getTransactionCount": nonceReads += 1; return ok(nonceReads === 1 ? "0xde" : "0xdf");
            case "eth_estimateGas": return ok("0x6bb22");
            case "eth_maxPriorityFeePerGas": return ok("0x77359400");
            case "eth_gasPrice": return ok("0x2a77e32000");
            case "eth_getBlockByNumber": return ok({ number: "0x1", baseFeePerGas: "0x1", timestamp: "0x1", hash: `0x${"11".repeat(32)}`, transactions: [] });
            case "eth_sendRawTransaction":
              raws += 1;
              return raws === 1
                ? { jsonrpc: "2.0", id: r.id, error: { code: -32603, message: "An existing transaction had higher priority" } }
                : ok(`0x${"ab".repeat(32)}`);
            default: return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: `unexpected ${r.method}` } };
          }
        };
        return Response.json(Array.isArray(body) ? body.map(one) : one(body));
      },
    });
    const client = viemChainClient({ privateKey: generatePrivateKey(), rpcUrl: `http://127.0.0.1:${server.port}`, chainId: 10143 });
    const hash = await client.createWithPermit({
      chainId: 10143, merchant: `0x${"11".repeat(20)}`, subscriber: `0x${"22".repeat(20)}`, token: `0x${"33".repeat(20)}`,
      ratePerSecond: 500n, maxEscrow: 300_000n, deadline: 1_791_022_804n, v: 27, r: `0x${"44".repeat(32)}`, s: `0x${"55".repeat(32)}`, noStart: false,
    });
    expect(hash).toBe(`0x${"ab".repeat(32)}`);
    expect(raws).toBe(2);
    expect(nonceReads).toBe(2); // the resend asked for the nonce again
  }, 10_000);
});
