/**
 * FR-DSH-146: Try the demo account — six PIN boxes, then the dashboard (API FR-API-152).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DemoSignIn } from "./demo-sign-in";
import { DemoPinRefused } from "@/lib/dashboard/mock-api";

const merchant = { id: "mrc_demo", name: "Acme Cloud (demo)" } as never;

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /try the demo account/i }));
  return user;
}
const boxes = () => screen.getAllByRole("textbox", { name: /digit/i });

describe("DemoSignIn (FR-DSH-146)", () => {
  it("reveals six single-digit boxes with a numeric keypad, and signs in on the sixth digit", async () => {
    const signInDemo = vi.fn().mockResolvedValue(merchant);
    const onSignedIn = vi.fn();
    render(<DemoSignIn signInDemo={signInDemo} onSignedIn={onSignedIn} />);
    const user = await open();
    expect(screen.getByText("Enter the demo PIN")).toBeInTheDocument();
    expect(boxes()).toHaveLength(6);
    for (const b of boxes()) {
      expect(b).toHaveAttribute("inputmode", "numeric");
      expect(b).toHaveAttribute("maxlength", "1");
    }
    expect(boxes()[0]).toHaveAttribute("autocomplete", "one-time-code");
    await user.keyboard("482913");
    await waitFor(() => expect(signInDemo).toHaveBeenCalledWith("482913"));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });

  it("fills all six boxes from a pasted PIN", async () => {
    const signInDemo = vi.fn().mockResolvedValue(merchant);
    render(<DemoSignIn signInDemo={signInDemo} onSignedIn={() => {}} />);
    const user = await open();
    await user.paste("482913");
    await waitFor(() => expect(signInDemo).toHaveBeenCalledWith("482913"));
    expect(boxes().map((b) => (b as HTMLInputElement).value).join("")).toBe("482913");
  });

  it("ignores anything that is not a digit", async () => {
    const signInDemo = vi.fn().mockResolvedValue(merchant);
    render(<DemoSignIn signInDemo={signInDemo} onSignedIn={() => {}} />);
    const user = await open();
    await user.keyboard("a1b");
    expect((boxes()[0] as HTMLInputElement).value).toBe("1");
    expect((boxes()[1] as HTMLInputElement).value).toBe("");
  });

  it("on a wrong PIN says so, clears the boxes and returns focus to the first", async () => {
    const signInDemo = vi.fn().mockRejectedValue(new DemoPinRefused("demo_pin_invalid", null, "That PIN isn't right."));
    render(<DemoSignIn signInDemo={signInDemo} onSignedIn={() => {}} />);
    const user = await open();
    await user.keyboard("000000");
    expect(await screen.findByText("That PIN isn’t right.")).toBeInTheDocument();
    expect(boxes().every((b) => (b as HTMLInputElement).value === "")).toBe(true);
    expect(boxes()[0]).toHaveFocus();
  });

  it.each([
    ["demo_pin_ip_limited", 720, "Too many tries. Try again in 12 minutes."],
    ["demo_pin_paused", 2400, "The demo is resting after too many wrong PINs. Try again in 40 minutes."],
    ["rate_limited", 60, "Too many demo sign-ins from here. Try again in 1 minute."],
  ] as const)("words %s with the wait", async (code, retryAfter, sentence) => {
    const signInDemo = vi.fn().mockRejectedValue(new DemoPinRefused(code, retryAfter, "refused"));
    render(<DemoSignIn signInDemo={signInDemo} onSignedIn={() => {}} />);
    const user = await open();
    await user.keyboard("482913");
    expect(await screen.findByText(sentence)).toBeInTheDocument();
  });

  it("boxes are at least 44 px for touch", async () => {
    render(<DemoSignIn signInDemo={vi.fn()} onSignedIn={() => {}} />);
    await open();
    for (const b of boxes()) expect(b.className).toMatch(/\bh-12\b/);
  });
});
