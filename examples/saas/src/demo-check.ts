import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";

/**
 * FR-EXM-030: `npm run demo:check`. Signs a `subscription.canceled` with your
 * own `ELAPSE_WEBHOOK_SECRET`, posts it to your running server, and confirms
 * access was revoked. Run it before recording; CI runs it too.
 */

export async function demoCheck(o: { baseUrl: string; webhookSecret: string; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; detail: string }> {
  const f = o.fetchImpl ?? fetch;
  const sub = `sub_check${randomUUID().slice(0, 8)}`;
  const body = JSON.stringify({
    id: `evt_check${randomUUID().slice(0, 8)}`, object: "event", type: "subscription.canceled", created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1,
    data: { object: { id: sub, object: "subscription", status: "canceled", product: "prod_check", customer: "cus_check", rate_usd_per_second: "0.004", seconds_elapsed: 83, amount_settled: "0.33" } },
  });
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${createHmac("sha256", o.webhookSecret).update(`${t}.${body}`).digest("hex")}`;
  let res: Response;
  try {
    res = await f(`${o.baseUrl}/webhooks`, { method: "POST", body, headers: { "content-type": "application/json", "x-elapse-signature": header } });
  } catch (err) {
    return { ok: false, detail: `Could not reach ${o.baseUrl}: ${(err as Error).message}. Is npm start running?` };
  }
  if (res.status !== 200) return { ok: false, detail: `POST /webhooks answered ${res.status}: ${await res.text()}. Does ELAPSE_WEBHOOK_SECRET match the one the server loaded?` };
  await new Promise((r) => setTimeout(r, 50));
  const access = (await (await f(`${o.baseUrl}/access/${sub}`)).json()) as { entitled: boolean; reason: string };
  if (access.entitled || access.reason !== "canceled") return { ok: false, detail: `Verified, but /access/${sub} says ${JSON.stringify(access)}.` };
  return { ok: true, detail: `${sub}: revoke access · 83s · $0.33 (verified by your server, access now denied)` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const webhookSecret = process.env.ELAPSE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("ELAPSE_WEBHOOK_SECRET is missing. Printed by: npx @elapse/cli listen --forward localhost:3000/webhooks");
    process.exit(1);
  }
  demoCheck({ baseUrl, webhookSecret }).then((r) => {
    console.log(`${r.ok ? "✓" : "✗"} ${r.detail}`);
    process.exit(r.ok ? 0 : 1);
  });
}
