import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { ElapseAuthenticationError, ElapseError } from "@elapse/sdk";
import { defaultConfigDir, deleteProfile, resolveBaseUrl, resolveSecretKey, saveProfile } from "./config";
import { CLI_VERSION } from "./forward";
import { paint, redact, table, useColor } from "./format";
import { Platform, PlatformError } from "./platform";
import { listen, ListenError, MVP_EVENT_TYPES } from "./commands/listen";
import { readHidden } from "./prompt";

/**
 * `elapse` entrypoint (CLI FRD). Exit codes (FR-CLI-032): 0 success, 1 runtime
 * error, 2 usage or auth error. `--json` puts machine output on stdout and every
 * human line on stderr (FR-CLI-023). Argument parsing is Node's own `parseArgs`,
 * so the package has no dependency beyond `@elapse/sdk` (FR-CLI-031).
 */

export interface MainIO {
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  configDir?: string;
  /** Hidden-input prompt for `login`. */
  prompt?: (question: string) => Promise<string>;
  isTTY?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const USAGE = `elapse ${CLI_VERSION} — receive Elapse webhooks on localhost. You only pay what elapsed.

Usage
  elapse login                                   save a secret key (paste, hidden)
  elapse logout                                  forget the saved key
  elapse listen --forward <url> [options]        stream your Deliveries to a local server
  elapse events list [--limit n] [--type t]      recent Events
  elapse events resend <evt_id>                  redeliver an Event to every endpoint
  elapse products create --name <s> --rate <d>   create a Product billed per second
  elapse checkout create --product <prod_id> --success-url <u> --cancel-url <u>

Global options
  --api-key <sk_…>      secret key (after ELAPSE_SECRET_KEY, before the saved login)
  --base-url <url>      API host (or ELAPSE_BASE_URL); default https://api.elapse.finance
  --json                machine-readable output on stdout, messages on stderr
  --help, --version

Env: ELAPSE_SECRET_KEY, ELAPSE_BASE_URL, NO_COLOR`;

const LISTEN_USAGE = `elapse listen --forward <url>

  --forward <url>       local URL to POST each Delivery to (scheme optional: localhost:3000/webhooks)
  --no-forward          print only; no local server needed
  --events <a,b,…>      forward only these types (others are printed as skipped)
  --compact             one-line JSON bodies
  --print-secret        also print ELAPSE_WEBHOOK_SECRET=… for copy-paste
  --live                required to listen with a live key`;

type Globals = { apiKey?: string; baseUrl?: string; json: boolean; help: boolean; version: boolean };

class Usage extends Error {}

export async function main(argv: string[], io: MainIO): Promise<0 | 1 | 2> {
  const color = useColor(io.env, io.isTTY ?? false);
  const p = paint(color);
  const say = (l: string) => io.stderr(redact(l));
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: false,
      options: {
        "api-key": { type: "string" },
        "base-url": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
    const g: Globals = { json: values.json === true, help: values.help === true, version: values.version === true };
    if (typeof values["api-key"] === "string") g.apiKey = values["api-key"];
    if (typeof values["base-url"] === "string") g.baseUrl = values["base-url"];
    if (g.version) {
      io.stdout(CLI_VERSION);
      return 0;
    }
    const [cmd, sub, ...rest] = positionals;
    if (!cmd || (g.help && !cmd)) {
      io.stdout(USAGE);
      return 0;
    }
    const configDir = io.configDir ?? defaultConfigDir(io.env);
    const baseUrl = resolveBaseUrl({ env: io.env, flag: g.baseUrl });
    const needKey = (): string => {
      const k = resolveSecretKey({ env: io.env, flag: g.apiKey, configDir });
      if (!k) throw new Auth("Set ELAPSE_SECRET_KEY or run: elapse login");
      return k.key;
    };
    const out = (human: string, machine?: unknown) => {
      if (g.json) {
        if (machine !== undefined) io.stdout(JSON.stringify(machine, null, 2));
        if (human) say(human);
      } else for (const line of human.split("\n")) io.stdout(line);
    };

    switch (cmd) {
      case "login": {
        if (g.help) return help(io, "elapse login\n\n  Prompts for a secret key (hidden), checks it, saves it to " + configDir + "/config.json (0600).");
        const prompt = io.prompt ?? readHidden;
        const key = (await prompt("Paste your secret key (sk_test_… or sk_live_…): ")).trim();
        if (!/^sk_(test|live)_[0-9A-Za-z]+$/.test(key)) throw new Auth("That is not a secret key. It starts with sk_test_ or sk_live_.");
        const platform = new Platform(baseUrl, key, io.fetchImpl);
        await platform.validate();
        const session = await platform.openSession();
        saveProfile(configDir, { secret_key: key, merchant_name: session.merchant_name, livemode: session.livemode });
        liveBanner(session.livemode, say, p);
        out(`Logged in as ${p.bold(session.merchant_name)} · ${session.livemode ? "LIVE mode" : "test mode"} · saved to ${configDir}/config.json`, { merchant_name: session.merchant_name, livemode: session.livemode });
        return 0;
      }
      case "logout": {
        if (g.help) return help(io, "elapse logout\n\n  Deletes the saved login.");
        const removed = deleteProfile(configDir);
        out(removed ? "Logged out. The saved key was deleted." : "No saved login to remove.", { removed });
        return 0;
      }
      case "listen": {
        if (g.help) return help(io, LISTEN_USAGE);
        const l = parseArgs({
          args: argv.slice(argv.indexOf("listen") + 1),
          allowPositionals: true,
          strict: false,
          options: {
            forward: { type: "string" },
            "no-forward": { type: "boolean", default: false },
            events: { type: "string" },
            compact: { type: "boolean", default: false },
            "print-secret": { type: "boolean", default: false },
            live: { type: "boolean", default: false },
          },
        }).values;
        const forward = typeof l.forward === "string" ? l.forward : undefined;
        if (!forward && !l["no-forward"]) throw new Usage("listen needs --forward <url> (or --no-forward to print only).");
        let events: string[] | undefined;
        if (typeof l.events === "string") {
          events = l.events.split(",").map((s) => s.trim()).filter(Boolean);
          const bad = events.find((e) => !(MVP_EVENT_TYPES as readonly string[]).includes(e));
          if (bad) throw new Usage(`Unknown event type "${bad}". Known: ${MVP_EVENT_TYPES.join(", ")}`);
        }
        const key = needKey();
        const summary = await listen({
          baseUrl,
          key,
          forward: l["no-forward"] ? undefined : forward,
          events,
          compact: l.compact === true,
          printSecret: l["print-secret"] === true,
          live: l.live === true,
          json: g.json,
          color,
          stdout: g.json ? say : io.stdout,
          stderr: say,
          ...(io.signal ? { signal: io.signal } : {}),
          ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
        });
        out(`${summary.received} received · ${summary.forwarded} forwarded OK · ${summary.failed} failed · ${summary.skipped} skipped`, summary);
        return 0;
      }
      case "events": {
        if (g.help || !sub) return help(io, "elapse events list [--limit n] [--type t]\nelapse events resend <evt_id>", sub ? 0 : 2);
        const key = needKey();
        const platform = new Platform(baseUrl, key, io.fetchImpl);
        if (sub === "list") {
          const v = parseArgs({ args: argv.slice(argv.indexOf("list") + 1), strict: false, allowPositionals: true, options: { limit: { type: "string" }, type: { type: "string" } } }).values;
          const limit = typeof v.limit === "string" ? Number(v.limit) : 20;
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Usage("--limit must be 1–100.");
          const type = typeof v.type === "string" ? v.type : undefined;
          const res = await platform.listEvents({ limit, type });
          const rows = res.data.map((e) => [e.id, e.type, new Date(e.created * 1000).toISOString().replace("T", " ").slice(0, 19), String(e.pending_webhooks)]);
          out(table(["id", "type", "created", "pending_webhooks"], rows), res);
          return 0;
        }
        if (sub === "resend") {
          const id = rest[0];
          if (!id) throw new Usage("events resend needs an evt_ id.");
          const res = await platform.resendEvent(id);
          const lines = res.data.map((d) => `${d.id}  → ${d.endpoint_url === "cli://" ? "CLI (elapse listen)" : d.endpoint_url}  queued`);
          out(lines.length ? lines.join("\n") : `No deliveries to resend for ${id} (no endpoint matched it, and no CLI is listening).`, res);
          return 0;
        }
        throw new Usage(`Unknown command: events ${sub}`);
      }
      case "products": {
        if (g.help || sub !== "create") return help(io, 'elapse products create --name "GPU · 4090" --rate 0.004', sub === "create" ? 0 : 2);
        const v = parseArgs({ args: argv.slice(argv.indexOf("create") + 1), strict: false, allowPositionals: true, options: { name: { type: "string" }, rate: { type: "string" } } }).values;
        if (typeof v.name !== "string" || typeof v.rate !== "string") throw new Usage("products create needs --name and --rate.");
        if (!/^\d+(\.\d+)?$/.test(v.rate)) throw new Usage('--rate is a decimal string such as 0.004 (USD per second).');
        const key = needKey();
        const platform = new Platform(baseUrl, key, io.fetchImpl);
        const product = await platform.sdk.products.create({ name: v.name, rateUsdPerSecond: v.rate });
        out(`${product.id}  ${product.name}  $${product.rate_usd_per_second}/s`, product);
        return 0;
      }
      case "checkout": {
        if (g.help || sub !== "create") return help(io, "elapse checkout create --product <prod_id> --success-url <u> --cancel-url <u>", sub === "create" ? 0 : 2);
        const v = parseArgs({ args: argv.slice(argv.indexOf("create") + 1), strict: false, allowPositionals: true, options: { product: { type: "string" }, "success-url": { type: "string" }, "cancel-url": { type: "string" } } }).values;
        if (typeof v.product !== "string" || typeof v["success-url"] !== "string" || typeof v["cancel-url"] !== "string") throw new Usage("checkout create needs --product, --success-url and --cancel-url.");
        const key = needKey();
        const platform = new Platform(baseUrl, key, io.fetchImpl);
        const session = await platform.sdk.checkout.sessions.create({ product: v.product, successUrl: v["success-url"], cancelUrl: v["cancel-url"] });
        out(session.url, session);
        return 0;
      }
      default:
        throw new Usage(`Unknown command: ${cmd}`);
    }
  } catch (e) {
    if (e instanceof Usage) {
      say(p.red(e.message));
      say("Run: elapse --help");
      return 2;
    }
    if (e instanceof Auth || e instanceof ListenError) {
      say(p.red(e.message));
      return e instanceof ListenError ? e.exitCode : 2;
    }
    if (e instanceof ElapseAuthenticationError || (e instanceof PlatformError && e.status === 401)) {
      say(p.red(e.message));
      return 2;
    }
    if (e instanceof ElapseError || e instanceof PlatformError) {
      say(p.red(e.message));
      return 1;
    }
    say(p.red(`Could not reach Elapse: ${(e as Error).message}`));
    return 1;
  }
}

class Auth extends Error {}

function help(io: MainIO, text: string, code: 0 | 2 = 0): 0 | 2 {
  (code === 0 ? io.stdout : io.stderr)(text);
  return code;
}

function liveBanner(livemode: boolean, say: (l: string) => void, p: ReturnType<typeof paint>) {
  if (livemode) say(p.red(p.bold("LIVE")) + " mode: this key is live.");
}

// Run when invoked as the `elapse` binary (dist/elapse.js); not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ac = new AbortController();
  process.on("SIGINT", () => {
    process.stderr.write("\n");
    ac.abort();
  });
  main(process.argv.slice(2), {
    env: process.env,
    stdout: (l) => process.stdout.write(l + "\n"),
    stderr: (l) => process.stderr.write(l + "\n"),
    isTTY: process.stdout.isTTY === true,
    signal: ac.signal,
  }).then((code) => process.exit(code));
}
