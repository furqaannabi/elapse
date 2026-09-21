/**
 * FR-EXM-101: read settings from the environment. A missing required value throws a
 * ConfigError naming the variable and where it comes from; the boot script exits 1.
 * AWS credentials are never read here — the AWS SDK's own chain provides them (BR-EXM-105).
 */

export interface Config {
  secretKey: string;
  /** Handed to <ElapseProvider> in the console; never a secret key (React BR-RCT-002). */
  publishableKey: string;
  webhookSecret: string;
  /** Where the Elapse window that asks for Face ID lives (FR-EXM-152). */
  appUrl: string;
  apiUrl: string;
  lambdaFn: string;
  awsRegion: string;
  port: number;
  baseUrl: string;
  dailyRunLimit: number;
  maxDurationSeconds: number;
  idleTimeoutSeconds: number;
  heartbeatStaleSeconds: number;
  pausedEndSeconds: number;
}

export class ConfigError extends Error {}

const WHERE: Record<string, string> = {
  ELAPSE_SECRET_KEY: "Dashboard → Developers → API keys → Create.",
  ELAPSE_PUBLISHABLE_KEY: "Dashboard → Developers → API keys: the publishable key (pk_test_…) in the same mode.",
  ELAPSE_WEBHOOK_SECRET: "Printed by: npx @elapse/cli listen --forward localhost:3000/webhooks",
  ELAPSE_API_URL: "The hosted Elapse API, https://api.elapse.finance.",
  LAMBDA_FN: "The runner function name from the README's 'Provision the runner' step.",
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const need = (name: keyof typeof WHERE): string => {
    const v = env[name]?.trim();
    if (!v) throw new ConfigError(`${name} is missing. ${WHERE[name]}`);
    if (v.includes("…")) throw new ConfigError(`${name} still has the placeholder from .env.example. ${WHERE[name]}`);
    return v;
  };
  const num = (name: string, fallback: number): number => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${name} must be a positive number, got ${JSON.stringify(raw)}.`);
    return n;
  };
  return {
    secretKey: need("ELAPSE_SECRET_KEY"),
    publishableKey: need("ELAPSE_PUBLISHABLE_KEY"),
    webhookSecret: need("ELAPSE_WEBHOOK_SECRET"),
    appUrl: (env.ELAPSE_APP_URL ?? "https://elapse.finance").replace(/\/+$/, ""),
    apiUrl: need("ELAPSE_API_URL").replace(/\/+$/, ""),
    lambdaFn: need("LAMBDA_FN"),
    awsRegion: env.AWS_REGION?.trim() || "us-east-1",
    port: num("PORT", 3000),
    baseUrl: (env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    dailyRunLimit: num("DAILY_RUN_LIMIT", 20),
    maxDurationSeconds: num("MAX_DURATION_SECONDS", 3600),
    idleTimeoutSeconds: num("IDLE_TIMEOUT_SECONDS", 60),
    heartbeatStaleSeconds: num("HEARTBEAT_STALE_SECONDS", 15),
    // FR-EXM-154 (amended 2026-09-21): how long a paused session is kept before its escrow is
    // returned. Nothing accrues while paused, so this can be generous — it only reclaims a session
    // whose subscriber is not coming back.
    pausedEndSeconds: num("PAUSED_END_SECONDS", 600),
  };
}
