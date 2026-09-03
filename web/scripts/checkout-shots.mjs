/**
 * Screenshot harness for the hosted checkout: every seeded state at 390px,
 * plus the sign-in → fund → start → cancel flow driven end to end, plus one
 * desktop capture and judge mode.
 *
 * Usage: node scripts/checkout-shots.mjs <baseUrl> <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const [base = "http://localhost:3100", out = "shots-checkout"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const mobile = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  deviceScaleFactor: 2,
  colorScheme: "dark",
};

const states = ["cs_demo", "cs_ready", "cs_running", "cs_lowbal", "cs_empty", "cs_paused", "cs_done", "cs_expired", "cs_used", "cs_archived", "cs_missing"];
const errors = [];

for (const id of states) {
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${id}: ${e}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${id}: ${m.text()}`));
  await page.goto(`${base}/c/${id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
  await ctx.close();
}

// Judge mode on a running session.
{
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  await page.goto(`${base}/c/cs_running?judge=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(out, `judge.png`) });
  await ctx.close();
}

// The flow: sign in (email) → fund $10 → start → cancel.
{
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`flow: ${e}`));
  await page.goto(`${base}/c/cs_demo`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Continue with Face ID/ }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `flow-1-sheet.png`) });
  await page.getByRole("button", { name: /Continue with Face ID/ }).last().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `flow-2-scanning.png`) });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(out, `flow-3-fund.png`) });
  await page.getByRole("button", { name: /Add \$10/ }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, `flow-4-ready.png`) });
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForTimeout(3600);
  await page.screenshot({ path: path.join(out, `flow-5-running.png`) });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(out, `flow-6-receipt.png`) });
  await ctx.close();
}

// Desktop: the column stays narrow and centred.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`${base}/c/cs_running`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `desktop-running.png`) });
  await ctx.close();
}

await browser.close();
if (errors.length) console.log("console/page errors:\n  " + errors.join("\n  "));
console.log(`wrote ${out}`);
