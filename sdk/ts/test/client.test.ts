import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as sdk from "../src/index";
import { Elapse, ElapseAPIError, ElapseAuthenticationError, ElapseInvalidRequestError, ElapseRateLimitError } from "../src/index";
import { startMock } from "./mock-server";

let mock: Awaited<ReturnType<typeof startMock>>;
let elapse: Elapse;
const KEY = "sk_test_" + "k".repeat(24);
const product = { id: "prod_9Xk2mQ1pL0vRsT", object: "product", name: "GPU hour", rate_usd_per_second: "0.004", currency: "ausd" };

beforeAll(async () => {
  mock = await startMock();
});
afterAll(() => mock.close());
beforeEach(() => {
  mock.on(() => ({ status: 200, body: product }));
  elapse = new Elapse({ secretKey: KEY, baseUrl: mock.baseUrl });
});

describe("FR-SDK-001 constructor", () => {
  it("defaults baseUrl and throws synchronously on a missing key", () => {
    expect(new Elapse({ secretKey: KEY }).baseUrl).toBe("https://api.elapse.dev");
    expect(() => new Elapse({} as never)).toThrow(ElapseInvalidRequestError);
    expect(() => new Elapse({ secretKey: "" })).toThrow(ElapseInvalidRequestError);
  });

  it("BR-SDK-002: the key never appears in JSON, toString, util.inspect (console.log) or own keys", async () => {
    const { inspect } = await import("node:util");
    expect(JSON.stringify(elapse)).not.toContain(KEY);
    expect(String(elapse)).not.toContain(KEY);
    expect(inspect(elapse, { depth: 10, showHidden: true })).not.toContain(KEY);
    expect(Object.keys(elapse)).not.toContain("secretKey");
  });
});

describe("FR-SDK-010 transport", () => {
  it("sends Authorization, Content-Type, User-Agent to {baseUrl}/v1/…", async () => {
    await elapse.products.create({ name: "GPU hour", rateUsdPerSecond: "0.004" });
    const req = mock.seen[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/products");
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["user-agent"]).toMatch(/^elapse-node\/\d+\.\d+\.\d+$/);
  });
});

describe("FR-SDK-002/003 products", () => {
  it("create maps camelCase to snake_case and returns the raw API object", async () => {
    const p = await elapse.products.create({ name: "GPU hour", rateUsdPerSecond: "0.004", allowPause: true, description: "H100" });
    expect(JSON.parse(mock.seen[0]!.body)).toEqual({ name: "GPU hour", rate_usd_per_second: "0.004", allow_pause: true, description: "H100" });
    expect(p).toEqual(product);
    expect(p.id.startsWith("prod_")).toBe(true);
  });

  it("a numeric rate throws before any request (BR-SDK-005)", async () => {
    await expect(elapse.products.create({ name: "x", rateUsdPerSecond: 0.004 as never })).rejects.toThrow(ElapseInvalidRequestError);
    await expect(elapse.products.create({ name: "x", rateUsdPerSecond: "abc" })).rejects.toThrow(ElapseInvalidRequestError);
    expect(mock.seen).toHaveLength(0);
  });

  it("retrieve validates the prefix (BR-SDK-006); list passes cursor params", async () => {
    await elapse.products.retrieve("prod_9Xk2mQ1pL0vRsT");
    expect(mock.seen[0]!.path).toBe("/v1/products/prod_9Xk2mQ1pL0vRsT");
    await expect(elapse.products.retrieve("cus_1")).rejects.toThrow(ElapseInvalidRequestError);
    mock.on(() => ({ status: 200, body: { object: "list", data: [product], has_more: false, url: "/v1/products" } }));
    const list = await elapse.products.list({ limit: 5, startingAfter: "prod_abc" });
    expect(mock.seen[0]!.path).toBe("/v1/products?limit=5&starting_after=prod_abc");
    expect(list.object).toBe("list");
    expect(list.data[0]!.id).toBe(product.id);
    expect(list.has_more).toBe(false);
  });
});

describe("FR-SDK-004 checkout sessions", () => {
  it("create sends product, success_url, cancel_url, optional max_duration_seconds", async () => {
    const cs = { id: "cs_3fT8kLm2Qp9RxV", object: "checkout.session", status: "open", url: "http://localhost:3000/c/cs_3fT8kLm2Qp9RxV", success_url: "https://a/ok", cancel_url: "https://a/no", product };
    mock.on(() => ({ status: 200, body: cs }));
    const s = await elapse.checkout.sessions.create({ product: "prod_9Xk2mQ1pL0vRsT", successUrl: "https://a/ok", cancelUrl: "https://a/no", maxDurationSeconds: 3600 });
    expect(JSON.parse(mock.seen[0]!.body)).toEqual({ product: "prod_9Xk2mQ1pL0vRsT", success_url: "https://a/ok", cancel_url: "https://a/no", max_duration_seconds: 3600 });
    expect(s.url).toMatch(/\/c\/cs_/);
    expect(s.status).toBe("open");
    await expect(elapse.checkout.sessions.create({ product: "sub_1", successUrl: "https://a", cancelUrl: "https://b" })).rejects.toThrow(ElapseInvalidRequestError);
  });
});

