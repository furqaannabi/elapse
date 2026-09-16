/**
 * Subscriber account routes (FR-API-121/123, ADR 2026-09-07 account on real data). Auth is the
 * Privy identity token (FR-API-120): the wallet in the token scopes every query, so a
 * subscription that is not the caller's does not exist here (404, never 403). Both modes are
 * returned; each row says which. Cancel mirrors the session routes through the same service.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { config } from "../config";
import { sql } from "../db/client";
import { ACCOUNT_ROW_STATUSES, ACCOUNT_STATUSES, findAccountSubscription, listAccountSubscriptions, serializeAccountSubscription, type AccountStatus } from "../db/account";
import { findCheckoutSession } from "../db/checkout-sessions";
import { ApiError, invalid } from "../lib/errors";
import { sendEmail } from "../lib/email";
import { receiptMail, type Mail } from "../lib/mail-templates";
import { router } from "../lib/openapi";
import { clientIp } from "../middleware/auth";
import { cancelSubscription, prepareCancel, prepareRelay, submitRelay } from "../services/checkout";
import { CancelBody, CancelPrepareResponse, StartResponse, mapCheckoutError, subscriberIdentity } from "./checkout-sessions";

export const RECEIPT_EMAIL_INTERVAL_S = 600;

const AccountSubscriptionSchema = z
  .object({
    id: z.string(),
    object: z.literal("subscription"),
    status: z.enum(ACCOUNT_ROW_STATUSES),
    livemode: z.boolean(),
    checkout_session: z.string().nullable(),
    restarted_as: z.string().nullable(),
    merchant: z.object({ name: z.string(), logo_url: z.string().nullable(), support_url: z.string().nullable() }),
    product: z.object({ name: z.string(), rate_usd_per_second: z.string(), allow_pause: z.boolean() }),
    started_at: z.number().int().nullable(),
    paused_at: z.number().int().nullable(),
    canceled_at: z.number().int().nullable(),
    ended_reason: z.enum(["canceled", "cap_reached"]).nullable(),
    max_duration_seconds: z.number().int(),
    funded_usd: z.string(),
    settled_usd: z.string(),
    refunded_usd: z.string(),
    seconds_elapsed: z.number().int(),
    start_mode: z.enum(["checkout", "merchant"]),
    start_by: z.number().int().nullable().openapi({ description: "FR-API-137: when an unstarted merchant-mode meter is refunded if the merchant never starts it; null otherwise." }),
  })
  .openapi("AccountSubscription");

const StatusQuery = z
  .object({ status: z.string().optional() })
  .transform((q, ctx) => {
    if (!q.status) return [...ACCOUNT_ROW_STATUSES] as AccountStatus[];
    const parts = q.status.split(",").map((x) => x.trim()) as AccountStatus[];
    if (parts.some((p) => !(ACCOUNT_STATUSES as readonly string[]).includes(p))) {
      ctx.addIssue({ code: "custom", message: `must be one of ${ACCOUNT_STATUSES.join(", ")}`, path: ["status"] });
      return z.NEVER;
    }
    return parts;
  });

export const account = router();

account.openapi(
  createRoute({
    method: "get",
    path: "/account/subscriptions",
    operationId: "account.subscriptions.list",
    tags: ["Account"],
    hide: true,
    request: { query: StatusQuery },
    responses: { 200: { description: "The caller's meters across merchants, newest start first.", content: { "application/json": { schema: z.object({ object: z.literal("list"), data: z.array(AccountSubscriptionSchema) }) } } } },
  }),
  async (c) => {
    const who = await subscriberIdentity(c);
    const statuses = c.req.valid("query");
    const rows = await listAccountSubscriptions(who.walletAddress, statuses);
    const now = Math.floor(Date.now() / 1000);
    return c.json({ object: "list" as const, data: rows.map((r) => serializeAccountSubscription(r, now)) }, 200);
  },
);

/** The caller's subscription and its checkout session, or a 404 that reveals nothing. */
async function ownSubscription(walletAddress: string, id: string) {
  const sub = await findAccountSubscription(walletAddress, id);
  if (!sub) throw new ApiError(404, "not_found", `No such subscription: ${id}`);
  const session = sub.checkout_session_id ? await findCheckoutSession(sub.merchant_id, sub.livemode, sub.checkout_session_id) : null;
  return { sub, session };
}

account.openapi(
  createRoute({
    method: "post",
    path: "/account/subscriptions/{id}/cancel/prepare",
    operationId: "account.subscriptions.cancel.prepare",
    tags: ["Account"],
    hide: true,
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: "The message the subscriber's wallet signs to stop the meter.", content: { "application/json": { schema: CancelPrepareResponse } } } },
  }),
  async (c) => {
    const who = await subscriberIdentity(c);
    const { session } = await ownSubscription(who.walletAddress, c.req.valid("param").id);
    if (!session) throw new ApiError(409, "invalid_request_error", "There is no running meter on this subscription.", undefined, "not_running");
    try {
      return c.json(await prepareCancel({ session, walletAddress: who.walletAddress }), 200);
    } catch (e) {
      mapCheckoutError(e);
    }
  },
);

