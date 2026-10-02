import { createRoute, z } from "@hono/zod-openapi";
import { getAddress, isAddress, type Address } from "viem";
import { sql } from "../db/client";
import { isDemoMerchant } from "../db/demo";
import { ApiError, invalid } from "../lib/errors";
import { router } from "../lib/openapi";
import { clientIp, sessionAuth, type AuthEnv } from "../middleware/auth";
import { dropFaucet, FaucetRefusal } from "../services/faucet";

/**
 * The faucet's dashboard door (FR-API-150/151, ADR 2026-10-02 dashboard faucet). A signed-in
 * merchant sends one 15 AUSD drop to any address they name. Cookie only: a secret key never reaches
 * this route, so the frozen SDK surface does not grow. Hidden from the public reference. Every judge
 * shares the demo merchant, so it is spared the per-merchant limit; the shared limits still hold.
 */
export const dashboardFaucet = router<AuthEnv>();
dashboardFaucet.use("/dashboard/faucet", sessionAuth());

const FaucetDrop = z.object({ amount_usd: z.string(), tx_hash: z.string() }).openapi("DashboardFaucetDrop");

dashboardFaucet.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/faucet",
    operationId: "dashboard.faucet",
    tags: ["Dashboard"],
    hide: true,
    request: { body: { content: { "application/json": { schema: z.strictObject({ address: z.string().max(64) }) } }, required: true } },
    responses: { 202: { description: "15 testnet AUSD is on its way to the address.", content: { "application/json": { schema: FaucetDrop } } } },
  }),
  async (c) => {
    const auth = c.get("auth");
    const { address } = c.req.valid("json");
    // viem's check is strict: a mixed-case address must carry a valid checksum, so a typo is caught here.
    if (!isAddress(address)) throw invalid("Enter a Monad testnet address: 0x followed by 40 hex characters.", "address");
    const wallet = getAddress(address) as Address;
    const ip = clientIp(c);
    try {
      const drop = await dropFaucet({ livemode: auth.livemode, wallet, ip, merchantId: auth.merchantId, via: "dashboard", exempt: await isDemoMerchant(auth.merchantId) });
      await sql`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${auth.merchantId}, 'dashboard', 'faucet_drop', ${wallet.toLowerCase()}, ${ip})`;
      return c.json({ amount_usd: drop.amountUsd, tx_hash: drop.txHash }, 202);
    } catch (e) {
      if (e instanceof FaucetRefusal) {
        throw new ApiError(e.status, e.status === 429 ? "rate_limit_error" : e.status === 503 ? "api_error" : "invalid_request_error", e.message, undefined, e.code, e.resetsAt);
      }
      throw e;
    }
  },
);
