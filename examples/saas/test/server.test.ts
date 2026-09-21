import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { Entitlements } from "../src/entitlements";
import { createServer } from "../src/server";
import { canceled, event, sign } from "./sign";

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
    createSession: async () => ({ id: `cs_${++n}` }),
    subscriptions: { pause: async () => {}, resume: async () => {} },
    elapse: { publishableKey: "pk_test_abc", apiUrl: "https://api.elapse.finance", appUrl: "https://elapse.finance" },
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
  it("GET / shows Acme GPU, the price, and mounts @elapse/react on the current session (FR-EXM-032)", async () => {
    const { base, entitlements } = await start();
    const html = await (await fetch(base)).text();
    expect(html).toContain("Acme GPU");
    expect(html).toContain("GPU · 4090");
    expect(html).toContain("$0.004 / second · ~$14.40 / hour");
    // No hosted checkout: the page authorises in place with <Authorize> and <Meter>.
    expect(html).not.toContain("/c/");
    expect(html).toContain('data-session="cs_1"');
    expect(html).toContain('data-publishable-key="pk_test_abc"');
    expect(html).toContain('data-api-url="https://api.elapse.finance"');
    expect(html).toContain('data-app-url="https://elapse.finance"');
    expect(html).toContain('<script type="module" src="/web.js"></script>');
    // The components' stylesheet rides along in the bundle (FR-RCT-001).
    expect(html).toContain('<link rel="stylesheet" href="/web.css">');
    // Same open session on reload; a fresh one once it has been used.
    expect(await (await fetch(base)).text()).toContain('data-session="cs_1"');
    await fetch(`${base}/ok?session_id=cs_1`);
    expect(await (await fetch(base)).text()).toContain('data-session="cs_2"');
    // Used without ever visiting /ok (the subscriber stayed on the meter): the completed webhook is the signal (FR-EXM-010).
    entitlements.apply(JSON.parse(canceled().replace("subscription.canceled", "checkout.session.completed").replace('"id":"sub_4QeABC"', '"id":"cs_2","subscription":"sub_4QeABC"')));
    expect(await (await fetch(base)).text()).toContain('data-session="cs_3"');
    expect(await (await fetch(base)).text()).toContain('data-session="cs_3"');
  });

  it("serves the page bundle and its stylesheet, and says what to run when they are missing", async () => {
    const { base } = await start();
    for (const path of ["/web.js", "/web.css"]) {
      const res = await fetch(`${base}${path}`);
      // Built (npm run build:web) or not, the answer is never a silent 404.
      if (res.status === 200) expect(res.headers.get("content-type")).toContain(path.endsWith(".js") ? "javascript" : "css");
      else {
        expect(res.status).toBe(503);
        expect(await res.text()).toContain("npm run build:web");
      }
    }
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
    expect(html).toContain("Meter running");
    entitlements.apply(JSON.parse(canceled().replace("evt_1S2bXYZ", "evt_3")));
    html = await (await fetch(`${base}/ok?session_id=cs_9`)).text();
    expect(html).toContain("not entitled (canceled)");
    expect(html).toContain("Meter stopped");
    expect(html).not.toContain("Meter running");
    expect(await (await fetch(`${base}/cancel`)).text()).toContain("Checkout canceled. Nothing was charged.");
  });
});