describe("FR-SDK-005/008 subscriptions", () => {
  const sub = { id: "sub_3kP9mL2qR8tVxY", object: "subscription", status: "active", product: "prod_1", customer: "cus_1", rate_usd_per_second: "0.004", started_at: 1, canceled_at: null };
  it("retrieve, cancel, list with filters; unknown status throws before a request", async () => {
    mock.on(() => ({ status: 200, body: sub }));
    expect((await elapse.subscriptions.retrieve("sub_3kP9mL2qR8tVxY")).status).toBe("active");
    mock.on(() => ({ status: 202, body: { ...sub, status: "canceled", seconds_elapsed: 83, amount_settled: "0.332" } }));
    const c = await elapse.subscriptions.cancel("sub_3kP9mL2qR8tVxY");
    expect(mock.seen[0]!.path).toBe("/v1/subscriptions/sub_3kP9mL2qR8tVxY/cancel");
    expect(mock.seen[0]!.method).toBe("POST");
    expect(c.status).toBe("canceled");
    mock.on(() => ({ status: 200, body: { object: "list", data: [sub], has_more: false, url: "/v1/subscriptions" } }));
    await elapse.subscriptions.list({ customer: "cus_1", product: "prod_1", status: "active", limit: 10 });
    expect(mock.seen[0]!.path).toBe("/v1/subscriptions?customer=cus_1&product=prod_1&status=active&limit=10");
    await expect(elapse.subscriptions.list({ status: "past_due" as never })).rejects.toThrow(ElapseInvalidRequestError);
    await expect(elapse.subscriptions.cancel("prod_1")).rejects.toThrow(ElapseInvalidRequestError);
  });
});

describe("FR-SDK-006 customers and invoices", () => {
  it("customers.retrieve and invoices.list", async () => {
    mock.on(() => ({ status: 200, body: { id: "cus_1", object: "customer", email: "a@b.c" } }));
    expect((await elapse.customers.retrieve("cus_1")).email).toBe("a@b.c");
    await expect(elapse.customers.retrieve("sub_1")).rejects.toThrow(ElapseInvalidRequestError);
    mock.on(() => ({ status: 200, body: { object: "list", data: [], has_more: false, url: "/v1/invoices" } }));
    await elapse.invoices.list({ subscription: "sub_1" });
    expect(mock.seen[0]!.path).toBe("/v1/invoices?subscription=sub_1");
  });
});

describe("FR-SDK-007 frozen surface", () => {
  it("exports exactly the frozen names", () => {
    expect(Object.keys(sdk).sort()).toEqual(
      [
        "Elapse",
        "ElapseAPIError",
        "ElapseAuthenticationError",
        "ElapseError",
        "ElapseInvalidRequestError",
        "ElapseRateLimitError",
        "ElapseSignatureVerificationError",
        "constructEvent",
      ].sort(),
    );
    const methods = (o: object) => Object.keys(o).sort();
    expect(methods(elapse.products)).toEqual(["create", "list", "retrieve"]);
    expect(methods(elapse.checkout.sessions)).toEqual(["create"]);
    expect(methods(elapse.subscriptions)).toEqual(["cancel", "list", "retrieve"]);
    expect(methods(elapse.customers)).toEqual(["retrieve"]);
    expect(methods(elapse.invoices)).toEqual(["list"]);
    expect(methods(elapse.webhooks)).toEqual(["constructEvent"]);
    expect("pause" in elapse.subscriptions).toBe(false);
  });
});

