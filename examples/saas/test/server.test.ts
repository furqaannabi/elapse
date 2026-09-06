import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { Entitlements } from "../src/entitlements";
import { createServer } from "../src/server";
import { canceled, sign } from "./sign";

const SECRET = "whsec_test_secret";
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function start(over: Partial<Parameters<typeof createServer>[0]> = {}) {
  const lines: string[] = [];
  const entitlements = new Entitlements();
  let n = 0;
  const server = createServer({
    entitlements,
    webhookSecret: SECRET,
    log: (l) => lines.push(l),
    logJson: false,
    createSession: async () => ({ id: `cs_${++n}`, url: `https://elapse.finance/c/cs_${n}` }),
    product: { name: "GPU · 4090", rateUsdPerSecond: "0.004" },
    ...over,
  });
  await new Promise<void>((r) => server.listen(0, r));
  close = () => new Promise((r) => server.close(() => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, lines, entitlements };
}

describe("FR-EXM-020 POST /webhooks uses the raw body", () => {
  it("verifies the exact bytes and answers 200 before the work is logged", async () => {
    const { base, lines, entitlements } = await start();
    const body = canceled();
    const res = await fetch(`${base}/webhooks`, { method: "POST", body, headers: { "content-type": "application/json", "x-elapse-signature": sign(body, SECRET) } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    await new Promise((r) => setImmediate(r));
    expect(lines).toEqual(["evt_1S2bXYZ  subscription.canceled   → revoke access · 83s · $0.33"]);
    expect(entitlements.get("sub_4QeABC").entitled).toBe(false);
  });

  it("rejects a bad signature with 400", async () => {
    const { base } = await start();
    const body = canceled();
    const res = await fetch(`${base}/webhooks`, { method: "POST", body, headers: { "x-elapse-signature": sign(body, "whsec_nope") } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid signature" });
  });
});

describe("FR-EXM-012 GET /access/:sub", () => {
  it("answers entitled false before and after a canceled Event, true after created", async () => {
    const { base, entitlements } = await start();
    const get = async () => (await fetch(`${base}/access/sub_4QeABC`)).json();
    expect(await get()).toEqual({ entitled: false, reason: "unknown subscription" });
    entitlements.apply(JSON.parse(canceled().replace("subscription.canceled", "subscription.created")));
    expect(await get()).toEqual({ entitled: true, reason: "active" });
    entitlements.apply(JSON.parse(canceled()));
    expect(await get()).toEqual({ entitled: false, reason: "canceled" });
  });
});

describe("FR-EXM-010/011 pages", () => {
  it("GET / shows Acme GPU, the price, and a Start link to the current session", async () => {
    const { base } = await start();
    const html = await (await fetch(base)).text();
    expect(html).toContain("Acme GPU");
    expect(html).toContain("GPU · 4090");
    expect(html).toContain("$0.004 / second · ~$14.40 / hour");
    expect(html).toMatch(/href="https:\/\/elapse\.finance\/c\/cs_1"[^>]*>\s*Start/);
    // Same open session on reload; a fresh one once it has been used.
    expect(await (await fetch(base)).text()).toContain("/c/cs_1");
    await fetch(`${base}/ok?session_id=cs_1`);
    expect(await (await fetch(base)).text()).toContain("/c/cs_2");
  });

  it("GET /ok shows access granted and the entitlement state; GET /cancel says nothing was charged", async () => {
    const { base, entitlements } = await start();
    let html = await (await fetch(`${base}/ok?session_id=cs_9`)).text();
    expect(html).toContain("Access granted for session cs_9");
    expect(html).toContain("pending webhook");
    entitlements.apply(JSON.parse(canceled().replace("subscription.canceled", "checkout.session.completed").replace('"id":"sub_4QeABC"', '"id":"cs_9","subscription":"sub_4QeABC"')));
    entitlements.apply(JSON.parse(canceled().replace("subscription.canceled", "subscription.created").replace("evt_1S2bXYZ", "evt_2")));
    html = await (await fetch(`${base}/ok?session_id=cs_9`)).text();
    expect(html).toContain("entitled");
    expect(await (await fetch(`${base}/cancel`)).text()).toContain("Checkout canceled. Nothing was charged.");
  });
});
