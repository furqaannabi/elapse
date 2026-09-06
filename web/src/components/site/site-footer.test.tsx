/**
 * `SiteFooter` — only links that resolve. No Status link until a status page
 * exists (no "coming soon", CLAUDE.md workflow rule 7).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("links Docs, GitHub, Dashboard, X and nothing that does not exist", () => {
    render(<SiteFooter />);
    const names = screen.getAllByRole("link", { name: /.+/ }).map((a) => a.textContent?.trim());
    expect(names).toEqual(expect.arrayContaining(["Docs", "GitHub", "Dashboard", "X"]));
    expect(screen.queryByRole("link", { name: "Status" })).toBeNull();
  });
});
