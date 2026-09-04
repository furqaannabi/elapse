/**
 * `ModeBanner` — the slim amber line under the top bar while in test mode.
 * Live mode renders nothing. Status is carried by the words, the tint only
 * reinforces it.
 *
 * Maps to: FR-DSH-003; BR-DSH-002, BR-DSH-005 (chain name allowed here).
 */
"use client";

import { useMode } from "@/lib/dashboard/mode";

export function ModeBanner() {
  const mode = useMode();
  if (mode !== "test") return null;
  return (
    <div
      role="status"
      aria-label="Test mode"
      className="border-b border-caution/25 bg-caution-soft px-5 py-1.5 text-[13px] text-foreground md:px-8"
    >
      <span className="font-semibold text-caution">Test mode.</span>{" "}
      <span className="text-ink-soft">Data here comes from the Monad testnet and test keys.</span>
    </div>
  );
}
