/**
 * `DeliveryDrawer` — one delivery, opened beside the log: the request the
 * worker sent (headers including `X-Elapse-Signature`, JSON body), the
 * last response, every attempt with its result, and Resend.
 *
 * Maps to: FR-DSH-084; FR-WRK-030.
 */
"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CodeBlock } from "@/components/site/code-block";
import { clock } from "@/lib/dashboard/format";
import type { Delivery } from "@/lib/dashboard/types";
import { StatusChip } from "./status-chip";
import { DELIVERY_TONE, deliveryWord } from "./delivery-status";

const MAX_RESPONSE = 4096;

export function DeliveryDrawer({
  delivery,
  onClose,
  onResend,
  busy,
}: {
  delivery: Delivery | null;
  onClose: () => void;
  onResend: () => void;
  busy: boolean;
}) {
  const d = delivery;
  const last = d?.attempts[d.attempts.length - 1] ?? null;
  const request = d?.attempts[0] ?? null;
  return (
    <Sheet open={d !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {d && (
          <>
            <SheetHeader className="border-b border-border px-5 py-4 pr-14">
              <SheetTitle className="numerals text-[15px]">{d.event.type}</SheetTitle>
              <SheetDescription className="numerals text-[12px]">
                {d.event.id} → {d.endpoint.url}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusChip tone={DELIVERY_TONE[d.status]}>{deliveryWord(d)}</StatusChip>
                <span className="numerals text-[12px] text-ink-soft">
                  {d.attemptsMade} {d.attemptsMade === 1 ? "attempt" : "attempts"}
                  {(d.status === "pending" || d.status === "failed") && ` · automatic ${d.attempt} / ${d.maxAttempts}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onResend}
                  disabled={busy || d.endpointDisabled}
                  title={d.endpointDisabled ? "This endpoint is disabled. Enable it to resend." : undefined}
                  className="ml-auto h-8"
                >
                  <RotateCcw data-icon="inline-start" className="size-3.5" />
                  {busy ? "Sending…" : "Resend"}
                </Button>
              </div>
              {d.endpointDisabled && (
                <p className="mt-2 text-[12px] text-ink-soft">This endpoint is disabled. Enable it to resend.</p>
              )}
            </SheetHeader>

            <div className="flex flex-col gap-6 px-5 py-5">
              {request ? (
                <>
                  <section>
                    <h3 className="placard">Request headers</h3>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg border border-border bg-card p-3 text-[12px]">
                      {Object.entries(request.requestHeaders).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="code-title whitespace-nowrap">{k}</dt>
                          <dd className="numerals break-all">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section>
                    <h3 className="placard">Request body</h3>
                    <CodeBlock code={request.requestBody} title="application/json" lang="json" wrap className="mt-2" />
                  </section>
                </>
              ) : (
                <p className="text-[13px] text-ink-soft">No attempt has been made yet.</p>
              )}

              {last && (
                <section>
                  <h3 className="placard">Last response</h3>
                  <div className="mt-2 rounded-lg border border-border bg-card p-3 text-[13px]">
                    {last.responseCode !== null ? (
                      <p className="numerals">
                        HTTP {last.responseCode}
                        <span className="ml-2 text-ink-soft">at {clock(last.at)}</span>
                      </p>
                    ) : (
                      <p>
                        <span className="text-destructive">No response.</span>{" "}
                        <span className="numerals text-ink-soft">{last.error}</span>
                      </p>
                    )}
                    {last.responseBody && (
                      <pre className="numerals mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[12px] text-ink-soft">
                        {last.responseBody.length > MAX_RESPONSE ? `${last.responseBody.slice(0, MAX_RESPONSE)}…` : last.responseBody}
                      </pre>
                    )}
                  </div>
                </section>
              )}

              <section>
                <h3 className="placard">Attempts</h3>
                <ol aria-label="Attempts" className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {d.attempts.length === 0 && <li className="px-3 py-2.5 text-[13px] text-ink-soft">None yet.</li>}
                  {d.attempts.map((a, i) => (
                    <li key={a.at + ":" + i} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                      <span className="numerals w-6 text-ink-soft">{i + 1}</span>
                      <span className="numerals flex-1">
                        {a.responseCode !== null ? `HTTP ${a.responseCode}` : (a.error ?? "no response")}
                      </span>
                      {a.manual && <span className="placard">Manual</span>}
                      <span className="numerals text-ink-soft">{clock(a.at)}</span>
                    </li>
                  ))}
                </ol>
                {d.nextAttemptAt && d.status === "failed" && (
                  <p className="mt-2 text-[12px] text-ink-soft">Next automatic attempt at {clock(d.nextAttemptAt)}.</p>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
