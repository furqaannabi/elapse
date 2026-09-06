import { beforeEach, describe, expect, test } from "bun:test";
import { sql } from "../src/db/client";
import { decryptSecret } from "../src/lib/crypto";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await seedMerchant();
});

const good = { url: "https://acme.test/hooks", events: ["subscription.canceled", "invoice.settled"] };

describe("FR-API-060 create", () => {
  test("returns wh_ id and the whsec_ once; the row holds only ciphertext", async () => {
    const r = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: good });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      id: expect.stringMatching(/^wh_[0-9A-Za-z]{14}$/),
      object: "webhook_endpoint",
      url: good.url,
      events: good.events,
      disabled: false,
      kind: "http",
      livemode: false,
      created: expect.any(Number),
      previous_secret_expires_at: null,
      success_rate_7d: 1,
      secret: expect.stringMatching(/^whsec_[0-9A-Za-z]{32}$/),
    });
    const [row] = await sql`SELECT secret_enc, previous_secret_enc FROM webhook_endpoints WHERE id = ${r.body.id}`;
    expect(Buffer.from(row!.secret_enc).toString("latin1")).not.toContain(r.body.secret.slice(6));
    expect(decryptSecret(row!.secret_enc)).toBe(r.body.secret);
    expect(row!.previous_secret_enc).toBeNull();
    const [audit] = await sql`SELECT action, target FROM audit_log WHERE merchant_id = ${f.merchantId} AND action = 'webhook_endpoint.created'`;
    expect(audit!.target).toBe(r.body.id);
  });

  test("GET never returns the secret (BR-API-003)", async () => {
    const created = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: good });
    const r = await api("GET", `/v1/webhook_endpoints/${created.body.id}`, { key: f.skTest });
    expect(r.status).toBe(200);
    expect(r.body.secret).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain("whsec_");
    const list = await api("GET", "/v1/webhook_endpoints", { key: f.skTest });
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("whsec_");
  });

  test('events must be a subset of the six-type catalog or ["*"]', async () => {
    const star = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { ...good, events: ["*"] } });
    expect(star.status).toBe(200);
    for (const bad of [["invoice.tick"], ["subscription.canceled", "nope"], [], ["*", "invoice.settled"]]) {
      const r = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { ...good, events: bad } });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatchObject({ type: "invalid_request_error", param: "events" });
    }
  });

  test("pk_ → 401", async () => {
    expect((await api("POST", "/v1/webhook_endpoints", { key: f.pkTest, body: good })).status).toBe(401);
  });
});

describe("FR-API-062 url safety", () => {
  test("live mode: https only", async () => {
    const r = await api("POST", "/v1/webhook_endpoints", { key: f.skLive, body: { ...good, url: "http://acme.test/hooks" } });
    expect(r.status).toBe(400);
    expect(r.body.error.param).toBe("url");
    expect((await api("POST", "/v1/webhook_endpoints", { key: f.skLive, body: good })).status).toBe(200);
  });

  test("live mode: loopback, private and link-local targets are refused", async () => {
    for (const host of ["127.0.0.1", "localhost", "10.0.0.5", "192.168.1.9", "172.16.0.2", "169.254.169.254", "[::1]", "0.0.0.0", "[fd00::1]", "metadata.google.internal"]) {
      const r = await api("POST", "/v1/webhook_endpoints", { key: f.skLive, body: { ...good, url: `https://${host}/hooks` } });
      expect([host, r.status]).toEqual([host, 400]);
      expect(r.body.error.param).toBe("url");
    }
  });

  test("test mode: http and localhost are fine (ngrok, CLI forwarder)", async () => {
    expect((await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { ...good, url: "http://localhost:3001/hooks" } })).status).toBe(200);
    expect((await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { ...good, url: "http://127.0.0.1:3001/hooks" } })).status).toBe(200);
  });

  test("not a URL, or a non-http scheme → 400 param=url", async () => {
    for (const url of ["acme.test/hooks", "ftp://acme.test/x", "javascript:alert(1)", ""]) {
      const r = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { ...good, url } });
      expect(r.status).toBe(400);
      expect(r.body.error.param).toBe("url");
    }
  });
});

