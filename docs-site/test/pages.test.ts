/**
 * FR-DOC-003 every page has a title and a one-sentence description.
 * FR-DOC-010 the Quickstart has exactly seven steps, each with a code block.
 * FR-DOC-013 the Quickstart's opening line and closing links.
 * FR-DOC-020 the Introduction is ≤ 400 words with the payload as its hero code block.
 * FR-DOC-022 the Subscriptions page has the state diagram and the "manage their meter" section on manage_url.
 * FR-DOC-024 the Testing page has its five sections and no test-clock resource.
 * FR-DOC-043 every TypeScript block has a cURL sibling.
 * BR-DOC-004 no real-looking secret ever appears.
 * BR-DOC-008 no snippet constructs a client without baseUrl, and the old domain never appears.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const site = new URL("../site/", import.meta.url).pathname;

function pages(dir = site): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "snippets" || f === "node_modules" ? [] : pages(p);
    return f.endsWith(".mdx") ? [p] : [];
  });
}
const read = (name: string) => readFileSync(join(site, name), "utf8");
const frontmatter = (src: string) => Object.fromEntries([...(src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "").matchAll(/^(\w+):\s*"?(.*?)"?\s*$/gm)].map((m) => [m[1], m[2]]));

describe("FR-DOC-003 frontmatter", () => {
  it("every page has a title and a one-sentence description", () => {
    for (const p of pages()) {
      const fm = frontmatter(readFileSync(p, "utf8"));
      expect(fm.title, p).toBeTruthy();
      expect(fm.description, p).toBeTruthy();
      expect(fm.description!.split(/\.\s/).length, `${p} description should be one sentence`).toBeLessThanOrEqual(2);
    }
  });
});

describe("FR-DOC-020 introduction", () => {
  it("is 400 words or fewer and leads with the §5.3 payload", () => {
    const src = read("introduction.mdx").replace(/^---[\s\S]*?---/, "");
    const prose = src.replace(/```[\s\S]*?```/g, "").replace(/<[^>]+>/g, "").replace(/import .*$/gm, "");
    expect(prose.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(400);
    expect(src).toMatch(/PayloadSubscriptionCanceled/);
  });
});

describe("FR-DOC-010/013 quickstart", () => {
  const src = read("quickstart.mdx");
  it("opens with the promise and has exactly seven steps, each with code", () => {
    expect(src).toContain("Takes about 10 minutes");
    expect(src).toContain("you need Node 20 and a dashboard account");
    const steps = src.split(/<Step title=/).slice(1);
    expect(steps).toHaveLength(7);
    for (const s of steps) expect(s, s.slice(0, 40)).toMatch(/```|<Example/);
  });
  it("ends with the two next links", () => {
    expect(src).toContain("webhooks/events");
    expect(src).toContain("examples/saas");
  });
});

describe("FR-DOC-022 subscriptions", () => {
  it("has the state diagram, and says who pauses and who stops (ADR 2026-09-20)", () => {
    const src = read("subscriptions.mdx");
    expect(src).toContain("active --> paused: pause");
    expect(src).toContain("## Who pauses, who stops");
    expect(src).toContain("sub.manage_url");
    // The subscriber cannot pause: the page must send merchants to their own endpoint, and must
    // describe the React controls as requests rather than as something the subscriber performs.
    expect(src).toMatch(/A subscriber cannot pause/);
    expect(src).toMatch(/`subscriptions\.pause`/);
    expect(src).toMatch(/onPauseRequest/);
    expect(src).toMatch(/create a new Checkout session/);
  });
});

describe("FR-DOC-024 testing page", () => {
  it("has the five sections and says there is no test-clock API", () => {
    const src = read("testing.mdx");
    for (const h of ["## Test mode", "## A demo rate", "## Forward webhooks to your laptop", "## Send a test delivery", "## No test clocks"]) expect(src).toContain(h);
  });
});

describe("FR-DOC-021 signatures", () => {
  // 2026-09-23: the landing page's snippet passed `req.headers["x-elapse-signature"]` straight into
  // `constructEvent`. Node types that as `string | string[] | undefined` and the parameter is
  // `string | undefined`, so the first thing a merchant copies does not compile. Both working
  // examples narrow it; the docs did not show that.
  it("narrows the Node header before verifying, as the examples do", () => {
    const src = read("webhooks/signatures.mdx");
    // Every raw Node/Express header read is narrowed, never passed through as-is.
    expect(src).not.toMatch(/constructEvent\([^)]*req\.headers\[/);
    expect(src).toMatch(/Array\.isArray/);
  });
});

describe("FR-DOC-047 React is optional", () => {
  // 2026-09-23: a merchant asked whether Elapse forces React on their frontend. It does not — the
  // package ships a framework-free CDN build — but that was documented as "No bundler?" at the foot
  // of a page called React, where a Vue or Rails developer never looks. The answer has to be
  // findable from the page a server-first developer actually opens.
  it("has its own page, in the frontend developer's own words", () => {
    const page = read("sdks/browser.mdx");
    expect(page).toContain("elapse.browser.js");
    for (const framework of ["Vue", "Rails", "Django"]) expect(page).toContain(framework);
  });

  it("is reachable from both other SDK pages, not only by knowing it exists", () => {
    expect(read("sdks/typescript.mdx")).toContain("/sdks/browser");
    expect(read("sdks/react.mdx")).toContain("/sdks/browser");
  });

  // `onAuthorised` and `onStarted` are mutually exclusive: which one fires is decided by the
  // product's start mode (use-authorize.ts). A page that shows only `onStarted` strands every
  // merchant-mode integration on a callback that never comes.
  it("says which callback fires for which start mode", () => {
    const page = read("sdks/browser.mdx");
    expect(page).toContain("onAuthorised");
    expect(page).toMatch(/start_mode|start mode/);
    expect(page).toMatch(/subscriptions\.start/);
  });

  // A script tag on its own reads as the whole integration, and it is not: the session comes from
  // the merchant's own server and access is granted on the webhook, never on a browser callback.
  it("shows where the session comes from and where access is decided", () => {
    const page = read("sdks/browser.mdx");
    expect(page).toContain("/quickstart");
    expect(page).toMatch(/fetch\(/);
    expect(page).toContain("subscription.canceled");
    expect(page).toMatch(/webhook/i);
  });
});

describe("FR-DOC-043 and business rules across every page", () => {
  const all = pages().map((p) => [p, readFileSync(p, "utf8")] as const);
  it("every TypeScript block is inside a CodeGroup or Tabs with a cURL sibling", () => {
    for (const [p, src] of all) {
      const groups = [...src.matchAll(/<(CodeGroup|Tabs)>([\s\S]*?)<\/\1>/g)].map((m) => m[2]!);
      const outside = src.replace(/<(CodeGroup|Tabs)>[\s\S]*?<\/\1>/g, "");
      expect(outside, `${p}: ts block outside a group`).not.toMatch(/```(ts|typescript)\b/);
      for (const g of groups) if (/```(ts|typescript)\b|<Example/.test(g)) expect(g, `${p}: ts without curl`).toMatch(/```(bash|sh|shell) cURL|```bash|```sh/);
    }
  });
  it("never shows a real-looking secret, the old domain, or a client without baseUrl", () => {
    for (const [p, src] of all) {
      expect(src, p).not.toMatch(/sk_(test|live)_[A-Za-z0-9]{8,}/);
      expect(src, p).not.toMatch(/whsec_(?!docs_vector_)[A-Za-z0-9]{12,}/);
      expect(src, p).not.toContain("elapse.dev");
      for (const m of src.matchAll(/new Elapse\(\{[^}]*\}/g)) expect(m[0], p).toContain("baseUrl");
    }
  });
});
