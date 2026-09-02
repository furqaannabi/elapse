import { createHmac, timingSafeEqual } from "node:crypto";

export type ElapseConfig = {
  secretKey: string;
  baseUrl?: string;
};

export class Elapse {
  readonly secretKey: string;
  readonly baseUrl: string;
  readonly webhooks = {
    constructEvent: (rawBody: string | Buffer, header: string | undefined, secret: string) =>
      constructEvent(rawBody, header, secret),
  };

  constructor(config: ElapseConfig) {
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl ?? "https://api.elapse.dev";
  }
}

export type ElapseEvent = {
  id: string;
  object: "event";
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

export function constructEvent(
  rawBody: string | Buffer,
  header: string | undefined,
  secret: string
): ElapseEvent {
  if (!header) throw new Error("Missing X-Elapse-Signature");
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.trim().split("=");
      return [k, v];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) throw new Error("Malformed X-Elapse-Signature");
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (age > 300) throw new Error("Expired signature");
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid signature");
  return JSON.parse(body) as ElapseEvent;
}
