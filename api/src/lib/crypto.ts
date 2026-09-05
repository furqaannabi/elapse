import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Webhook signing secrets are encrypted at rest, not hashed, because the
 * worker must sign with them (FR-API-060, Undecided 7). AES-256-GCM under
 * `WEBHOOK_SECRET_KEK` (32 bytes, base64, from the server environment).
 * Blob layout: version(1) | iv(12) | tag(16) | ciphertext.
 */

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

function kek(): Buffer {
  const b64 = process.env.WEBHOOK_SECRET_KEK;
  if (!b64) throw new Error("WEBHOOK_SECRET_KEK is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("WEBHOOK_SECRET_KEK must decode to 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string): Uint8Array {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", kek(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]));
}

export function decryptSecret(blob: Uint8Array): string {
  const b = Buffer.from(blob);
  if (b[0] !== VERSION) throw new Error("Unknown secret blob version");
  const iv = b.subarray(1, 1 + IV_LEN);
  const tag = b.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = b.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", kek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