describe("FR-SDK-011 error mapping", () => {
  const body = (type: string, extra = {}) => ({ error: { type, message: "nope", ...extra } });
  it.each([
    [401, "authentication_error", ElapseAuthenticationError],
    [403, "authentication_error", ElapseAuthenticationError],
    [400, "invalid_request_error", ElapseInvalidRequestError],
    [404, "not_found", ElapseInvalidRequestError],
    [400, "idempotency_error", ElapseInvalidRequestError],
    [422, "invalid_request_error", ElapseInvalidRequestError],
    [429, "rate_limit_error", ElapseRateLimitError],
    [500, "api_error", ElapseAPIError],
  ])("%p %s → %s", async (status, type, cls) => {
    mock.on(() => ({ status, body: body(type, { param: "name", code: "x" }), headers: { "request-id": "req_1", "retry-after": "0" } }));
    const client = new Elapse({ secretKey: KEY, baseUrl: mock.baseUrl, maxRetries: 0 });
    let err: unknown;
    try {
      await client.products.retrieve("prod_1");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(cls);
    const e = err as ElapseAPIError;
    expect(e.status).toBe(status);
    expect(e.type).toBe(type);
    expect(e.message).toBe("nope");
    expect(e.param).toBe("name");
    expect(e.code).toBe("x");
    expect(e.requestId).toBe("req_1");
    expect(e.message).not.toContain(KEY);
  });

  it("an unparseable 5xx body is an ElapseAPIError; a non-JSON 200 is too", async () => {
    mock.on(() => ({ status: 502, body: "<html>bad gateway</html>" }));
    const client = new Elapse({ secretKey: KEY, baseUrl: mock.baseUrl, maxRetries: 0 });
    await expect(client.products.retrieve("prod_1")).rejects.toBeInstanceOf(ElapseAPIError);
    mock.on(() => ({ status: 200, body: "not json" }));
    await expect(client.products.retrieve("prod_1")).rejects.toBeInstanceOf(ElapseAPIError);
  });
});

describe("FR-SDK-012/013 retries and idempotency", () => {
  it("500, 500, 200 resolves; the same Idempotency-Key is sent on every attempt; 400 is not retried", async () => {
    mock.on((_r, n) => (n < 3 ? { status: 500, body: { error: { type: "api_error", message: "boom" } } } : { status: 200, body: product }));
    const client = new Elapse({ secretKey: KEY, baseUrl: mock.baseUrl, maxRetries: 2 });
    (client as unknown as { _sleep: (ms: number) => Promise<void> })._sleep = async () => {};
    const p = await client.products.create({ name: "x", rateUsdPerSecond: "1" });
    expect(p.id).toBe(product.id);
    expect(mock.seen).toHaveLength(3);
    const keys = new Set(mock.seen.map((s) => s.headers["idempotency-key"]));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^[0-9a-f-]{36}$/);

    mock.on(() => ({ status: 400, body: { error: { type: "invalid_request_error", message: "bad", param: "name" } } }));
    await expect(client.products.create({ name: "x", rateUsdPerSecond: "1" })).rejects.toThrow(ElapseInvalidRequestError);
    expect(mock.seen).toHaveLength(1);
  });

  it("gives up after maxRetries and surfaces the last error; 429 honours Retry-After", async () => {
    mock.on(() => ({ status: 429, body: { error: { type: "rate_limit_error", message: "slow down" } }, headers: { "retry-after": "1" } }));
    const client = new Elapse({ secretKey: KEY, baseUrl: mock.baseUrl, maxRetries: 1 });
    const waits: number[] = [];
    (client as unknown as { _sleep: (ms: number) => Promise<void> })._sleep = async (ms) => {
      waits.push(ms);
    };
    await expect(client.products.retrieve("prod_1")).rejects.toBeInstanceOf(ElapseRateLimitError);
    expect(mock.seen).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it("caller-supplied idempotency key is used; GETs carry none", async () => {
    await elapse.products.create({ name: "x", rateUsdPerSecond: "1" }, { idempotencyKey: "my-key-1" });
    expect(mock.seen[0]!.headers["idempotency-key"]).toBe("my-key-1");
    await elapse.products.retrieve("prod_1");
    expect(mock.seen[1]!.headers["idempotency-key"]).toBeUndefined();
  });

  it("backoff is 500 ms × 2^n ± 25 % with jitter", async () => {
    mock.on(() => ({ status: 500, body: { error: { type: "api_error", message: "boom" } } }));
    const client = new Elapse({ secretKey: KEY, baseUrl: mock.baseUrl, maxRetries: 2 });
    const waits: number[] = [];
    (client as unknown as { _sleep: (ms: number) => Promise<void> })._sleep = async (ms) => {
      waits.push(ms);
    };
    await expect(client.products.retrieve("prod_1")).rejects.toBeInstanceOf(ElapseAPIError);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(375);
    expect(waits[0]).toBeLessThanOrEqual(625);
    expect(waits[1]).toBeGreaterThanOrEqual(750);
    expect(waits[1]).toBeLessThanOrEqual(1250);
  });
});

describe("FR-SDK-014 timeout", () => {
  it("rejects with ElapseAPIError code=timeout and does not retry a timeout past maxRetries", async () => {
    mock.on(() => ({ status: 200, body: product, delayMs: 200 }));
    const client = new Elapse({ secretKey: KEY, baseUrl: mock.baseUrl, maxRetries: 0 });
    let err: unknown;
    try {
      await client.products.retrieve("prod_1", { timeoutMs: 30 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ElapseAPIError);
    expect((err as ElapseAPIError).code).toBe("timeout");
  });
});
