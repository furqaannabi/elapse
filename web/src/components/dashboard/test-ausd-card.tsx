/**
 * `TestAusdCard` — "Get test AUSD" on Developers, test mode only. Sends one 15 AUSD drop from the
 * testnet faucet to any address the merchant types, then shows the short address and a short tx id
 * linking to the testnet explorer (BR-DSH-005: chain detail understated). A refusal is worded with
 * the limit that stopped it and when it eases.
 *
 * The parent renders it only in test mode; it never decides the mode itself.
 *
 * @param send Sends the drop to `address`; rejects with `FaucetRefused` for a limit, anything else for a network failure.
 *
 * Maps to: FR-DSH-145; API FR-API-150/151; ADR 2026-10-02 dashboard faucet.
 */
"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { txUrl } from "@/lib/dashboard/chain";
import { DashboardApiError, FaucetRefused, type FaucetRefusalCode } from "@/lib/dashboard/mock-api";
import { faucetResetTime } from "@/lib/faucet-reset";

type Sent = { to: string; txHash: string };

const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

function refusalSentence(code: FaucetRefusalCode, resetsAt: number | null): string {
  const after = faucetResetTime(resetsAt);
  switch (code) {
    case "faucet_wallet_daily":
      return `This address already had test AUSD today. Try again after ${after}.`;
    case "faucet_wallet_funded":
      return "This address already holds 15 test AUSD or more.";
    case "faucet_ip_daily":
      return `Too many requests from your network today. Try again after ${after}.`;
    case "faucet_merchant_daily":
      return `You’ve used your 3 test drops for today. Try again after ${after}.`;
    case "faucet_daily":
      return `The test faucet has given out its share for today. Try again after ${after}.`;
    case "faucet_unavailable":
      return "The test faucet isn’t available right now.";
  }
}

export function TestAusdCard({ send }: { send: (address: string) => Promise<{ amountUsd: string; txHash: string }> }) {
  const [address, setAddress] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [sending, setSending] = useState(false);
  // A second press while the first is in flight must not send twice (BR-DSH-014).
  const inFlight = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const to = address.trim();
    setRefusal(null);
    setSent(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
      setFieldError("Enter a 0x address");
      return;
    }
    setFieldError(null);
    inFlight.current = true;
    setSending(true);
    try {
      const drop = await send(to);
      setSent({ to, txHash: drop.txHash });
      setAddress("");
    } catch (err) {
      if (err instanceof FaucetRefused) setRefusal(refusalSentence(err.code, err.resetsAt));
      else if (err instanceof DashboardApiError && err.code === "invalid_input") setFieldError(err.message);
      else setRefusal("We couldn’t reach the test faucet. Try again.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <section aria-labelledby="test-ausd-title" className="mt-10 max-w-xl rounded-lg border border-border bg-card p-4 md:p-5">
      <h2 id="test-ausd-title" className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
        Get test AUSD
      </h2>
      <p className="mt-1 text-[13px] text-ink-soft">Send 15 test AUSD to any Monad testnet address to try your checkout.</p>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="test-ausd-address" className="sr-only">
            Testnet address
          </label>
          <input
            id="test-ausd-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "test-ausd-error" : undefined}
            className="numerals h-11 w-full rounded-md border border-border bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {fieldError && (
            <p id="test-ausd-error" className="mt-1.5 text-[13px] text-destructive">
              {fieldError}
            </p>
          )}
        </div>
        <Button type="submit" disabled={sending} className="h-11 shrink-0">
          {sending ? "Sending…" : "Send 15 test AUSD"}
        </Button>
      </form>
      <div aria-live="polite">
        {sent && (
          <p className="mt-3 text-[13px]">
            Sent 15 AUSD to <span className="numerals">{short(sent.to)}</span> · tx{" "}
            <a href={txUrl(sent.txHash, false)} target="_blank" rel="noreferrer" className="numerals underline underline-offset-2">
              {short(sent.txHash)} ↗
            </a>
          </p>
        )}
        {refusal && <p className="mt-3 text-[13px] text-ink-soft">{refusal}</p>}
      </div>
    </section>
  );
}
