import { config } from "../config";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export type Mailer = (mail: Mail) => Promise<void>;

/**
 * One `sendEmail()` behind which the provider can change (Undecided 10:
 * Resend). With `RESEND_API_KEY` set, one HTTPS call to Resend. Without it,
 * outside production, the mail is printed to stdout so local sign-in works
 * with no account. In production a missing key is an error, never a silent
 * drop. Tests replace the mailer with `setMailer`.
 */
let mailer: Mailer | null = null;

export function setMailer(m: Mailer | null): void {
  mailer = m;
}

export async function sendEmail(mail: Mail): Promise<void> {
  if (mailer) return mailer(mail);
  const key = process.env.RESEND_API_KEY;
  if (key) return viaResend(key, mail);
  if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set");
  console.log(`[dev mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
}

async function viaResend(key: string, mail: Mail): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.email.from, to: [mail.to], subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}
