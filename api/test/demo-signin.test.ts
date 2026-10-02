/**
 * FR-API-152: demo sign-in with a six-digit permanent PIN (ADR 2026-10-02 demo account). The PIN
 * lives in DEMO_PIN; a right PIN mints a 24-hour session flagged `demo`; wrong PINs are limited per
 * IP and across everyone.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { api, resetDb } from "./helpers";
import { sql } from "../src/db/client";
import { ensureDemoMerchant } from "../src/db/demo";

const ORIGIN = "http://localhost:3000";
const PIN = "482913";

const signIn = (pin: string, ip = "203.0.113.30") =>
  api("POST", "/v1/dashboard/auth/demo", { body: { pin }, headers: { origin: ORIGIN, "x-forwarded-for": ip } });
const cookieOf = (r: { headers: Headers }) => r.headers.get("set-cookie")?.split(";")[0] ?? "";

beforeEach(async () => {
  await resetDb();
  await sql`TRUNCATE demo_pin_attempts`;
  process.env.DEMO_PIN = PIN;
  await ensureDemoMerchant();
});
afterEach(() => {
  delete process.env.DEMO_PIN;
});

describe("FR-API-152 demo sign-in with a PIN", () => {
  it("FR_API_152_the_right_pin_signs_in_to_the_demo_merchant_with_a_flagged_session", async () => {
    const r = await signIn(PIN);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ object: "merchant", name: "Acme Cloud (demo)" });
    const cookie = cookieOf(r);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    const me = await api("GET", "/v1/dashboard/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(me.body.demo).toBe(true);
    const [s] = await sql`SELECT demo, expires_at - created_at AS life FROM dashboard_sessions`;
    expect(s!.demo).toBe(true);
    const [audit] = await sql`SELECT action FROM audit_log WHERE action = 'sign_in_demo'`;
    expect(audit).toBeDefined();
  });

  it("FR_API_152_the_session_ends_24_hours_after_it_began_however_active_it_is", async () => {
    const cookie = cookieOf(await signIn(PIN));
    await sql`UPDATE dashboard_sessions SET created_at = now() - interval '23 hours', expires_at = now() + interval '1 hour'`;
    expect((await api("GET", "/v1/dashboard/me", { headers: { cookie } })).status).toBe(200);
    // Activity did not slide it, as it would for a normal session.
    const [s] = await sql`SELECT expires_at < now() + interval '2 hours' AS short FROM dashboard_sessions`;
    expect(s!.short).toBe(true);
    await sql`UPDATE dashboard_sessions SET expires_at = now() - interval '1 second'`;
    expect((await api("GET", "/v1/dashboard/me", { headers: { cookie } })).status).toBe(401);
  });

  it("FR_API_152_a_wrong_pin_is_401_and_sets_nothing", async () => {
    const r = await signIn("000000");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("demo_pin_invalid");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(await sql`SELECT 1 FROM dashboard_sessions`).toHaveLength(0);
  });

  it("FR_API_152_five_wrong_pins_from_one_ip_in_15_minutes_then_429_while_another_ip_gets_in", async () => {
    for (let i = 0; i < 5; i += 1) expect((await signIn("000000", "192.0.2.7")).status).toBe(401);
    const r = await signIn(PIN, "192.0.2.7"); // even the right PIN: the IP is resting
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("demo_pin_ip_limited");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await signIn(PIN, "192.0.2.8")).status).toBe(200);
  });

  it("FR_API_152_200_wrong_pins_across_everyone_in_an_hour_pauses_demo_sign_in", async () => {
    await sql`INSERT INTO demo_pin_attempts (ip, ok, created_at)
              SELECT '198.51.100.' || (g % 250), false, now() - interval '30 minutes' FROM generate_series(1, 200) g`;
    const r = await signIn(PIN, "192.0.2.9");
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("demo_pin_paused");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("FR_API_152_twenty_successful_sign_ins_per_ip_per_hour", async () => {
    for (let i = 0; i < 20; i += 1) expect((await signIn(PIN, "192.0.2.10")).status).toBe(200);
    expect((await signIn(PIN, "192.0.2.10")).status).toBe(429);
  });

  it("FR_API_152_without_DEMO_PIN_the_route_is_404_and_reports_unavailable", async () => {
    delete process.env.DEMO_PIN;
    expect((await signIn(PIN)).status).toBe(404);
    expect((await api("GET", "/v1/dashboard/auth/demo")).body).toEqual({ available: false });
    process.env.DEMO_PIN = "12345"; // not six digits: still off
    expect((await api("GET", "/v1/dashboard/auth/demo")).body).toEqual({ available: false });
    process.env.DEMO_PIN = PIN;
    expect((await api("GET", "/v1/dashboard/auth/demo")).body).toEqual({ available: true });
  });

  it("FR_API_152_without_a_demo_merchant_it_is_404", async () => {
    await resetDb();
    expect((await signIn(PIN)).status).toBe(404);
    expect((await api("GET", "/v1/dashboard/auth/demo")).body).toEqual({ available: false });
  });
});
