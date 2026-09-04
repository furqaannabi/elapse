/**
 * Screenshot harness for the merchant dashboard: sign-in screens, the
 * first-run capture, the checklist Home, the overview Home, at 1440 and
 * 375, dark and one light capture.
 *
 * Usage: node scripts/dashboard-shots.mjs <baseUrl> <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const [base = "http://localhost:3100", out = "shots-dashboard"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" };
const mobile = { viewport: { width: 375, height: 812 }, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" };
const errors = [];

async function open(ctxOpts, url, { session, theme = "dark", mode } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(
    ({ session, theme, mode }) => {
      localStorage.setItem("elapse-theme", theme);
      if (session) localStorage.setItem("elapse-mock-session", session);
      else localStorage.removeItem("elapse-mock-session");
      if (mode) localStorage.setItem("elapse-mode", mode);
    },
    { session, theme, mode },
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${url}: ${e}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${url}: ${m.text()}`));
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  return { ctx, page };
}

async function shot(page, name, full = false) {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
}

// 1. Login, idle and sent.
for (const [label, opts] of [["desktop", desktop], ["mobile", mobile]]) {
  const { ctx, page } = await open(opts, "/login");
  await shot(page, `login-${label}`);
  await page.getByLabel("Email").fill("demo@elapse.dev");
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await page.getByText(/check your inbox/i).waitFor();
  await page.waitForTimeout(300);
  await shot(page, `login-sent-${label}`);
  await ctx.close();
}

// 2. Verify: expired link.
{
  const { ctx, page } = await open(desktop, "/login/verify?token=tok_nope");
  await page.getByText(/isn't valid/i).waitFor();
  await shot(page, "verify-invalid-desktop");
  await ctx.close();
}

// 3. Unauthenticated dashboard redirects to login.
{
  const { ctx, page } = await open(desktop, "/dashboard");
  await page.waitForURL(/\/login\?next=/);
  await ctx.close();
}

// 4. New merchant: full flow → first-run → checklist.
for (const [label, opts] of [["desktop", desktop], ["mobile", mobile]]) {
  const { ctx, page } = await open(opts, "/login");
  await page.getByLabel("Email").fill(`new-${label}@example.com`);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await page.getByRole("link", { name: /open sign-in link/i }).click();
  await page.getByLabel(/business name/i).waitFor();
  await page.waitForTimeout(300);
  await shot(page, `first-run-${label}`);
  await page.getByLabel(/business name/i).fill("Acme GPU");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("list", { name: /first steps/i }).waitFor();
  await page.waitForTimeout(500);
  await shot(page, `home-checklist-${label}`, true);
  await ctx.close();
}

// 5. Demo merchant overview, dark desktop + mobile, light desktop, live mode.
{
  const { ctx, page } = await open(desktop, "/dashboard", { session: "mrc_demo" });
  await page.getByRole("heading", { name: /running now/i }).waitFor();
  await page.waitForTimeout(800);
  await shot(page, "home-overview-desktop", true);
  await ctx.close();
}
{
  const { ctx, page } = await open(mobile, "/dashboard", { session: "mrc_demo" });
  await page.getByRole("heading", { name: /running now/i }).waitFor();
  await page.waitForTimeout(800);
  await shot(page, "home-overview-mobile", true);
  await page.getByRole("button", { name: /open navigation/i }).click();
  await page.waitForTimeout(400);
  await shot(page, "home-nav-sheet-mobile");
  await ctx.close();
}
{
  const { ctx, page } = await open({ ...desktop, colorScheme: "light" }, "/dashboard", { session: "mrc_demo", theme: "light" });
  await page.getByRole("heading", { name: /running now/i }).waitFor();
  await page.waitForTimeout(800);
  await shot(page, "home-overview-desktop-light");
  await ctx.close();
}
{
  const { ctx, page } = await open(desktop, "/dashboard", { session: "mrc_demo", mode: "live" });
  await page.getByRole("heading", { name: /running now/i }).waitFor();
  await page.waitForTimeout(800);
  await shot(page, "home-overview-desktop-live");
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.waitForTimeout(300);
  await shot(page, "home-account-menu-desktop");
  await ctx.close();
}

// 6. Developers → Keys: list, create → reveal, roll dialog; desktop + mobile.
for (const [label, opts] of [["desktop", desktop], ["mobile", mobile]]) {
  const { ctx, page } = await open(opts, "/dashboard/developers/keys", { session: "mrc_demo" });
  await page.getByRole("list", { name: /secret keys/i }).waitFor();
  await page.waitForTimeout(400);
  await shot(page, `keys-${label}`, true);
  await page.getByRole("button", { name: /create secret key/i }).first().click();
  await page.getByLabel(/name/i).fill("CI runner");
  await page.getByRole("button", { name: /^create key$/i }).click();
  await page.getByTestId("secret-key").waitFor();
  await page.waitForTimeout(300);
  await shot(page, `keys-reveal-${label}`);
  await page.getByRole("button", { name: /saved it/i }).click();
  await page.waitForTimeout(300);
  const row = page.getByRole("list", { name: /secret keys/i }).getByText("CI", { exact: true }).locator("xpath=ancestor::li");
  await row.getByRole("button", { name: /actions for ci/i }).click();
  await page.getByRole("menuitem", { name: /roll/i }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
  await shot(page, `keys-roll-${label}`);
  await ctx.close();
}

// 7. Webhooks: list, endpoint detail with log, delivery drawer, add dialog.
for (const [label, opts] of [["desktop", desktop], ["mobile", mobile]]) {
  const { ctx, page } = await open(opts, "/dashboard/developers/webhooks", { session: "mrc_demo" });
  await page.getByRole("list", { name: /endpoints/i }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, `webhooks-${label}`);
  await page.getByRole("button", { name: /add endpoint/i }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
  await shot(page, `webhooks-add-${label}`);
  await page.keyboard.press("Escape");
  await page.getByRole("list", { name: /endpoints/i }).getByRole("link").first().click();
  await page.getByRole("list", { name: /deliveries/i }).waitFor();
  await page.waitForTimeout(500);
  await shot(page, `endpoint-${label}`, true);
  await page.getByRole("list", { name: /deliveries/i }).getByRole("button").first().click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(400);
  await shot(page, `delivery-drawer-${label}`);
  await ctx.close();
}

// 8. Events split layout: list + selected detail (desktop), list then detail (mobile).
{
  const { ctx, page } = await open(desktop, "/dashboard/developers/events", { session: "mrc_demo" });
  await page.getByRole("list", { name: /^events$/i }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, "events-desktop");
  await page.getByRole("list", { name: /^events$/i }).getByRole("link").nth(2).click();
  await page.getByTestId("event-payload").waitFor();
  await page.waitForTimeout(500);
  await shot(page, "events-detail-desktop", true);
  await ctx.close();
}
{
  const { ctx, page } = await open(mobile, "/dashboard/developers/events", { session: "mrc_demo" });
  await page.getByRole("list", { name: /^events$/i }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, "events-mobile");
  await page.getByRole("list", { name: /^events$/i }).getByRole("link").nth(2).click();
  await page.getByTestId("event-payload").waitFor();
  await page.waitForTimeout(500);
  await shot(page, "events-detail-mobile", true);
  await ctx.close();
}

// 9. Products: list, new-product drawer with live per-hour, archive dialog.
for (const [label, opts] of [["desktop", desktop], ["mobile", mobile]]) {
  const { ctx, page } = await open(opts, "/dashboard/products", { session: "mrc_demo" });
  await page.getByRole("list", { name: /products/i }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, `products-${label}`, true);
  await page.getByRole("button", { name: /new product/i }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel(/^name/i).fill("Render minute");
  await page.getByLabel(/rate per second/i).fill("0.004");
  await page.waitForTimeout(300);
  await shot(page, `products-drawer-${label}`);
  await ctx.close();
}

// 10. Subscriptions split: list + live detail, cancel dialog.
for (const [label, opts] of [["desktop", desktop], ["mobile", mobile]]) {
  const { ctx, page } = await open(opts, "/dashboard/subscriptions", { session: "mrc_demo" });
  await page.getByRole("list", { name: /subscriptions/i }).waitFor();
  await page.waitForTimeout(400);
  await shot(page, `subscriptions-${label}`);
  await page.getByLabel(/filter by status/i).selectOption("active");
  await page.waitForTimeout(400);
  await page.getByRole("list", { name: /subscriptions/i }).getByRole("link").first().click();
  await page.getByRole("button", { name: /cancel meter/i }).waitFor();
  await page.waitForTimeout(500);
  await shot(page, `subscription-detail-${label}`, true);
  await page.getByRole("button", { name: /cancel meter/i }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
  await shot(page, `subscription-cancel-${label}`);
  await ctx.close();
}

// 11. Customers, Invoices, Balance, Settings, Activity, notifications bell.
for (const [label, opts] of [["desktop", desktop], ["mobile", mobile]]) {
  for (const [name, url, ready] of [
    ["customers", "/dashboard/customers", /customers/i],
    ["invoices", "/dashboard/invoices", /invoices/i],
    ["balance", "/dashboard/balance", /ledger/i],
    ["activity", "/dashboard/settings/activity", /activity/i],
  ]) {
    const { ctx, page } = await open(opts, url, { session: "mrc_demo" });
    await page.getByRole("list", { name: ready }).waitFor();
    await page.waitForTimeout(400);
    await shot(page, `${name}-${label}`, true);
    if (name === "customers") {
      await page.getByRole("list", { name: /customers/i }).getByRole("link").first().click();
      await page.getByRole("list", { name: /subscriptions/i }).waitFor();
      await page.waitForTimeout(400);
      await shot(page, `customer-detail-${label}`, true);
    }
    if (name === "balance") {
      await page.getByRole("button", { name: /withdraw to bank/i }).click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(300);
      await shot(page, `balance-withdraw-${label}`);
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await open(opts, "/dashboard/settings", { session: "mrc_demo" });
    await page.getByTestId("checkout-preview").waitFor();
    await page.waitForTimeout(600);
    await shot(page, `settings-${label}`, true);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(opts, "/dashboard", { session: "mrc_demo" });
    await page.getByRole("heading", { name: /running now/i }).waitFor();
    await page.getByRole("button", { name: /notifications/i }).click();
    await page.waitForTimeout(400);
    await shot(page, `notifications-${label}`);
    await ctx.close();
  }
}

await browser.close();
if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`ok → ${out}`);
