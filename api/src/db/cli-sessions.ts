import { sql } from "./client";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import { newId } from "../lib/ids";
import { generateWebhookSecret } from "../lib/signature";

/**
 * CLI sessions (FR-API-130, ADR 2026-09-06): each `elapse listen` run opens a
 * session on the merchant's one persistent `kind: cli` Webhook endpoint for the
 * key's mode, created here on first use with `url: "cli://"` and `events: ["*"]`.
 * The endpoint's secret is decrypted and returned every time (the CLI prints it);
 * the reveal is audited as `cli_session.created`.
 */
export interface CliSession {
  id: string;
  merchantId: string;
  livemode: boolean;
  endpointId: string;
  signingSecret: string;
  merchantName: string;
  createdAt: Date;
}

export async function openCliSession(input: { merchantId: string; livemode: boolean; actor: string }): Promise<CliSession> {
  return sql.begin(async (tx) => {
    const [merchant] = await tx`SELECT name FROM merchants WHERE id = ${input.merchantId}`;
    if (!merchant) throw new Error(`no such merchant ${input.merchantId}`);
    let [ep] = await tx`SELECT id, secret_enc FROM webhook_endpoints
      WHERE merchant_id = ${input.merchantId} AND livemode = ${input.livemode} AND kind = 'cli'`;
    if (!ep) {
      const enc = encryptSecret(generateWebhookSecret());
      [ep] = await tx`INSERT INTO webhook_endpoints (id, merchant_id, livemode, url, events, kind, secret_enc)
        VALUES (${newId("wh")}, ${input.merchantId}, ${input.livemode}, 'cli://', ${sql.array(["*"], "TEXT")}, 'cli', ${enc})
        RETURNING id, secret_enc`;
    }
    const id = newId("clis");
    const [row] = await tx`INSERT INTO cli_sessions (id, merchant_id, livemode, endpoint_id)
      VALUES (${id}, ${input.merchantId}, ${input.livemode}, ${ep!.id}) RETURNING created_at`;
    await tx`INSERT INTO audit_log (merchant_id, actor, action, target) VALUES (${input.merchantId}, ${input.actor}, 'cli_session.created', ${id})`;
    return {
      id,
      merchantId: input.merchantId,
      livemode: input.livemode,
      endpointId: ep!.id as string,
      signingSecret: decryptSecret(ep!.secret_enc as Uint8Array),
      merchantName: merchant.name as string,
      createdAt: row!.created_at as Date,
    };
  });
}

/** The session row for a stream or ack call; `null` when it is another merchant's or another mode's. */
export async function findCliSession(merchantId: string, livemode: boolean, id: string): Promise<{ id: string; endpointId: string } | null> {
  const [row] = await sql`SELECT id, endpoint_id FROM cli_sessions WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}`;
  return row ? { id: row.id as string, endpointId: row.endpoint_id as string } : null;
}
