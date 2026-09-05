import { createRoute, z } from "@hono/zod-openapi";
import { findCustomer, listCustomers, serializeCustomer } from "../db/customers";
import { invalid, notFound } from "../lib/errors";
import { CursorNotFound } from "../lib/keyset";
import { router } from "../lib/openapi";
import { ListOf, ListQuery, page } from "../lib/pagination";
import { merchantAuth, type AuthEnv } from "../middleware/auth";

/** Customers (FR-API-020/021): read-only for merchants; created by checkout `prepare`. */
export const CustomerSchema = z
  .object({
    id: z.string().openapi({ example: "cus_4Kq9Lm2Np7RsTv" }),
    object: z.literal("customer"),
    email: z.string().nullable(),
    wallet_address: z.string(),
    default_payment: z.literal("ausd"),
    livemode: z.boolean(),
    created: z.number().int(),
  })
  .openapi("Customer");

export const customers = router<AuthEnv>();
customers.use("/customers", merchantAuth());
customers.use("/customers/*", merchantAuth());

customers.openapi(
  createRoute({
    method: "get",
    path: "/customers",
    operationId: "customers.list",
    tags: ["Customers"],
    request: { query: ListQuery },
    responses: { 200: { description: "Customers, newest first.", content: { "application/json": { schema: ListOf(CustomerSchema, "CustomerList") } } } },
  }),
  async (c) => {
    const q = c.req.valid("query");
    const auth = c.get("auth");
    try {
      const rows = await listCustomers(auth.merchantId, auth.livemode, { limit: q.limit, startingAfter: q.starting_after });
      return c.json(page(rows.map(serializeCustomer), q.limit, "/v1/customers"), 200);
    } catch (e) {
      if (e instanceof CursorNotFound) throw invalid(e.message, "starting_after");
      throw e;
    }
  },
);

customers.openapi(
  createRoute({
    method: "get",
    path: "/customers/{id}",
    operationId: "customers.retrieve",
    tags: ["Customers"],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: "The customer.", content: { "application/json": { schema: CustomerSchema } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findCustomer(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("customer", id);
    return c.json(serializeCustomer(row), 200);
  },
);
