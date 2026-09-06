import { afterEach, describe, expect, it } from "vitest";
import { boot } from "../src/boot";
import { mockApi } from "./mock-api";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of closers.splice(0)) await c(); });

async function run(existing?: Array<{ id: string; name: string; rate_usd_per_second: string }>) {
  const api = await mockApi(existing ? { existingProducts: existing } : {});
  closers.push(api.close);
  const out: string[] = [];
  const app = await boot({ secretKey: "sk_test_abc", webhookSecret: "whsec_abc", apiUrl: api.url, port: 0, baseUrl: "http://localhost:3000" }, { out: (l) => out.push(l), log: () => {} });
  closers.push(app.close);
  return { api, out, app };
}

describe("FR-EXM-003 npm start", () => {
  it("creates the Product with the §4.2 body, creates a session, prints the three lines", async () => {
    const { api, out } = await run();
    expect(api.requests.map((r) => [r.method, r.path])).toEqual([["GET", "/v1/products?limit=100"], ["POST", "/v1/products"], ["POST", "/v1/checkout/sessions"]]);
    expect(api.requests.every((r) => r.auth === "Bearer sk_test_abc")).toBe(true);
    expect(api.requests[1]?.body).toEqual({ name: "GPU · 4090", rate_usd_per_second: "0.004" });
    expect(api.requests[2]?.body).toEqual({ product: "prod_new1", success_url: "http://localhost:3000/ok", cancel_url: "http://localhost:3000/cancel" });
    expect(out).toEqual([
      "Product:  prod_new1  GPU · 4090  $0.004/s",
      "Checkout: https://elapse.finance/c/cs_2",
      "Webhooks: POST http://localhost:3000/webhooks",
      expect.stringMatching(/^Listening on :\d+$/),
    ]);
  });

  it("reuses an existing Product by name instead of creating another", async () => {
    const { api, out } = await run([{ id: "prod_old", name: "GPU · 4090", rate_usd_per_second: "0.004" }]);
    expect(api.requests.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(api.requests[1]?.body).toMatchObject({ product: "prod_old" });
    expect(out[0]).toBe("Product:  prod_old  GPU · 4090  $0.004/s");
  });
});

describe("boot failure", () => {
  it("rejects with a readable message when the port is taken", async () => {
    const api = await mockApi();
    closers.push(api.close);
    const first = await boot({ secretKey: "sk_test_abc", webhookSecret: "whsec_abc", apiUrl: api.url, port: 0, baseUrl: "http://localhost:3000" }, { out: () => {}, log: () => {} });
    closers.push(first.close);
    await expect(boot({ secretKey: "sk_test_abc", webhookSecret: "whsec_abc", apiUrl: api.url, port: first.port, baseUrl: "http://localhost:3000" }, { out: () => {}, log: () => {} })).rejects.toThrow(/EADDRINUSE/);
  });
});

describe("FR-EXM-010 the printed session is the one on the page", () => {
  it("GET / after boot links to the printed session without creating another", async () => {
    const { api, out, app } = await run();
    const html = await (await fetch(`http://127.0.0.1:${app.port}/`)).text();
    expect(html).toContain(`href="${out[1]?.replace("Checkout: ", "")}"`);
    expect(api.requests.filter((r) => r.path === "/v1/checkout/sessions")).toHaveLength(1);
  });
});
