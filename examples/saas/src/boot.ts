import { Elapse } from "@elapse/sdk";
import type { AddressInfo } from "node:net";
import type { Config } from "./config";
import { Entitlements } from "./entitlements";
import { createServer } from "./server";

/**
 * FR-EXM-003: what `npm start` does. Find or create the Product, create the
 * first Checkout session, print where things are, listen. Every platform call
 * goes through `@elapse/sdk` with an explicit `baseUrl` (BR-EXM-001, docs BR-DOC-008).
 */

export const PRODUCT = { name: "GPU · 4090", rateUsdPerSecond: "0.004" } as const;

export interface BootIO {
  /** The startup lines a judge reads. */
  out: (line: string) => void;
  /** The per-Event log (FR-EXM-024), prefixed with a clock by the caller. */
  log: (line: string) => void;
  logJson?: boolean;
}

export async function boot(config: Config, io: BootIO) {
  const { secretKey, apiUrl, baseUrl } = config;
  // region:client
  const elapse = new Elapse({ secretKey, baseUrl: apiUrl });
  // endregion

  // region:product
  const existing = (await elapse.products.list({ limit: 100 })).data.find((p) => p.name === PRODUCT.name && p.active);
  const product = existing ?? (await elapse.products.create({ name: PRODUCT.name, rateUsdPerSecond: PRODUCT.rateUsdPerSecond }));
  // endregion

  // region:session
  const createSession = async () => {
    const session = await elapse.checkout.sessions.create({ product: product.id, successUrl: `${baseUrl}/ok`, cancelUrl: `${baseUrl}/cancel` });
    return { id: session.id, url: session.url };
  };
  // endregion

  // The session printed at start is the one the product page hands out first.
  const first = await createSession();
  let handout: { id: string; url: string } | undefined = first;
  const nextSession = async () => {
    if (handout) {
      const s = handout;
      handout = undefined;
      return s;
    }
    return createSession();
  };

  const entitlements = new Entitlements();
  const server = createServer({ entitlements, webhookSecret: config.webhookSecret, log: io.log, ...(io.logJson === undefined ? {} : { logJson: io.logJson }), createSession: nextSession, product: { name: product.name, rateUsdPerSecond: product.rate_usd_per_second } });
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => reject(new Error(err.code === "EADDRINUSE" ? `EADDRINUSE: port ${config.port} is already in use. Set PORT in .env.` : err.message)));
    server.listen(config.port, resolve);
  });
  const port = (server.address() as AddressInfo).port;

  io.out(`Product:  ${product.id}  ${product.name}  $${product.rate_usd_per_second}/s`);
  io.out(`Checkout: ${first.url}`);
  io.out(`Webhooks: POST ${config.baseUrl}/webhooks`);
  io.out(`Listening on :${port}`);

  return { server, product, entitlements, port, close: () => new Promise<void>((r) => server.close(() => r())) };
}
