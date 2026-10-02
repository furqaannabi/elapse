import { timingSafeEqual } from "node:crypto";
import { sql } from "./client";
import { decryptSecret } from "../lib/crypto";
import { createApiKey } from "./api-keys";
import { createMerchant, type Merchant } from "./merchants";

/**
 * The demo merchant (FR-API-154, ADR 2026-10-02 demo account). At most one merchant carries
 * `demo = true`; everything that treats the demo differently finds it by that flag, never by email.
 * Its email is under `.invalid`, a reserved TLD that can never receive mail, and the magic-link
 * route refuses it, so the PIN sign-in (FR-API-152) is the only way in.
 */
export const DEMO_EMAIL = "demo@elapse.invalid";
export const DEMO_NAME = "Acme Cloud (demo)";

export async function findDemoMerchant(): Promise<Merchant | null> {
  const [row] = await sql`SELECT id, name, email, created_at FROM merchants WHERE demo`;
  return (row as Merchant | undefined) ?? null;
}

/** Finds the demo merchant or creates it with a publishable key per mode. Safe to call repeatedly. */
export async function ensureDemoMerchant(): Promise<Merchant> {
  const found = await findDemoMerchant();
  if (found) return found;
  const merchant = await createMerchant({ name: DEMO_NAME, email: DEMO_EMAIL });
  await sql`UPDATE merchants SET demo = true WHERE id = ${merchant.id}`;
  for (const livemode of [false, true]) {
    const key = await createApiKey({ merchantId: merchant.id, kind: "pk", livemode, name: "default", actor: "demo_seed" });
    await sql`UPDATE api_keys SET demo_seed = true WHERE id = ${key.row.id}`;
  }
  return merchant;
}

/** Whether `merchantId` is the demo merchant (the faucet exemption, FR-API-151). */
export async function isDemoMerchant(merchantId: string): Promise<boolean> {
  const [row] = await sql`SELECT demo FROM merchants WHERE id = ${merchantId}`;
  return Boolean(row?.demo);
}

// ─── The demo PIN (FR-API-152) ─────────────────────────────────────────────────

/** Wrong PINs per IP per rolling 15 minutes, across everyone per rolling hour, and good sign-ins per IP per hour. */
export const DEMO_PIN_LIMITS = { wrongPerIp: 5, wrongPerIpWindowMin: 15, wrongEveryone: 200, okPerIp: 20 } as const;

/** `DEMO_PIN` when it is exactly six digits; otherwise there is no demo sign-in. Never logged. */
export function demoPin(): string | null {
  const pin = process.env.DEMO_PIN?.trim();
  return pin && /^\d{6}$/.test(pin) ? pin : null;
}

/** Constant-time: how long the comparison takes says nothing about how many digits were right. */
export function pinMatches(given: string, pin: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(pin);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PinGate = { ok: true } | { ok: false; code: "demo_pin_paused" | "demo_pin_ip_limited" | "rate_limited"; retryAfter: number };

/** Whether this IP may try a PIN right now, and if not, which limit and for how long (seconds). */
export async function demoPinGate(ip: string | null): Promise<PinGate> {
  const L = DEMO_PIN_LIMITS;
  const [r] = await sql`
    SELECT
      (SELECT count(*) FROM demo_pin_attempts WHERE NOT ok AND created_at > now() - interval '1 hour')::int AS wrong_all,
      (SELECT extract(epoch FROM min(created_at) + interval '1 hour' - now())::int FROM demo_pin_attempts
         WHERE NOT ok AND created_at > now() - interval '1 hour') AS wrong_all_eases,
      (SELECT count(*) FROM demo_pin_attempts WHERE NOT ok AND ip = ${ip} AND created_at > now() - make_interval(mins => ${L.wrongPerIpWindowMin}))::int AS wrong_ip,
      (SELECT extract(epoch FROM min(created_at) + make_interval(mins => ${L.wrongPerIpWindowMin}) - now())::int FROM demo_pin_attempts
         WHERE NOT ok AND ip = ${ip} AND created_at > now() - make_interval(mins => ${L.wrongPerIpWindowMin})) AS wrong_ip_eases,
      (SELECT count(*) FROM demo_pin_attempts WHERE ok AND ip = ${ip} AND created_at > now() - interval '1 hour')::int AS ok_ip,
      (SELECT extract(epoch FROM min(created_at) + interval '1 hour' - now())::int FROM demo_pin_attempts
         WHERE ok AND ip = ${ip} AND created_at > now() - interval '1 hour') AS ok_ip_eases`;
  const after = (s: number | null) => Math.max(1, s ?? 60);
  if (r!.wrong_all >= L.wrongEveryone) return { ok: false, code: "demo_pin_paused", retryAfter: after(r!.wrong_all_eases) };
  if (ip !== null && r!.wrong_ip >= L.wrongPerIp) return { ok: false, code: "demo_pin_ip_limited", retryAfter: after(r!.wrong_ip_eases) };
  if (ip !== null && r!.ok_ip >= L.okPerIp) return { ok: false, code: "rate_limited", retryAfter: after(r!.ok_ip_eases) };
  return { ok: true };
}

/** One PIN attempt, right or wrong. The guess itself is never stored. */
export async function recordPinAttempt(ip: string | null, ok: boolean): Promise<void> {
  await sql`INSERT INTO demo_pin_attempts (ip, ok) VALUES (${ip}, ${ok})`;
}

// ─── The seed endpoint's secrets (FR-API-155) ──────────────────────────────────

/** The demo seed endpoint's current secret, plus the previous one while a roll's grace window is open. */
export async function demoSinkSecrets(): Promise<string[]> {
  const [row] = await sql`
    SELECT w.secret_enc, w.previous_secret_enc, w.previous_secret_expires_at > now() AS previous_open
    FROM webhook_endpoints w JOIN merchants m ON m.id = w.merchant_id
    WHERE m.demo AND w.demo_seed AND NOT w.livemode
    LIMIT 1`;
  if (!row) return [];
  const secrets = [decryptSecret(row.secret_enc)];
  if (row.previous_secret_enc && row.previous_open) secrets.push(decryptSecret(row.previous_secret_enc));
  return secrets;
}
