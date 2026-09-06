/**
 * FR-EXM-002: read the five settings from the environment. A missing required
 * value throws a ConfigError whose message names the variable and where it comes from.
 */

export interface Config {
  secretKey: string;
  webhookSecret: string;
  apiUrl: string;
  port: number;
  baseUrl: string;
}

export class ConfigError extends Error {}

const WHERE: Record<string, string> = {
  ELAPSE_SECRET_KEY: "Dashboard → Developers → API keys → Create.",
  ELAPSE_WEBHOOK_SECRET: "Printed by: npx @elapse/cli listen --forward localhost:3000/webhooks",
  ELAPSE_API_URL: "The hosted Elapse API; see the docs Authentication page.",
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
    webhookSecret: need("ELAPSE_WEBHOOK_SECRET"),
    apiUrl: need("ELAPSE_API_URL").replace(/\/+$/, ""),
    port: Number(env.PORT ?? 3000),
    baseUrl: (env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  };
}
