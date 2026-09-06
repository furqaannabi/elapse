import { sql } from "./client";
import { deploymentFor } from "../chain/deployments";
import { config } from "../config";

/** FR-API-103 profile row. `name` is exposed as null until first-run capture (`onboarded_at`). */
export interface MerchantProfileRow {
  id: string;
  name: string;
  email: string;
  support_email: string | null;
  support_url: string | null;
  payout_address: string | null;
  branding: { display_name?: string | null; logo_url?: string | null; accent?: string | null; support_url?: string | null };
  notify_endpoint_exhausted: boolean;
  notify_key_expiry: boolean;
  onboarded_at: Date | null;
  created_at: Date;
}

const COLS = sql`id, name, email, support_email, support_url, payout_address, branding, notify_endpoint_exhausted, notify_key_expiry, onboarded_at, created_at`;

export async function getMerchantProfile(merchantId: string): Promise<MerchantProfileRow | null> {
  const [row] = await sql`SELECT ${COLS} FROM merchants WHERE id = ${merchantId}`;
  return (row as MerchantProfileRow) ?? null;
}

export interface Checklist {
  key_created: boolean;
  product_created: boolean;
  endpoint_created: boolean;
  first_delivery_succeeded: boolean;
}

/** FR-DSH-020: the four first-run milestones, per mode. */
export async function checklist(merchantId: string, livemode: boolean): Promise<Checklist> {
  const [r] = await sql`
    SELECT EXISTS (SELECT 1 FROM api_keys WHERE merchant_id = ${merchantId} AND livemode = ${livemode} AND kind = 'sk' AND revoked_at IS NULL) AS key_created,
           EXISTS (SELECT 1 FROM products WHERE merchant_id = ${merchantId} AND livemode = ${livemode}) AS product_created,
           EXISTS (SELECT 1 FROM webhook_endpoints WHERE merchant_id = ${merchantId} AND livemode = ${livemode}) AS endpoint_created,
           EXISTS (SELECT 1 FROM deliveries d JOIN events e ON e.id = d.event_id WHERE e.merchant_id = ${merchantId} AND e.livemode = ${livemode} AND d.status = 'succeeded') AS first_delivery_succeeded`;
  return r as Checklist;
}

/**
 * The factory fee (contracts FR-CON-006). Read from the deployment record; a chain read with a
 * 60 s cache can replace it. Live mode has no factory until Week 5, so it reports the default.
 */
const DEFAULT_FEE_BPS = 100;
export function feeBps(livemode: boolean): number {
  try {
    return deploymentFor(livemode ? config.chains.live : config.chains.test).feeBps;
  } catch {
    return DEFAULT_FEE_BPS;
  }
}

export function serializeProfile(m: MerchantProfileRow, livemode: boolean, list: Checklist) {
  return {
    id: m.id,
    object: "merchant" as const,
    name: m.onboarded_at ? m.name : null,
    email: m.email,
    support_email: m.support_email,
    support_url: m.support_url,
    payout_address: m.payout_address,
    fee_bps: feeBps(livemode),
    branding: {
      display_name: m.branding.display_name ?? null,
      logo_url: m.branding.logo_url ?? null,
      accent: m.branding.accent ?? null,
      support_url: m.branding.support_url ?? null,
    },
    notifications: { endpoint_exhausted_email: m.notify_endpoint_exhausted, key_expiry_email: m.notify_key_expiry },
    checklist: list,
    created: Math.floor(m.created_at.getTime() / 1000),
  };
}
