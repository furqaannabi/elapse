/**
 * FR-DSH-145: Get test AUSD on Developers — send 15 test AUSD to any address (API FR-API-150/151).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TestAusdCard } from "./test-ausd-card";
import { FaucetRefused } from "@/lib/dashboard/mock-api";

const ADDRESS = "0x2dc833BDE673AA92Bd9fea75B71B1CEd3F0D0240";
const TX = "0xab12000000000000000000000000000000000000000000000000000000cd34";

async function type(address: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/address/i), address);
  await user.click(screen.getByRole("button", { name: /send 15 test ausd/i }));
  return user;
}

describe("TestAusdCard (FR-DSH-145)", () => {
  it("sends to the address and shows the short address and an explorer link to the transfer", async () => {
    const send = vi.fn().mockResolvedValue({ amountUsd: "15", txHash: TX });
    render(<TestAusdCard send={send} />);
    await type(ADDRESS);
    expect(send).toHaveBeenCalledWith(ADDRESS);
    // The sentence spans the short address and the link, so match the paragraph's whole text.
    expect(await screen.findByText((_, el) => el?.tagName === "P" && /^sent 15 ausd to 0x2dc8…0240 · tx 0xab12…cd34/i.test(el.textContent ?? ""))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /0xab12…cd34/i });
    expect(link).toHaveAttribute("href", `https://testnet.monadexplorer.com/tx/${TX}`);
    expect(screen.getByLabelText(/address/i)).toHaveValue("");
  });

  it("catches a malformed address in the field and sends nothing", async () => {
    const send = vi.fn();
    render(<TestAusdCard send={send} />);
    await type("0x123");
    expect(await screen.findByText("Enter a 0x address")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("reads Sending… and is disabled while the drop is on its way, and sends once", async () => {
    let finish!: (v: { amountUsd: string; txHash: string }) => void;
    const send = vi.fn(() => new Promise<{ amountUsd: string; txHash: string }>((r) => (finish = r)));
    render(<TestAusdCard send={send} />);
    const user = await type(ADDRESS);
    const button = screen.getByRole("button", { name: /sending…/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(send).toHaveBeenCalledTimes(1);
    finish({ amountUsd: "15", txHash: TX });
    expect(await screen.findByRole("button", { name: /send 15 test ausd/i })).toBeEnabled();
  });

  it.each([
    ["faucet_wallet_daily", /this address already had test ausd today\. try again after/i],
    ["faucet_wallet_funded", /this address already holds 15 test ausd or more/i],
    ["faucet_ip_daily", /too many requests from your network today/i],
    ["faucet_merchant_daily", /you’ve used your 3 test drops for today/i],
    ["faucet_daily", /the test faucet has given out its share for today/i],
    ["faucet_unavailable", /the test faucet isn’t available right now/i],
  ] as const)("says which limit stopped it: %s", async (code, sentence) => {
    const resetsAt = code === "faucet_wallet_funded" || code === "faucet_unavailable" ? null : Math.floor(Date.now() / 1000) + 3600;
    const send = vi.fn().mockRejectedValue(new FaucetRefused(code, resetsAt, "refused"));
    render(<TestAusdCard send={send} />);
    await type(ADDRESS);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
  });

  it("keeps the button ready after a network error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    render(<TestAusdCard send={send} />);
    await type(ADDRESS);
    expect(await screen.findByText("We couldn’t reach the test faucet. Try again.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /send 15 test ausd/i })).toBeEnabled());
  });
});
