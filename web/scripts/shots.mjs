/**
 * Screenshot harness for design review.
 *
 * Usage: node scripts/shots.mjs <url> <outDir>
 * Captures 1440 and 390 viewports, light and dark, the first viewport and
 * the full page, plus the hero after pressing Cancel.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const [url = "http://localhost:3100/", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
];

for (const vp of viewports) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile ?? false,
      deviceScaleFactor: vp.deviceScaleFactor ?? 1,
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(2600);
    const tag = `${vp.name}-${scheme}`;
    await page.screenshot({ path: path.join(out, `${tag}-fold.png`) });
    await page.screenshot({ path: path.join(out, `${tag}-full.png`), fullPage: true });
    if (scheme === "light") {
      const cmp = page.getByRole("heading", { name: /Cancel on day 3/ });
      await cmp.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1900);
      await page.screenshot({ path: path.join(out, `${tag}-compare.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      const cancel = page.getByRole("button", { name: "Cancel" });
      if (await cancel.isVisible()) {
        await cancel.click();
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(out, `${tag}-canceled.png`) });
      }
    }
    if (errors.length) console.log(`[${tag}] console errors:\n  ${errors.join("\n  ")}`);
    await ctx.close();
  }
}
await browser.close();
console.log(`wrote screenshots to ${out}`);
