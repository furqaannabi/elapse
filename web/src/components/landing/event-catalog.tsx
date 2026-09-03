/**
 * `EventCatalog` — the six lifecycle webhooks. A table from `md` up; on
 * phones each event stacks as type / when / action so nothing scrolls
 * sideways or clips.
 *
 * Source: detailed doc §5.1.
 */
const events = [
  ["checkout.session.completed", "Subscriber finished Face ID checkout", "Provision access"],
  ["subscription.created", "Meter started", "Mark entitled"],
  ["subscription.updated", "Pause, resume, or rate change", "Sync entitlement"],
  ["subscription.canceled", "Cancel; elapsed seconds settled", "Revoke access immediately"],
  ["invoice.settled", "Accrued funds settled to you", "Book revenue"],
  ["invoice.payment_failed", "Subscriber's funds ran out", "Pause product access"],
] as const;

export function EventCatalog() {
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-16 md:px-8 md:py-20">
      <div className="mb-10 grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
        <h2 className="display-wide text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-[2.5rem]">
          Six events. Never one per second.
        </h2>
        <p className="max-w-[52ch] self-end text-pretty text-lg text-ink-soft">
          The meter accrues continuously and ticks in the dashboard. Your
          server is notified on lifecycle only: signed with an HMAC you can
          verify in one line, retried up to eight times, deduplicated by
          event id.
        </p>
      </div>

      {/* md+: table */}
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/60">
              <th className="placard px-4 py-3 font-semibold">Type</th>
              <th className="placard px-4 py-3 font-semibold">When</th>
              <th className="placard px-4 py-3 font-semibold">Your action</th>
            </tr>
          </thead>
          <tbody>
            {events.map(([type, when, action]) => (
              <tr key={type} className="border-b border-border last:border-b-0">
                <td className="numerals whitespace-nowrap px-4 py-3.5 text-[13px]">{type}</td>
                <td className="px-4 py-3.5 text-[15px] text-ink-soft">{when}</td>
                <td className="px-4 py-3.5 text-[15px]">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* phones: stacked rows */}
      <ul className="divide-y divide-border rounded-lg border border-border md:hidden">
        {events.map(([type, when, action]) => (
          <li key={type} className="flex flex-col gap-1.5 px-4 py-4">
            <span className="numerals break-all text-[13px]">{type}</span>
            <span className="text-[15px] text-ink-soft">{when}</span>
            <span className="text-[15px]">
              <span className="placard mr-2">Action</span>
              {action}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm text-ink-soft">
        Need a live number? Poll{" "}
        <code className="numerals text-foreground">GET /v1/subscriptions/:id</code>{" "}
        and compute it locally from <code className="numerals text-foreground">rate</code>{" "}
        and <code className="numerals text-foreground">started_at</code>, exactly as
        the dashboard does.
      </p>
    </section>
  );
}
