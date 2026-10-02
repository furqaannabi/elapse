/**
 * FR-API-154 / BR-API-010: the demo merchant (ADR 2026-10-02 demo account) — one merchant flagged
 * `demo`, found by the flag, with an email that can never receive mail and a magic link that is
 * never issued for it.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { api, resetDb } from "./helpers";
import { sql } from "../src/db/client";
import { setMailer, type Mail } from "../src/lib/email";
import { DEMO_EMAIL, ensureDemoMerchant, findDemoMerchant } from "../src/db/demo";

let sent: Mail[] = [];

beforeEach(async () => {
  await resetDb();
  sent = [];
  setMailer(async (m) => {
    sent.push(m);
  });
});

describe("FR-API-154 the demo merchant", () => {
  it("FR_API_154_ensure_creates_one_flagged_merchant_and_is_idempotent", async () => {
    expect(await findDemoMerchant()).toBeNull();
    const a = await ensureDemoMerchant();
    const b = await ensureDemoMerchant();
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ name: "Acme Cloud (demo)", email: DEMO_EMAIL });
    expect(DEMO_EMAIL).toBe("demo@elapse.invalid");
    expect((await findDemoMerchant())?.id).toBe(a.id);
    // A publishable key per mode, as any first sign-in gets (FR-API-002).
    const keys = await sql`SELECT livemode FROM api_keys WHERE merchant_id = ${a.id} AND kind = 'pk' ORDER BY livemode`;
    expect(keys.map((k: { livemode: boolean }) => k.livemode)).toEqual([false, true]);
  });

  it("FR_API_154_at_most_one_merchant_is_ever_flagged_demo", async () => {
    await ensureDemoMerchant();
    const [other] = await sql`INSERT INTO merchants (id, name, email) VALUES ('mrc_other', 'x', 'x@example.com') RETURNING id`;
    let refused = false;
    try {
      await sql`UPDATE merchants SET demo = true WHERE id = ${other!.id}`;
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  it("BR_API_010_a_magic_link_for_the_demo_email_sends_no_mail_and_issues_no_token", async () => {
    await ensureDemoMerchant();
    const r = await api("POST", "/v1/dashboard/auth/magic_link", { body: { email: "Demo@Elapse.invalid" } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sent: true }); // no account enumeration either way
    expect(sent).toHaveLength(0);
    // magic_links is not merchant-scoped, so other suites' rows survive resetDb: count this email's only.
    expect(await sql`SELECT 1 FROM magic_links WHERE email = ${DEMO_EMAIL}`).toHaveLength(0);
  });
});