describe("FR-EXM-010/011 the merchant's own look", () => {
  it("serves /acme.css and every page links it, so the three pages share one brand", async () => {
    const { base } = await start();
    const css = await fetch(`${base}/acme.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await css.text()).toContain(".push");
    for (const path of ["/", "/ok?session_id=cs_1", "/cancel"]) {
      const html = await (await fetch(`${base}${path}`)).text();
      expect(html).toContain('href="/acme.css"');
      expect(html).toContain("Acme GPU");
    }
  });
});

/** Puts a session's Subscription into the entitlement map the way the webhooks do. */
function seed(entitlements: Entitlements, session: string, sub: string, status = "active") {
  entitlements.apply(JSON.parse(event("checkout.session.completed", { id: session, subscription: sub, customer: "cus_7Ha" }, "evt_seed1")));
  entitlements.apply(JSON.parse(event("subscription.created", { id: sub, customer: "cus_7Ha" }, "evt_seed2")));
  if (status !== "active") entitlements.apply(JSON.parse(event("subscription.updated", { id: sub, status, customer: "cus_7Ha" }, "evt_seed3")));
}

describe("FR-EXM-033/034 the subscriber asks Acme to pause", () => {
  it("maps the session to its Subscription, approves at once, and says so in the log", async () => {
    const asked: string[] = [];
    const { base, lines, entitlements } = await start({ subscriptions: { pause: async (s) => void asked.push(`pause ${s}`), resume: async (s) => void asked.push(`resume ${s}`) } });
    seed(entitlements, "cs_9", "sub_4QeABC");

    const res = await fetch(`${base}/pause`, { method: "POST", body: JSON.stringify({ session: "cs_9" }), headers: { "content-type": "application/json" } });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "requested" });
    expect(asked).toEqual(["pause sub_4QeABC"]);
    expect(lines.at(-1)).toBe("subscriber asked to pause · Acme approved → subscriptions.pause sub_4QeABC");
  });
});

describe("FR-EXM-033 nothing is asked of the platform without a meter to ask about", () => {
  const spy = () => {
    const calls: string[] = [];
    return { calls, deps: { pause: async (s: string) => void calls.push(s), resume: async (s: string) => void calls.push(s) } };
  };

  it("409s on an unknown session, and never calls the platform", async () => {
    const { calls, deps } = spy();
    const { base } = await start({ subscriptions: deps });
    const res = await fetch(`${base}/pause`, { method: "POST", body: JSON.stringify({ session: "cs_nope" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no live meter/i);
    expect(calls).toEqual([]);
  });

  it("409s on pausing a meter that has stopped", async () => {
    const { calls, deps } = spy();
    const { base, entitlements } = await start({ subscriptions: deps });
    seed(entitlements, "cs_9", "sub_4QeABC");
    entitlements.apply(JSON.parse(canceled({ id: "sub_4QeABC" }).replace("evt_1S2bXYZ", "evt_z")));
    expect((await fetch(`${base}/pause`, { method: "POST", body: JSON.stringify({ session: "cs_9" }) })).status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("forwards a resume even while Acme's own map still says active, because the platform decides", async () => {
    // Found live 2026-09-21: the meter reads the platform, Acme reads its webhooks, and for a second
    // or two after a pause they disagree — which is exactly when the subscriber presses Resume.
    // Refusing on Acme's stale copy made Resume impossible; the platform answers for itself.
    const { calls, deps } = spy();
    const { base, entitlements, lines } = await start({ subscriptions: deps });
    seed(entitlements, "cs_9", "sub_4QeABC"); // Acme still believes it is active

    const res = await fetch(`${base}/resume`, { method: "POST", body: JSON.stringify({ session: "cs_9" }) });

    expect(res.status).toBe(202);
    expect(calls).toEqual(["sub_4QeABC"]);
    expect(lines.at(-1)).toBe("subscriber asked to resume · Acme approved → subscriptions.resume sub_4QeABC");
  });
});

describe("FR-EXM-034 a platform refusal leaves the meter alone", () => {
  it("answers 502, logs it, and does not touch the entitlement map", async () => {
    const { base, lines, entitlements } = await start({
      subscriptions: { pause: async () => { throw new Error("relayer_unfunded"); }, resume: async () => {} },
    });
    seed(entitlements, "cs_9", "sub_4QeABC");
    const res = await fetch(`${base}/pause`, { method: "POST", body: JSON.stringify({ session: "cs_9" }) });
    expect(res.status).toBe(502);
    expect(lines.at(-1)).toContain("Acme could not pause sub_4QeABC: relayer_unfunded");
    // BR-EXM-010: only a verified Event moves an entitlement.
    expect(entitlements.get("sub_4QeABC")).toEqual({ entitled: true, reason: "active" });
  });
});
