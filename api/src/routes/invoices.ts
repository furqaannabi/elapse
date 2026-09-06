import { createRoute, z } from "@hono/zod-openapi";
import { findInvoice, listInvoices, serializeInvoice } from "../db/invoices";
import { invalid, notFound } from "../lib/errors";
import { CursorNotFound } from "../lib/keyset";
import { PUBLIC, router } from "../lib/openapi";
import { ListOf, ListQuery, page } from "../lib/pagination";
import { merchantAuth, type AuthEnv } from "../middleware/auth";

/** Invoices (FR-API-050/052): one per `Settled` log (paid) or cap end (failed, zero). Read-only. */
export const InvoiceSchema = z
  .object({
    id: z.string().openapi({ example: "in_8Rt3Kq2Mn9Lp4Wx" }),
    object: z.literal("invoice"),
    subscription: z.string(),
    customer: z.string(),
    period_start: z.number().int(),
    period_end: z.number().int(),
    seconds: z.number().int(),
    amount_settled: z.string().openapi({ description: "Gross, decimal USD (the §5.3 field)." }),
    gross: z.string(),
    fee: z.string(),
    net: z.string(),
    currency: z.literal("ausd"),
    status: z.enum(["paid", "failed"]),
    tx_hash: z.string(),
    livemode: z.boolean(),
    created: z.number().int(),
  })
  .openapi("Invoice");

export const invoices = router<AuthEnv>();
invoices.use("/invoices", merchantAuth());
invoices.use("/invoices/*", merchantAuth());

invoices.openapi(
  createRoute({
    method: "get",
    path: "/invoices",
    operationId: "invoices.list",
    summary: "List invoices",
    ...PUBLIC,
    tags: ["Invoices"],
    request: { query: ListQuery.extend({ subscription: z.string().optional(), customer: z.string().optional() }) },
    responses: { 200: { description: "Invoices, newest first.", content: { "application/json": { schema: ListOf(InvoiceSchema, "InvoiceList") } } } },
  }),
  async (c) => {
    const q = c.req.valid("query");
    const auth = c.get("auth");
    try {
      const rows = await listInvoices(auth.merchantId, auth.livemode, { limit: q.limit, startingAfter: q.starting_after, subscription: q.subscription, customer: q.customer });
      return c.json(page(rows.map(serializeInvoice), q.limit, "/v1/invoices"), 200);
    } catch (e) {
      if (e instanceof CursorNotFound) throw invalid(e.message, "starting_after");
      throw e;
    }
  },
);

invoices.openapi(
  createRoute({
    method: "get",
    path: "/invoices/{id}",
    operationId: "invoices.retrieve",
    tags: ["Invoices"],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: "The invoice.", content: { "application/json": { schema: InvoiceSchema } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findInvoice(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("invoice", id);
    return c.json(serializeInvoice(row), 200);
  },
);