describe("FR-API-061 update, delete", () => {
  test("update url, events, disabled; audit row; other mode → 404", async () => {
    const wh = (await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: good })).body;
    const r = await api("POST", `/v1/webhook_endpoints/${wh.id}`, { key: f.skTest, body: { url: "https://acme.test/v2", events: ["*"], disabled: true } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: wh.id, url: "https://acme.test/v2", events: ["*"], disabled: true });
    expect(r.body.secret).toBeUndefined();
    expect((await api("POST", `/v1/webhook_endpoints/${wh.id}`, { key: f.skLive, body: { disabled: false } })).status).toBe(404);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'webhook_endpoint.updated' AND target = ${wh.id}`;
    expect(n).toBe(1);
  });

  test("update cannot change the secret; empty body → 400", async () => {
    const wh = (await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: good })).body;
    expect((await api("POST", `/v1/webhook_endpoints/${wh.id}`, { key: f.skTest, body: { secret: "whsec_x" } })).status).toBe(400);
    expect((await api("POST", `/v1/webhook_endpoints/${wh.id}`, { key: f.skTest, body: {} })).status).toBe(400);
  });

  test("delete → {id, object, deleted:true}; subsequent GET → 404; audit row", async () => {
    const wh = (await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: good })).body;
    const r = await api("DELETE", `/v1/webhook_endpoints/${wh.id}`, { key: f.skTest });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: wh.id, object: "webhook_endpoint", deleted: true });
    expect((await api("GET", `/v1/webhook_endpoints/${wh.id}`, { key: f.skTest })).status).toBe(404);
    expect((await api("DELETE", `/v1/webhook_endpoints/${wh.id}`, { key: f.skTest })).status).toBe(404);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'webhook_endpoint.deleted' AND target = ${wh.id}`;
    expect(n).toBe(1);
  });
});

describe("FR-API-105 roll_secret with grace", () => {
  test.each([[0], [3600], [86400]])("grace %p: new secret returned once, previous_secret_expires_at = now + grace (0 nulls immediately)", async (grace) => {
    const wh = (await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: good })).body;
    const before = Math.floor(Date.now() / 1000);
    const r = await api("POST", `/v1/webhook_endpoints/${wh.id}/roll_secret`, { key: f.skTest, body: { grace } });
    expect(r.status).toBe(200);
    expect(r.body.secret).toMatch(/^whsec_/);
    expect(r.body.secret).not.toBe(wh.secret);
    const [row] = await sql`SELECT secret_enc, previous_secret_enc, floor(extract(epoch from previous_secret_expires_at))::int AS exp FROM webhook_endpoints WHERE id = ${wh.id}`;
    expect(decryptSecret(row!.secret_enc)).toBe(r.body.secret);
    if (grace === 0) {
      expect(row!.previous_secret_enc).toBeNull();
      expect(row!.exp).toBeNull();
      expect(r.body.previous_secret_expires_at).toBeNull();
    } else {
      expect(decryptSecret(row!.previous_secret_enc)).toBe(wh.secret);
      expect(row!.exp - before).toBeGreaterThanOrEqual(grace - 2);
      expect(row!.exp - before).toBeLessThanOrEqual(grace + 2);
      expect(r.body.previous_secret_expires_at).toBe(row!.exp);
    }
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'webhook_endpoint.secret_rolled' AND target = ${wh.id}`;
    expect(n).toBe(1);
  });

  test("any other grace → 400 param=grace; missing grace → 400", async () => {
    const wh = (await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: good })).body;
    for (const grace of [1, 7200, -1, "3600"]) {
      const r = await api("POST", `/v1/webhook_endpoints/${wh.id}/roll_secret`, { key: f.skTest, body: { grace } });
      expect(r.status).toBe(400);
      expect(r.body.error.param).toBe("grace");
    }
    expect((await api("POST", `/v1/webhook_endpoints/${wh.id}/roll_secret`, { key: f.skTest, body: {} })).status).toBe(400);
  });

  test("rolling again during a grace window replaces the previous secret rather than keeping three", async () => {
    const wh = (await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: good })).body;
    const first = (await api("POST", `/v1/webhook_endpoints/${wh.id}/roll_secret`, { key: f.skTest, body: { grace: 3600 } })).body;
    const second = (await api("POST", `/v1/webhook_endpoints/${wh.id}/roll_secret`, { key: f.skTest, body: { grace: 3600 } })).body;
    const [row] = await sql`SELECT secret_enc, previous_secret_enc FROM webhook_endpoints WHERE id = ${wh.id}`;
    expect(decryptSecret(row!.secret_enc)).toBe(second.secret);
    expect(decryptSecret(row!.previous_secret_enc)).toBe(first.secret);
  });
});

describe("FR-API-080 list", () => {
  test("paginated newest first, scoped by mode", async () => {
    for (let i = 0; i < 3; i++) await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { ...good, url: `https://acme.test/h${i}` } });
    await api("POST", "/v1/webhook_endpoints", { key: f.skLive, body: good });
    const r = await api("GET", "/v1/webhook_endpoints?limit=2", { key: f.skTest });
    expect(r.body.data.map((e: any) => e.url)).toEqual(["https://acme.test/h2", "https://acme.test/h1"]);
    expect(r.body.has_more).toBe(true);
    const r2 = await api("GET", `/v1/webhook_endpoints?limit=2&starting_after=${r.body.data[1].id}`, { key: f.skTest });
    expect(r2.body.data.map((e: any) => e.url)).toEqual(["https://acme.test/h0"]);
    expect(r2.body.has_more).toBe(false);
  });
});
