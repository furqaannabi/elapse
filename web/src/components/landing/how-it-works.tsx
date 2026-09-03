/**
 * `HowItWorks` — the three-step merchant path, set as a ledger: step,
 * what you do, the exact SDK line. The lines are from the frozen SDK
 * surface (detailed doc §4.2), so nothing shown is aspirational.
 */
import { CodeBlock } from "@/components/site/code-block";

const SDK_SNIPPET = `import { Elapse } from "@elapse/sdk";

const elapse = new Elapse({ secretKey: process.env.ELAPSE_SECRET_KEY });

const product = await elapse.products.create({
  name: "GPU · 4090",
  rateUsdPerSecond: "0.004",
});

const session = await elapse.checkout.sessions.create({
  product: product.id,
  successUrl: "https://merchant.example/ok",
  cancelUrl: "https://merchant.example/cancel",
});
// session.url → subscriber Face ID checkout

const event = elapse.webhooks.constructEvent(
  rawBody,                          // unparsed bytes
  headers["x-elapse-signature"],
  process.env.ELAPSE_WEBHOOK_SECRET
);`;

const steps = [
  {
    n: "1",
    title: "Create a product",
    body: "Name it and give it a rate in dollars per second. That is the whole price list.",
    code: `products.create({ rateUsdPerSecond: "0.004" })`,
  },
  {
    n: "2",
    title: "Send them to Checkout",
    body: "Create a session, redirect to session.url. Face ID, a live counter, and a Cancel button. No chain words.",
    code: `checkout.sessions.create({ product }) → session.url`,
  },
  {
    n: "3",
    title: "Get the webhook",
    body: "When they cancel, your server receives subscription.canceled with seconds_elapsed. Revoke access. Book revenue.",
    code: `subscription.canceled { seconds_elapsed: 83 }`,
  },
] as const;

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-16 md:px-8 md:py-20">
      <div className="grid gap-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
        <div className="flex flex-col gap-10">
          <h2 className="display-wide text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-[2.5rem]">
            Integrate in an afternoon. It is the Stripe you already know.
          </h2>
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {steps.map((s) => (
              <li key={s.n} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4 py-6">
                <span className="numerals text-2xl leading-none text-ink-soft">
                  {s.n}
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold leading-tight tracking-[-0.01em]">
                    {s.title}
                  </h3>
                  <p className="max-w-[46ch] text-pretty text-ink-soft">{s.body}</p>
                  <code className="numerals mt-1 text-[13px] text-foreground/80">
                    {s.code}
                  </code>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <CodeBlock code={SDK_SNIPPET} title="server.ts" lang="ts" className="self-start" />
      </div>
    </section>
  );
}
