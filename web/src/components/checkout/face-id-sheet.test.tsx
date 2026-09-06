/**
 * The sign-in sheet: Face ID first for a returning subscriber, email first for a new one,
 * then a one-tap offer to use Face ID next time (decided 2026-09-06, William, option a).
 *
 * FR-CHK-002, FR-CHK-016; BR-CHK-001 (no wallet words).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthFlowProvider, mockAuthFlow, type AuthFlow } from "@/lib/checkout/auth-flow";
import { FaceIdSheet } from "./face-id-sheet";

function flowWith(over: Partial<AuthFlow>): AuthFlow {
  return { ...mockAuthFlow, ...over };
}

function renderSheet(flow: AuthFlow, onAuthenticated = vi.fn()) {
  render(
    <AuthFlowProvider value={flow}>
      <FaceIdSheet open onOpenChange={vi.fn()} merchantName="Nimbus" onAuthenticated={onAuthenticated} />
    </AuthFlowProvider>,
  );
  return onAuthenticated;
}

describe("FaceIdSheet", () => {
  it("leads with Face ID when the device has one, email as the fallback", () => {
    renderSheet(flowWith({ passkeyFirst: true }));
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons[0]).toMatch(/Continue with Face ID/);
    expect(screen.getByRole("button", { name: /Use email instead/ })).toBeInTheDocument();
  });

  it("leads with email for a new subscriber and still offers Face ID for a synced passkey", () => {
    renderSheet(flowWith({ passkeyFirst: false, usesCode: true }));
    expect(screen.getByRole("textbox", { name: /Email address/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use Face ID instead/ })).toBeInTheDocument();
  });

  it("email code path: sends the code, verifies it, then offers Face ID for next time", async () => {
    const sendCode = vi.fn(async () => {});
    const verifyCode = vi.fn(async (email: string) => ({ email }));
    const linkPasskey = vi.fn(async () => {});
    const done = renderSheet(flowWith({ passkeyFirst: false, usesCode: true, canLinkPasskey: true, sendCode, verifyCode, linkPasskey }));
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /Email address/ }), "a@b.co");
    await user.click(screen.getByRole("button", { name: /^Continue$/ }));
    expect(sendCode).toHaveBeenCalledWith("a@b.co");
    await user.type(await screen.findByRole("textbox", { name: /One-time code/ }), "123456");
    await user.click(screen.getByRole("button", { name: /^Continue$/ }));
    expect(verifyCode).toHaveBeenCalledWith("a@b.co", "123456");
    // Not signed in yet from the page's point of view: the offer comes first.
    expect(done).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: /Turn on Face ID/ }));
    await waitFor(() => expect(linkPasskey).toHaveBeenCalled());
    await waitFor(() => expect(done).toHaveBeenCalledWith({ email: "a@b.co" }));
  });

  it("Not now skips the offer and a failed link still signs the subscriber in", async () => {
    const linkPasskey = vi.fn(async () => {
      throw new Error("nope");
    });
    const done = renderSheet(flowWith({ passkeyFirst: false, usesCode: true, canLinkPasskey: true, verifyCode: async (email) => ({ email }), linkPasskey }));
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /Email address/ }), "a@b.co");
    await user.click(screen.getByRole("button", { name: /^Continue$/ }));
    await user.type(await screen.findByRole("textbox", { name: /One-time code/ }), "123456");
    await user.click(screen.getByRole("button", { name: /^Continue$/ }));
    await user.click(await screen.findByRole("button", { name: /Turn on Face ID/ }));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ email: "a@b.co" }));
  });

  it("a failed Face ID says so in plain words and returns to the choice", async () => {
    renderSheet(flowWith({ passkeyFirst: true, passkey: async () => { throw new Error("Face ID didn't complete."); } }));
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: /Continue with Face ID/ })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Face ID didn't complete/);
    expect(screen.getByRole("button", { name: /Use email instead/ })).toBeInTheDocument();
  });

  it("never says wallet, key, or chain", async () => {
    const { container } = render(
      <AuthFlowProvider value={flowWith({ passkeyFirst: false, usesCode: true, canLinkPasskey: true })}>
        <FaceIdSheet open onOpenChange={vi.fn()} merchantName="Nimbus" onAuthenticated={vi.fn()} />
      </AuthFlowProvider>,
    );
    expect(container.textContent).not.toMatch(/wallet|private key|seed|0x|chain|token/i);
  });
});

describe("FaceIdSheet with Google (decided 2026-09-06)", () => {
  it("offers Google above email on a first visit and starts the redirect", async () => {
    const google = vi.fn(async () => {});
    renderSheet(flowWith({ passkeyFirst: false, usesCode: true, google }));
    const user = userEvent.setup();
    const btn = screen.getByRole("button", { name: /Continue with Google/ });
    await user.click(btn);
    expect(google).toHaveBeenCalled();
  });

  it("does not offer Google when the flow has none, nor to a returning Face ID device", () => {
    renderSheet(flowWith({ passkeyFirst: false, usesCode: true }));
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
  });

  it("resumes on the Face ID offer after a redirect sign-in", async () => {
    const linkPasskey = vi.fn(async () => {});
    const done = vi.fn();
    render(
      <AuthFlowProvider value={flowWith({ passkeyFirst: false, usesCode: true, canLinkPasskey: true, linkPasskey })}>
        <FaceIdSheet open onOpenChange={vi.fn()} merchantName="Nimbus" onAuthenticated={done} resume={{ email: "g@b.co" }} />
      </AuthFlowProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Turn on Face ID/ }));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ email: "g@b.co" }));
  });
});
