/**
 * End-to-end: a new merchant signs in, completes first run, creates a
 * product, copies a checkout URL, creates a key, adds an endpoint, sends a
 * test event, and the Home checklist reads 4 of 4 then becomes the
 * overview. Runs against a dev server with the mock API.
 *
 * Usage: node scripts/dashboard-e2e.mjs [baseUrl]
 * Maps to: FR-DSH-010…013, 020, 031, 032, 071, 081, 082; CLAUDE.md e2e.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3100";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await page.getByRole("link", { name: /open sign-in link/i }).click();
  await page.getByLabel(/business name/i).fill("E2E Labs");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("list", { name: /first steps/i }).waitFor();
  assert.match(await page.textContent("body"), /0 of 4/);

  // 1. Product
  await page.getByRole("link", { name: /create a product/i }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel(/^name/i).fill("GPU · e2e");
  await page.getByLabel(/rate per second/i).fill("0.004");
  await page.getByRole("button", { name: /create product/i }).click();
  await page.getByRole("list", { name: /products/i }).getByText("GPU · e2e").waitFor();
  await page.getByRole("button", { name: /copy checkout url for gpu · e2e/i }).click();
  await page.getByText(/checkout url copied/i).waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /\/c\/cs_/);

  // The mock lives in memory, so stay on client-side navigation.
  const nav = page.getByRole("navigation", { name: "Dashboard" });

  // 2. Key
  await nav.getByRole("link", { name: "Developers" }).click();
  await nav.getByRole("link", { name: "Keys" }).click();
  await page.getByRole("button", { name: /create secret key/i }).first().click();
  await page.getByLabel(/name/i).fill("e2e");
  await page.getByRole("button", { name: /^create key$/i }).click();
  const secret = await page.getByTestId("secret-key").textContent();
  assert.match(secret, /^sk_test_/);
  await page.getByRole("button", { name: /saved it/i }).click();
  assert.ok(!(await page.textContent("body")).includes(secret), "secret must not remain on the page");

  // 3. Endpoint + 4. Test event
  await nav.getByRole("link", { name: "Webhooks" }).click();
  await page.getByRole("button", { name: /add endpoint/i }).first().click();
  await page.getByLabel(/endpoint url/i).fill("https://e2e.example/hooks");
  await page.getByRole("button", { name: /^add endpoint$/i }).click();
  assert.match(await page.getByTestId("secret-key").textContent(), /^whsec_/);
  await page.getByRole("button", { name: /saved it/i }).click();
  await page.getByRole("list", { name: /endpoints/i }).getByRole("link").first().click();
  await page.getByRole("button", { name: /send test event/i }).click();
  await page.getByRole("button", { name: /^send$/i }).click();
  await page.getByRole("list", { name: /deliveries/i }).getByRole("listitem").first().waitFor();
  const firstRow = await page.getByRole("list", { name: /deliveries/i }).getByRole("listitem").first().textContent();
  assert.match(firstRow, /Succeeded/);

  // Checklist complete → overview
  await nav.getByRole("link", { name: "Home" }).click();
  await page.getByRole("heading", { name: /running now/i }).waitFor();
  assert.equal(await page.getByRole("list", { name: /first steps/i }).count(), 0);

  // Sign out → gate redirects
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.waitForURL(/\/login/);
  await page.goto(`${base}/dashboard`);
  await page.waitForURL(/\/login\?next=/);

  assert.deepEqual(errors, [], "no page errors");
  console.log("e2e ok");
} finally {
  await browser.close();
}