account.openapi(
  createRoute({
    method: "post",
    path: "/account/subscriptions/{id}/cancel",
    operationId: "account.subscriptions.cancel",
    tags: ["Account"],
    hide: true,
    request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: CancelBody } }, required: true } },
    responses: { 202: { description: "Submitted; `canceled` arrives when the chain confirms.", content: { "application/json": { schema: StartResponse } } } },
  }),
  async (c) => {
    const who = await subscriberIdentity(c);
    const { signature, deadline } = c.req.valid("json");
    const { session } = await ownSubscription(who.walletAddress, c.req.valid("param").id);
    if (!session) throw new ApiError(409, "invalid_request_error", "There is no running meter on this subscription.", undefined, "not_running");
    try {
      return c.json(await cancelSubscription({ session, signature, deadline }), 202);
    } catch (e) {
      mapCheckoutError(e);
    }
  },
);

// ─── Pause / resume from the account (FR-API-046, checkout FR-CHK-018/030) ────────────────────

for (const action of ["pause", "resume"] as const) {
  account.openapi(
    createRoute({
      method: "post",
      path: `/account/subscriptions/{id}/${action}/prepare`,
      operationId: `account.subscriptions.${action}.prepare`,
      tags: ["Account"],
      hide: true,
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: { description: `The message the subscriber's wallet signs to ${action} the meter.`, content: { "application/json": { schema: CancelPrepareResponse } } } },
    }),
    async (c) => {
      const who = await subscriberIdentity(c);
      const { session } = await ownSubscription(who.walletAddress, c.req.valid("param").id);
      if (!session) throw new ApiError(409, "invalid_request_error", "There is no running meter on this subscription.", undefined, "not_running");
      try {
        return c.json(await prepareRelay(action, { session, walletAddress: who.walletAddress }), 200);
      } catch (e) {
        mapCheckoutError(e);
      }
    },
  );

  account.openapi(
    createRoute({
      method: "post",
      path: `/account/subscriptions/{id}/${action}`,
      operationId: `account.subscriptions.${action}`,
      tags: ["Account"],
      hide: true,
      request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: CancelBody } }, required: true } },
      responses: { 202: { description: `Submitted; the new status arrives when the chain confirms. No money moves.`, content: { "application/json": { schema: StartResponse } } } },
    }),
    async (c) => {
      const who = await subscriberIdentity(c);
      const { signature, deadline } = c.req.valid("json");
      const { session } = await ownSubscription(who.walletAddress, c.req.valid("param").id);
      if (!session) throw new ApiError(409, "invalid_request_error", "There is no running meter on this subscription.", undefined, "not_running");
      try {
        return c.json(await submitRelay(action, { session, signature, deadline, ip: clientIp(c) }), 202);
      } catch (e) {
        mapCheckoutError(e);
      }
    },
  );
}

/** The receipt in the subscriber's words (checkout FR-CHK-008/029): seconds, paid, returned. No fee, no chain words. */
export function receiptEmail(s: ReturnType<typeof serializeAccountSubscription>): Mail {
  const origin = new URL(config.checkoutBaseUrl).origin;
  return receiptMail(s, { accountUrl: `${config.checkoutBaseUrl}/account`, logoUrl: `${origin}/apple-icon.png` });
}

account.openapi(
  createRoute({
    method: "post",
    path: "/account/subscriptions/{id}/receipt/email",
    operationId: "account.subscriptions.receipt.email",
    tags: ["Account"],
    hide: true,
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: "The receipt was emailed to the identity's address.", content: { "application/json": { schema: z.object({ sent: z.literal(true) }) } } } },
  }),
  async (c) => {
    const who = await subscriberIdentity(c);
    if (!who.email) throw invalid("Your sign-in has no email address to send the receipt to.", undefined);
    const { sub } = await ownSubscription(who.walletAddress, c.req.valid("param").id);
    if (sub.status !== "canceled") throw new ApiError(400, "invalid_request_error", "The meter is still running; the receipt is ready once it stops.", undefined, "not_ended");
    const last = sub.receipt_emailed_at ? Math.floor(sub.receipt_emailed_at.getTime() / 1000) : null;
    const now = Math.floor(Date.now() / 1000);
    if (last !== null && now - last < RECEIPT_EMAIL_INTERVAL_S) {
      throw new ApiError(429, "rate_limit_error", "Already sent. Check your inbox.", undefined, "receipt_already_sent");
    }
    // Claim the slot before sending so two taps cannot both pass the check.
    const [claimed] = await sql`
      UPDATE subscriptions SET receipt_emailed_at = now()
      WHERE id = ${sub.id} AND (receipt_emailed_at IS NULL OR receipt_emailed_at < now() - make_interval(secs => ${RECEIPT_EMAIL_INTERVAL_S}))
      RETURNING id`;
    if (!claimed) throw new ApiError(429, "rate_limit_error", "Already sent. Check your inbox.", undefined, "receipt_already_sent");
    const mail = receiptEmail(serializeAccountSubscription(sub, now));
    try {
      await sendEmail({ to: who.email, ...mail });
    } catch (e) {
      // Give the slot back so the next tap can try again; the provider's reason goes to the log, never the address.
      await sql`UPDATE subscriptions SET receipt_emailed_at = NULL WHERE id = ${sub.id}`;
      console.error("receipt_email_failed", { subscription: sub.id, reason: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      throw new ApiError(502, "api_error", "We couldn't send the receipt right now. Try again in a moment.", undefined, "receipt_email_failed");
    }
    return c.json({ sent: true as const }, 200);
  },
);
