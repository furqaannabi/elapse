import { reconcileBoot, type PlatformSubscription } from "./claim";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { Elapse } from "@elapse/sdk";
import type { AddressInfo } from "node:net";
import type { Config } from "./config";
import { awsRunner, mockRunner, type Executor } from "./executor";
import { createServer, sweepOnce, type ServerDeps } from "./server";
import { createSessionStore } from "./session";

/**
 * FR-EXM-102: what `npm start` does. Find or create the Product, wire the runner and the
 * auto-end sweep, listen. Unlike the saas example it opens no Checkout session here: a session
 * is created on demand by the subscriber's first Run (FR-EXM-114), because there is no Start
 * button to hand one to.
 */

export const PRODUCT = { name: "Serverless runtime", rateUsdPerSecond: "0.002" } as const;

/** How often the server looks for sessions that should end themselves (FR-EXM-117). */
const SWEEP_INTERVAL_MS = 5_000;

export interface BootIO {
  /** The startup lines a judge reads. */
  out: (line: string) => void;
  /** The per-Event and per-run log. */
  log: (line: string) => void;
  logJson?: boolean;
  /** `mock` is the tests/CI seam (FR-EXM-121); real runs always use the AWS runner. */
  runnerMode?: "aws" | "mock";
}

export async function boot(config: Config, io: BootIO) {
  const elapse = new Elapse({ secretKey: config.secretKey, baseUrl: config.apiUrl });

  // region:product
  // FR-EXM-102 (amended): the Product is merchant-started, so authorising does not start the
  // meter — the first Run does (FR-EXM-125). A same-named checkout-mode Product is not reused:
  // its meter would start the moment the subscriber authorised, and editing code would be billed.
  const existing = (await elapse.products.list({ limit: 100 })).data.find(
    (p) => p.name === PRODUCT.name && p.active && p.start_mode === "merchant",
  );
  const product =
    existing ?? (await elapse.products.create({ name: PRODUCT.name, rateUsdPerSecond: PRODUCT.rateUsdPerSecond, startMode: "merchant", allowPause: true }));
  // endregion

  let executor: Executor;
  if (io.runnerMode === "mock") {
    executor = mockRunner();
  } else {
    const lambda = new LambdaClient({ region: config.awsRegion });
    executor = awsRunner({ client: { send: (command) => lambda.send(command) }, fnName: config.lambdaFn });
  }

  const sessions = createSessionStore({ dailyRunLimit: config.dailyRunLimit });

  const deps: ServerDeps = {
    sessions,
    executor,
    webhookSecret: config.webhookSecret,
    log: io.log,
    ...(io.logJson === undefined ? {} : { logJson: io.logJson }),
    // region:cap
    // FR-EXM-119: the cap the subscriber authorises once. rate x maxDurationSeconds is the most
    // this session can ever cost, enforced on-chain even if every auto-end path fails.
    createCheckoutSession: async () => {
      const session = await elapse.checkout.sessions.create({
        product: product.id,
        successUrl: `${config.baseUrl}/console`,
        cancelUrl: `${config.baseUrl}/cancel`,
        maxDurationSeconds: config.maxDurationSeconds,
      });
      // FR-EXM-157: remember it, so a claim can be bound to a session this server actually issued.
      sessions.issueCheckout(session.id);
      return { id: session.id };
    },
    // region:claim
    // FR-EXM-157: what the platform says about a subscription the browser claims. A 404 is the
    // platform answering — that subscription is not this merchant's — while anything else is not
    // knowing, and the two lead to very different answers.
    ourProduct: product.id,
    retrieveSubscription: async (sub) => {
      try {
        const s = await elapse.subscriptions.retrieve(sub);
        // `checkout_session` reaches the SDK through `SubscriptionObject`'s index signature, so it
        // arrives as `unknown` and is narrowed here rather than asserted.
        const cs = s.checkout_session;
        return {
          k: "found",
          ...(typeof cs === "string" ? { checkoutSession: cs } : {}),
          product: s.product,
          status: s.status,
        };
      } catch (err) {
        return (err as { status?: number }).status === 404 ? { k: "not_found" } : { k: "unreachable" };
      }
    },
    // endregion
    // endregion
    // region:start
    // FR-EXM-125: the first Run starts the meter. Until this call the subscriber's money sits in
    // escrow and nothing accrues; `active` arrives by webhook once the chain confirms.
    startSubscription: async (sub) => {
      await elapse.subscriptions.start(sub);
    },
    // endregion
    // region:meter
    // endregion
    // region:end
    // BR-EXM-110: the server ends the session; the canceled webhook confirms it.
    cancelSubscription: async (sub) => {
      await elapse.subscriptions.cancel(sub);
    },
    // FR-EXM-156: the subscriber asks Northwind to pause; Northwind is the one that calls Elapse.
    resumeSubscription: async (sub) => {
      await elapse.subscriptions.resume(sub);
    },
    // endregion
    product: { name: product.name, rateUsdPerSecond: product.rate_usd_per_second },
    // FR-EXM-152: what the console page hands to <ElapseProvider>.
    maxDurationSeconds: config.maxDurationSeconds,
    elapse: { publishableKey: config.publishableKey, apiUrl: config.apiUrl, appUrl: config.appUrl },
    now: () => Date.now(),
  };

  const server = createServer(deps);
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) =>
      reject(new Error(err.code === "EADDRINUSE" ? `EADDRINUSE: port ${config.port} is already in use. Set PORT in .env.` : err.message)),
    );
    server.listen(config.port, resolve);
  });
  const port = (server.address() as AddressInfo).port;

  const windows = { idleTimeoutMs: config.idleTimeoutSeconds * 1000, heartbeatStaleMs: config.heartbeatStaleSeconds * 1000, pausedEndMs: config.pausedEndSeconds * 1000 };
  const sweep = setInterval(() => {
    void sweepOnce(deps, Date.now(), windows).catch((err: Error) => io.log(`✗ sweep: ${err.message}`));
  }, SWEEP_INTERVAL_MS);
  sweep.unref?.();

  // FR-EXM-158: the meters that outlived the last process. The store is in memory, so without this
  // a restart orphans a running meter: it keeps billing on chain and nothing here can end it.
  try {
    const running = await Promise.all(
      (["active", "paused"] as const).map((status) => elapse.subscriptions.list({ product: product.id, status, limit: 100 })),
    );
    const adopted = reconcileBoot(running.flatMap((page) => page.data as unknown as PlatformSubscription[]), product.id);
    for (const a of adopted) {
      sessions.applyOpen(a.sub, { startedAt: a.startedAt, nowMs: Date.now() });
      // The pause began before this process did; dating it now gives an abandoned meter the full
      // FR-EXM-154 window again rather than ending it the moment we come up.
      if (a.state === "paused") sessions.applyPaused(a.sub, { nowMs: Date.now() });
      sessions.markReadopted(a.sub);
      io.out(`Adopted:  ${a.sub} (${a.state}) — it kept running while this server was down`);
    }
  } catch (err) {
    // A platform that cannot be reached at boot is not a reason to refuse to start; the meters are
    // on chain either way, and the next restart tries again.
    io.log(`✗ reconcile: ${(err as Error).message}`);
  }

  io.out(`Product:  ${product.id}  ${product.name}  $${product.rate_usd_per_second}/s`);
  io.out(`Webhooks: POST ${config.baseUrl}/webhooks`);
  io.out(`Runner:   ${config.lambdaFn} @ ${config.awsRegion}`);
  io.out(`Listening on :${port}`);

  return {
    server,
    product,
    sessions,
    port,
    close: () =>
      new Promise<void>((r) => {
        clearInterval(sweep);
        server.close(() => r());
      }),
  };
}
