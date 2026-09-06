/**
 * `StripeShaped` — the closing plate. It is a distinct panel in both themes
 * and never borrows the page's paper as its ground: in dark mode that made a
 * white band that defeated dark mode (William, 2026-09-06). The plate owns its
 * two tokens, `plate` and `plate-ink`, and everything on it uses those.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StripeShaped } from "./stripe-shaped";

describe("StripeShaped", () => {
  it("renders the plate with its own tokens, not paper/ink", () => {
    const { container } = render(<StripeShaped />);
    const section = container.querySelector("section.plate");
    expect(section).not.toBeNull();
    expect(screen.getByRole("link", { name: /Read the quickstart/ }).className).toMatch(/bg-plate-ink/);
    for (const el of section!.querySelectorAll("[class]")) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/(^|[\s:/])(bg|text|border|divide)-(paper|ink)(\/|\s|$)/);
    }
  });
});
