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
