import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the CLI finds its secret key and API host (FR-CLI-001, FR-CLI-003).
 * Precedence: `ELAPSE_SECRET_KEY` → `--api-key` → the saved profile
 * (`~/.config/elapse/config.json`, mode 0600, written by `elapse login`).
 */

export interface Profile {
  secret_key: string;
  merchant_name: string;
  livemode: boolean;
}

export const DEFAULT_BASE_URL = "https://api.elapse.dev";

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "elapse");
}

export function readProfile(configDir: string): Profile | null {
  const path = join(configDir, "config.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Profile>;
    if (typeof parsed.secret_key !== "string") return null;
    return { secret_key: parsed.secret_key, merchant_name: String(parsed.merchant_name ?? ""), livemode: parsed.livemode === true };
  } catch {
    return null;
  }
}

/** Writes the profile with owner-only permissions (BR-CLI-002). Returns the path. */
export function saveProfile(configDir: string, profile: Profile): string {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const path = join(configDir, "config.json");
  writeFileSync(path, JSON.stringify(profile, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** `elapse logout`: true when a profile was removed. */
export function deleteProfile(configDir: string): boolean {
  const path = join(configDir, "config.json");
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export type KeySource = "env" | "flag" | "profile";

export function resolveSecretKey(o: { env: NodeJS.ProcessEnv; flag: string | undefined; configDir: string }): { key: string; source: KeySource } | null {
  if (o.env.ELAPSE_SECRET_KEY) return { key: o.env.ELAPSE_SECRET_KEY, source: "env" };
  if (o.flag) return { key: o.flag, source: "flag" };
  const p = readProfile(o.configDir);
  return p ? { key: p.secret_key, source: "profile" } : null;
}

export function resolveBaseUrl(o: { env: NodeJS.ProcessEnv; flag: string | undefined }): string {
  return (o.flag ?? o.env.ELAPSE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}
