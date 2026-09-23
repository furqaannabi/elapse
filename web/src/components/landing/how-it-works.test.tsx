/**
 * `HowItWorks` — the landing page's integration snippet.
 *
 * The snippet is marketing, but it is also the first Elapse code most merchants read, so every
 * method on it has to exist and nothing on it may fail to compile when copied. The exact
 * framework-level detail lives in the docs; what this guards is that the snippet never teaches
 * something false.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HowItWorks } from "./how-it-works";

describe("HowItWorks", () => {
  const code = () => {
    render(<HowItWorks />);
    return screen.getByText(/@elapse\/sdk/).closest("pre")?.textContent ?? "";
  };

  it("uses only methods the frozen SDK surface has", () => {
    const src = code();
    for (const call of ["products.create", "checkout.sessions.create", "webhooks.constructEvent"]) {
      expect(src).toContain(call);
    }
    expect(src).toContain("rateUsdPerSecond");
  });

  // 2026-09-23: it passed `headers["x-elapse-signature"]` straight in. Node types that as
  // `string | string[] | undefined` and the parameter is `string | undefined`, so the snippet did
  // not compile where a merchant would paste it. The landing page names the header instead of
  // narrowing it — the narrowing belongs in the docs, not in a hero.
  it("does not hand a raw framework header to constructEvent", () => {
    expect(code()).not.toMatch(/headers\[/);
  });
});
