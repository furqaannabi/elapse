import { sql } from "./client";
import { newId } from "../lib/ids";

export interface Merchant {
  id: string;
  name: string;
  email: string;
  created_at: Date;
}

/** Insert a Merchant (`mrc_…`, Undecided 8). Called by magic-link verify on a first sign-in (FR-API-100) and by tests. */
export async function createMerchant(input: { name: string; email: string }): Promise<Merchant> {
  const id = newId("mrc");
  const [row] = await sql`
    INSERT INTO merchants (id, name, email)
    VALUES (${id}, ${input.name}, ${input.email.toLowerCase()})
    RETURNING id, name, email, created_at`;
  return row as Merchant;
}

/** Public branding for checkout and account pages (FR-API-103 `branding`, FR-API-030 `merchant`). Never keys or payout data. */
export interface MerchantBranding {
  name: string;
  logo_url: string | null;
  accent: string | null;
  support_url: string | null;
}

export async function getMerchantBranding(merchantId: string): Promise<MerchantBranding | null> {
  const [row] = await sql`
    SELECT COALESCE(branding->>'display_name', name) AS name,
           branding->>'logo_url' AS logo_url,
           branding->>'accent' AS accent,
           branding->>'support_url' AS support_url
    FROM merchants WHERE id = ${merchantId}`;
  return (row as MerchantBranding | undefined) ?? null;
}

export async function findMerchantByEmail(email: string): Promise<Merchant | null> {
  const [row] = await sql`SELECT id, name, email, created_at FROM merchants WHERE email = ${email.toLowerCase()}`;
  return (row as Merchant | undefined) ?? null;
}
