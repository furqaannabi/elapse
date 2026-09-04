/**
 * Screenshot harness for the subscriber account page: every seeded
 * identity at 390px, the cancel sheet, a receipt, and one desktop shot.
 *
 * Usage: node scripts/account-shots.mjs <baseUrl> <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const [base = "http://localhost:3100", out = "shots-account"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" };
const errors = [];

for (const seed of ["two-merchants", "empty", "low-balance", "signed-out"]) {
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${seed}: ${e}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${seed}: ${m.text()}`));
  await page.goto(`${base}/account?as=${seed}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `${seed}.png`) });
  await ctx.close();
}

// The cancel sheet, then a receipt.
{
  const ctx = await browser.newContext(mobile);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`sheets: ${e}`));
  await page.goto(`${base}/account?as=two-merchants`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Stop this meter at/ }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, "cancel-sheet.png") });
  await page.getByRole("button", { name: /Keep running/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /You paid/ }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, "receipt-sheet.png") });
  await ctx.close();
}

for (const [name, width] of [["tablet", 768], ["desktop", 1440]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`${base}/account?as=two-merchants`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await ctx.close();
}

await browser.close();
if (errors.length) console.log("console/page errors:\n  " + errors.join("\n  "));
console.log(`wrote ${out}`);
