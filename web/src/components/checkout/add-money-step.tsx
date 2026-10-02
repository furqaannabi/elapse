/**
 * `AddMoneyStep` — the wallet is short of the chosen cap, so the subscriber
 * sends money to it. Shows the balance (ticking up as money lands), the amount
 * needed, the receiving address as a QR code and text with Copy, and the one
 * sentence naming what to send and where. Polls the balance every 5 s and hands
 * back to the cap step by itself once the cap is affordable.
 *
 * This is the one subscriber screen besides judge mode that names the token
 * and the network (BR-CHK-001 exception). It never shows a token contract, an
 * explorer link, a fee, a seed or a key.
 *
 * In test mode it can also offer a drop from the test faucet (FR-CHK-041): one button above the
 * address. The button only asks; the poll is still what moves the window on, once the money shows.
 *
 * Maps to: FR-CHK-031, FR-CHK-041; BR-CHK-001 (exception), BR-CHK-007.
 */
"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseUsd } from "@/lib/checkout/funding";
import { FaucetRefusedError, type FaucetRefusalCode } from "@/lib/checkout/mock-api";
import type { CheckoutBalance } from "@/lib/checkout/types";
import { formatUsd } from "@/lib/meter/math";

/** How often the balance is re-read while this step is open (FR-CHK-031). */
export const BALANCE_POLL_MS = 5_000;

/** "14:32", or "tomorrow at 14:32" when the limit eases after midnight — the faucet's windows are 24 hours. */
function when(resetsAt: number | null): string {
  if (resetsAt === null) return "a while";
  const at = new Date(resetsAt * 1000);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? time : `tomorrow at ${time}`;
}

/**
 * FR-CHK-041: one sentence per refusal, naming the limit and when it eases. Only "test AUSD" and
 * "address" may be said here (BR-CHK-001 exception) — never wallet, network or connection.
 */
function refusalSentence(code: FaucetRefusalCode, resetsAt: number | null, amountUsd: string): string {
  switch (code) {
    case "faucet_wallet_daily":
      return `You’ve already had your test AUSD today. Ask again after ${when(resetsAt)}.`;
    case "faucet_ip_daily":
      return `Too many requests from here today. Try again after ${when(resetsAt)}.`;
    case "faucet_daily":
      return `The test faucet has given out its share for today. Try again after ${when(resetsAt)}.`;
    case "faucet_wallet_funded":
      return `You already have ${amountUsd} test AUSD or more, so the faucet can’t add to it.`;
    case "faucet_unavailable":
      return "The test faucet can’t pay right now. Send test AUSD to the address below instead.";
  }
}

type FaucetState = { k: "ready" } | { k: "sending" } | { k: "sent" } | { k: "refused"; sentence: string } | { k: "unreachable" };

export function AddMoneyStep({
  neededUsd,
  initial,
  refresh,
  onFunded,
  cancelHref,
  faucet,
}: {
  /** The cap's escrow, USD decimal string. */
  neededUsd: string;
  initial: CheckoutBalance;
  /** Re-reads the balance; called on the poll. */
  refresh: () => Promise<CheckoutBalance>;
  /** Called once with the balance that covers the cap. */
  onFunded: (balance: CheckoutBalance) => void;
  /** The merchant's cancel URL, for "Not now". */
  cancelHref: string;
  /** FR-CHK-041: offered only when the balance says the test faucet serves this session. */
  faucet?: { amountUsd: string; request: () => Promise<void> };
}) {
  const [balance, setBalance] = useState(initial);
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [drop, setDrop] = useState<FaucetState>({ k: "ready" });
  const funded = useRef(false);
  const needed = parseUsd(neededUsd);

  // The QR library is loaded only here; nothing else on the checkout draws one.
  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then((q) => q.toString(initial.receiveAddress, { type: "svg", margin: 0, errorCorrectionLevel: "M" }))
      .then((s) => alive && setSvg(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [initial.receiveAddress]);

  useEffect(() => {
    const id = setInterval(() => {
      refresh()
        .then((b) => {
          setBalance(b);
          if (!funded.current && parseUsd(b.balanceUsd) >= needed) {
            funded.current = true;
            onFunded(b);
          }
        })
        .catch(() => {});
    }, BALANCE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh, onFunded, needed]);

  const askFaucet = async () => {
    if (!faucet || drop.k === "sending" || drop.k === "sent") return;
    setDrop({ k: "sending" });
    try {
      await faucet.request();
      // On its way. The poll below notices the balance and moves the window on.
      setDrop({ k: "sent" });
    } catch (e) {
      setDrop(e instanceof FaucetRefusedError ? { k: "refused", sentence: refusalSentence(e.code, e.resetsAt, faucet.amountUsd) } : { k: "unreachable" });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(balance.receiveAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The address is on screen; the subscriber can select it.
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div>
        <h2 className="text-balance text-xl font-semibold leading-tight tracking-[-0.02em]">Add funds to start</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Send {balance.token} on {balance.network} to this address. It usually arrives within a minute.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <dt className="text-ink-soft">Balance</dt>
        <dd className="numerals text-right" aria-live="polite">{formatUsd(parseUsd(balance.balanceUsd))}</dd>
        <dt className="text-ink-soft">Needed</dt>
        <dd className="numerals text-right">{formatUsd(needed)}</dd>
      </dl>

      {faucet && drop.k === "refused" && (
        <p className="text-sm text-ink-soft" role="status">{drop.sentence}</p>
      )}
      {faucet && drop.k !== "refused" && (
        <div className="flex flex-col gap-2">
          <Button onClick={() => void askFaucet()} disabled={drop.k === "sending" || drop.k === "sent"} className="h-11 w-full">
            {drop.k === "sending" || drop.k === "sent" ? "On its way…" : `Get ${faucet.amountUsd} test AUSD`}
          </Button>
          {drop.k === "unreachable" && (
            <p className="text-sm text-ink-soft" role="status">We couldn&rsquo;t reach the test faucet. Try again.</p>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-4">
        <div
          role="img"
          aria-label="Your receiving address as a QR code"
          className="size-44 rounded-md bg-white p-2 [&_svg]:size-full"
          dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
        />
        <p className="numerals w-full break-all text-center text-xs text-ink-soft select-all">{balance.receiveAddress}</p>
        <Button variant="outline" onClick={() => void copy()} className="h-11 w-full" aria-label="Copy address">
          {copied ? <Check data-icon="inline-start" className="size-4" /> : <Copy data-icon="inline-start" className="size-4" />}
          {copied ? "Copied" : "Copy address"}
        </Button>
      </div>

      <p className="text-center text-xs text-ink-soft">We&rsquo;ll continue by ourselves once it lands.</p>

      <a href={cancelHref} className="mt-auto flex min-h-11 items-center justify-center text-center text-sm !text-ink-soft !no-underline hover:!text-foreground">
        Not now
      </a>
    </section>
  );
}
