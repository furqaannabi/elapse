/**
 * Renders the landing under candidate palettes by overriding the CSS
 * variables at runtime (no source changes), then writes a comparison page.
 *
 * Usage: node scripts/palette-shots.mjs <url> <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [url = "http://localhost:3100/", out = "palettes"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const palettes = [
  {
    id: "A",
    name: "Ivory & Indigo",
    note: "Warm ivory paper, ink with a violet cast, indigo for live. Softer than cobalt; Linear-adjacent.",
    dark: false,
    vars: {
      "--paper": "#FAF8F3", "--ink": "#1B1830", "--ink-soft": "#5B5772",
      "--grid": "rgba(27,24,48,.07)", "--grid-major": "rgba(27,24,48,.14)",
      "--pen": "#E0483F", "--pen-soft": "rgba(224,72,63,.12)",
      "--live": "#4F46E5", "--live-soft": "rgba(79,70,229,.12)", "--live-deep": "#2A2670",
      "--card": "#FFFEFB", "--muted": "#F1EEE6", "--secondary": "#F1EEE6", "--accent": "#ECE8DF",
      "--border": "rgba(27,24,48,.12)", "--ring": "rgba(79,70,229,.45)",
      "--primary": "#4F46E5", "--primary-foreground": "#FFFFFF",
    },
  },
  {
    id: "B",
    name: "Sand & Ember",
    note: "Warm sand paper, brown-black ink, ember orange for live. Energetic and human; the meter glows warm.",
    dark: false,
    vars: {
      "--paper": "#FBF7EF", "--ink": "#221C14", "--ink-soft": "#6B5F4E",
      "--grid": "rgba(34,28,20,.07)", "--grid-major": "rgba(34,28,20,.14)",
      "--pen": "#B3261E", "--pen-soft": "rgba(179,38,30,.12)",
      "--live": "#E8590C", "--live-soft": "rgba(232,89,12,.14)", "--live-deep": "#7A2E0E",
      "--card": "#FFFDF8", "--muted": "#F3ECDF", "--secondary": "#F3ECDF", "--accent": "#EEE5D5",
      "--border": "rgba(34,28,20,.12)", "--ring": "rgba(232,89,12,.45)",
      "--primary": "#E8590C", "--primary-foreground": "#FFFFFF",
    },
  },
  {
    id: "C",
    name: "Porcelain & Plum",
    note: "Near-white with a rose cast, plum-black ink, violet for live. Modern, a little playful.",
    dark: false,
    vars: {
      "--paper": "#FCFAFB", "--ink": "#1D1522", "--ink-soft": "#645A6C",
      "--grid": "rgba(29,21,34,.07)", "--grid-major": "rgba(29,21,34,.14)",
      "--pen": "#E5484D", "--pen-soft": "rgba(229,72,77,.12)",
      "--live": "#7C3AED", "--live-soft": "rgba(124,58,237,.12)", "--live-deep": "#3B1D6E",
      "--card": "#FFFFFF", "--muted": "#F4F0F6", "--secondary": "#F4F0F6", "--accent": "#EFE9F2",
      "--border": "rgba(29,21,34,.12)", "--ring": "rgba(124,58,237,.45)",
      "--primary": "#7C3AED", "--primary-foreground": "#FFFFFF",
    },
  },
  {
    id: "D",
    name: "Night & Amber",
    note: "Dark-first: warm near-black, bone-white ink, amber for live, coral pen. Premium, product-launch energy.",
    dark: true,
    vars: {
      "--paper": "#141210", "--ink": "#F4EFE6", "--ink-soft": "#A69E90",
      "--grid": "rgba(244,239,230,.07)", "--grid-major": "rgba(244,239,230,.13)",
      "--pen": "#FF5C4D", "--pen-soft": "rgba(255,92,77,.16)",
      "--live": "#F5B74A", "--live-soft": "rgba(245,183,74,.16)", "--live-deep": "#3A2A08",
      "--card": "#1B1815", "--muted": "#201D19", "--secondary": "#26221D", "--accent": "#2A2621",
      "--border": "rgba(244,239,230,.12)", "--ring": "rgba(245,183,74,.45)",
      "--primary": "#F5B74A", "--primary-foreground": "#1A1204",
    },
  },
];

const browser = await chromium.launch();
const rows = [];
for (const p of palettes) {
  const css = `:root, .dark { ${Object.entries(p.vars).map(([k, v]) => `${k}: ${v} !important;`).join(" ")} }`;
  for (const vp of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile ?? false,
      deviceScaleFactor: vp.deviceScaleFactor ?? 1,
      colorScheme: p.dark ? "dark" : "light",
    });
    const page = await ctx.newPage();
    await page.addInitScript((dark) => {
      try { localStorage.setItem("elapse-theme", dark ? "dark" : "light"); } catch {}
    }, p.dark);
    await page.goto(url, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: css });
    await page.waitForTimeout(2400);
    const fold = `${p.id}-${vp.name}-fold.png`;
    await page.screenshot({ path: path.join(out, fold) });
    if (vp.name === "desktop") {
      await page.screenshot({ path: path.join(out, `${p.id}-desktop-full.png`), fullPage: true });
    }
    await ctx.close();
  }
  rows.push(p);
}
await browser.close();

const html = `<!doctype html><meta charset="utf-8"><title>Elapse palettes</title>
<style>
body{margin:0;background:#111;color:#eee;font:14px/1.4 system-ui;padding:24px}
h1{font-weight:600;font-size:18px;margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}
.card{background:#1a1a1a;border:1px solid #333;border-radius:8px;overflow:hidden}
.card h2{font-size:15px;margin:0;padding:12px 14px;border-bottom:1px solid #333}
.card p{margin:0;padding:8px 14px 12px;color:#aaa}
.shots{display:grid;grid-template-columns:1fr 200px;gap:8px;padding:0 14px 14px}
img{width:100%;display:block;border:1px solid #333;border-radius:4px}
details{padding:0 14px 14px}
</style>
<h1>Elapse — pick a palette (real renders of the current landing)</h1>
<div class="grid">
${rows.map((p) => `<div class="card"><h2>${p.id} · ${p.name}</h2><p>${p.note}</p>
<div class="shots"><img src="${p.id}-desktop-fold.png"><img src="${p.id}-mobile-fold.png"></div>
<details><summary>Full page</summary><img src="${p.id}-desktop-full.png"></details></div>`).join("\n")}
</div>`;
writeFileSync(path.join(out, "index.html"), html);
console.log(`wrote ${path.join(out, "index.html")}`);
