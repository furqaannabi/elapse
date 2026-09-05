import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * FR-API-062. Live-mode webhook URLs must be `https://` and must not point at
 * loopback, private, link-local or metadata addresses, whether written as a
 * literal or reached through DNS. Test mode allows `http://` and local hosts
 * for ngrok and the CLI forwarder. Returns a reason string or null.
 */
export async function webhookUrlProblem(raw: string, livemode: boolean, resolve = lookup): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "must be an absolute URL";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "must be http or https";
  if (!livemode) return null;
  if (u.protocol !== "https:") return "must use https in live mode";

  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host)) return "must not point at a local or internal address";
  if (isIP(host)) return isPrivateIp(host) ? "must not point at a local or internal address" : null;
  try {
    const addrs = await resolve(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) return "must not resolve to a local or internal address";
  } catch {
    // Unresolvable now: nothing to protect against; the worker will report delivery failures.
  }
  return null;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localdomain");
}

/** RFC 1918, loopback, link-local, unspecified, CGNAT, IPv6 ULA/link-local/loopback, and v4-mapped v6. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateV4(mapped[1]!);
    return false;
  }
  return true;
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
