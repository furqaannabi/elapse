/**
 * FR-EXM-002: read the settings from the environment (plus the publishable key and Elapse app URL
 * `@elapse/react` needs on the product page, FR-EXM-032). A missing required
 * value throws a ConfigError whose message names the variable and where it comes from.
 */

export interface Config {
  secretKey: string;
  /** Handed to <ElapseProvider> on the product page; never a secret key (React BR-RCT-002). */
  publishableKey: string;
  webhookSecret: string;
  apiUrl: string;
  /** Where the Elapse signing popup lives. */
  appUrl: string;
  port: number;
  baseUrl: string;
}

export class ConfigError extends Error {}

const WHERE: Record<string, string> = {
  ELAPSE_SECRET_KEY: "Dashboard → Developers → API keys → Create.",
  ELAPSE_PUBLISHABLE_KEY: "Dashboard → Developers → API keys: the publishable key (pk_test_…) in the same mode.",
  ELAPSE_WEBHOOK_SECRET: "Printed by: npx @elapse/cli listen --forward localhost:3000/webhooks",
  ELAPSE_API_URL: "The hosted Elapse API, https://api.elapse.finance.",
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const need = (name: keyof typeof WHERE): string => {
    const v = env[name]?.trim();
    if (!v) throw new ConfigError(`${name} is missing. ${WHERE[name]}`);
    if (v.includes("…")) throw new ConfigError(`${name} still has the placeholder from .env.example. ${WHERE[name]}`);
    return v;
  };
  return {
    secretKey: need("ELAPSE_SECRET_KEY"),
    publishableKey: need("ELAPSE_PUBLISHABLE_KEY"),
    webhookSecret: need("ELAPSE_WEBHOOK_SECRET"),
    apiUrl: need("ELAPSE_API_URL").replace(/\/+$/, ""),
    appUrl: (env.ELAPSE_APP_URL ?? "https://elapse.finance").replace(/\/+$/, ""),
    port: Number(env.PORT ?? 3000),
    baseUrl: (env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  };
}
