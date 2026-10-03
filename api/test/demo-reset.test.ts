/**
 * FR-WRK-076: the demo configuration reset (ADR 2026-10-02 demo account). Every six hours the worker
 * puts the demo merchant's test-mode configuration back to the seed — and never touches history,
 * live mode, or any other merchant.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { api, resetDb, seedMerchant } from "./helpers";
import { sql } from "../src/db/client";
import { ensureDemoMerchant } from "../src/db/demo";
import { createSession } from "../src/db/sessions";
import { ensureExampleCredentials, ensureSeedEndpoints, ensureSeedProducts } from "../src/services/demo-catalog";
import { demoResetForever, resetDemo } from "../src/worker/demo-reset";

const ORIGIN = "http://localhost:3000";
let demoId: string;
let cookie: string;
const as = (method: string, path: string, body?: unknown) => api(method, path, { body, headers: { cookie, origin: ORIGIN, "x-elapse-mode": "test" } });

beforeEach(async () => {
  await resetDb();
  demoId = (await ensureDemoMerchant()).id;
  await ensureSeedProducts(demoId);
  await ensureSeedEndpoints(demoId);
  await ensureExampleCredentials(demoId);
  cookie = `elapse_session=${(await createSession(demoId, null, { demo: true })).token}`;
});

const seedProducts = () => sql`SELECT demo_seed_key, name, active, description, storefront_name FROM products WHERE merchant_id = ${demoId} AND demo_seed_key IS NOT NULL ORDER BY demo_seed_key`;

describe("FR-WRK-076 demo configuration reset", () => {
  it("FR_WRK_076_restores_exactly_the_seed_configuration_after_a_judge_has_been_busy", async () => {
    const [gpu] = await sql`SELECT id FROM products WHERE merchant_id = ${demoId} AND demo_seed_key = 'product:gpu'`;
    // A judge cannot write to it (FR-API-153); the reset must restore it anyway, e.g. after an operator's edit.
    await sql`UPDATE products SET name = 'Defaced', description = 'lol', active = false WHERE id = ${gpu!.id}`;
    expect((await as("POST", "/v1/products", { name: "Judge's product", rate_usd_per_second: "0.01" })).status).toBe(200);
    expect((await as("POST", "/v1/webhook_endpoints", { url: "https://judge.example/hook", events: ["*"] })).status).toBe(200);
    const [seedEp] = await sql`SELECT id FROM webhook_endpoints WHERE demo_seed_key = 'endpoint:sink'`;
    await sql`UPDATE webhook_endpoints SET url = 'https://elsewhere.example', disabled = true WHERE id = ${seedEp!.id}`;
    expect((await as("POST", "/v1/api_keys", { name: "judge key" })).status).toBe(200);

    await resetDemo();

    expect(await seedProducts()).toEqual([
      { demo_seed_key: "product:gpu", name: "GPU time", active: true, description: null, storefront_name: null },
      { demo_seed_key: "product:inference", name: "Inference API", active: true, description: null, storefront_name: null },
      { demo_seed_key: "product:lambda", name: "Serverless runtime", active: true, description: null, storefront_name: "Northwind Compute" },
      { demo_seed_key: "product:saas", name: "GPU · 4090", active: true, description: null, storefront_name: "Acme GPU" },
    ]);
    const judgeProducts = await sql`SELECT active FROM products WHERE merchant_id = ${demoId} AND demo_seed_key IS NULL`;
    expect(judgeProducts).toEqual([{ active: false }]);
    const endpoints = await sql`SELECT demo_seed_key, url, disabled, events FROM webhook_endpoints WHERE merchant_id = ${demoId} ORDER BY demo_seed_key`;
    expect(endpoints).toEqual([
      { demo_seed_key: "endpoint:lambda", url: "https://examples.elapse.finance/lambda/webhooks", disabled: false, events: ["*"] },
      { demo_seed_key: "endpoint:saas", url: "https://examples.elapse.finance/saas/webhooks", disabled: false, events: ["*"] },
      { demo_seed_key: "endpoint:sink", url: "http://localhost:4000/v1/demo/webhooks", disabled: false, events: ["*"] },
    ]);
    const judgeKeys = await sql`SELECT name FROM api_keys WHERE merchant_id = ${demoId} AND NOT livemode AND revoked_at IS NULL AND demo_seed_key IS NULL`;
    expect(judgeKeys).toEqual([]);
    // The examples' keys survive: their only copy is in each example's .env.
    const exampleKeys = await sql`SELECT demo_seed_key FROM api_keys WHERE merchant_id = ${demoId} AND revoked_at IS NULL AND demo_seed_key LIKE 'key:%' AND kind = 'sk' ORDER BY demo_seed_key`;
    expect(exampleKeys.map((k: { demo_seed_key: string }) => k.demo_seed_key)).toEqual(["key:lambda", "key:saas"]);
    const pk = await sql`SELECT 1 FROM api_keys WHERE merchant_id = ${demoId} AND NOT livemode AND kind = 'pk' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;
    expect(pk.length).toBeGreaterThanOrEqual(1);
  });

  it("FR_WRK_076_never_touches_history_live_mode_or_another_merchant", async () => {
    const other = await seedMerchant();
    const p = await api("POST", "/v1/products", { key: other.skTest, body: { name: "Theirs", rate_usd_per_second: "0.01" } });
    await sql`INSERT INTO audit_log (merchant_id, actor, action, target) VALUES (${demoId}, 'dashboard', 'sign_in_demo', 'ses_x')`;
    const before = await sql`SELECT (SELECT count(*) FROM audit_log)::int AS audit, (SELECT count(*) FROM subscriptions)::int AS subs, (SELECT count(*) FROM events)::int AS events`;
    await resetDemo();
    const after = await sql`SELECT (SELECT count(*) FROM audit_log)::int AS audit, (SELECT count(*) FROM subscriptions)::int AS subs, (SELECT count(*) FROM events)::int AS events`;
    expect(after[0]!.subs).toBe(before[0]!.subs);
    expect(after[0]!.events).toBe(before[0]!.events);
    expect(after[0]!.audit).toBeGreaterThanOrEqual(before[0]!.audit); // the reset may add its own rows, never remove
    const [theirs] = await sql`SELECT active FROM products WHERE id = ${p.body.id}`;
    expect(theirs!.active).toBe(true);
    const otherKeys = await sql`SELECT 1 FROM api_keys WHERE merchant_id = ${other.merchantId} AND revoked_at IS NOT NULL`;
    expect(otherKeys).toHaveLength(0);
  });

  it("FR_WRK_076_does_nothing_without_a_demo_merchant", async () => {
    await resetDb();
    const m = await seedMerchant();
    await api("POST", "/v1/products", { key: m.skTest, body: { name: "Theirs", rate_usd_per_second: "0.01" } });
    await resetDemo();
    expect([...(await sql`SELECT active FROM products`)]).toEqual([{ active: true }]);
  });

  it("FR_WRK_076_a_failing_reset_does_not_end_the_loop", async () => {
    const controller = new AbortController();
    let calls = 0;
    const loop = demoResetForever(controller.signal, () => {}, 5, async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      if (calls >= 2) controller.abort();
    });
    await loop;
    expect(calls).toBe(2);
  });

  it("FR_WRK_076_a_missing_example_key_is_not_recreated_and_the_reset_says_what_to_run", async () => {
    await sql`UPDATE api_keys SET revoked_at = now() WHERE demo_seed_key = 'key:saas'`;
    const lines: Array<Record<string, unknown>> = [];
    await resetDemo((e) => lines.push(e));
    expect(await sql`SELECT 1 FROM api_keys WHERE demo_seed_key = 'key:saas' AND revoked_at IS NULL`).toHaveLength(0);
    expect(lines).toEqual([{ msg: expect.stringContaining("--reissue-examples"), examples: ["saas"] }]);
  });
});

