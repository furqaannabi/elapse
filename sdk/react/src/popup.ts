/**
 * The signing popup handshake (FR-RCT-011/012/014). Every signature a subscriber gives happens in
 * a window on Elapse's own origin (BR-RCT-003), so the merchant's page never touches the wallet.
 *
 * The page opens the popup synchronously from the click that asked for it (popup blockers allow
 * only that), then trusts exactly one message: one whose origin is the Elapse app, whose source is
 * the window it opened, and whose nonce is the one generated for this attempt (BR-RCT-004). The
 * message carries only the step, the subscription id and the transaction hash; anything else in it
 * is dropped.
 */

export type SignAction = "authorise" | "cancel" | "pause" | "resume";
export type SignStep = "authorised" | "stopped" | "paused" | "resumed";

export interface PopupResult {
  step: SignStep;
  subscription: string;
  txHash: string;
}

/** Why a signature did not come back. */
export class SignatureError extends Error {
  constructor(readonly reason: "blocked" | "closed") {
    super(reason === "blocked" ? "Your browser blocked the Elapse window. Allow pop-ups and try again." : "Nothing was charged.");
    this.name = "SignatureError";
  }
}

/** The slice of `window` the handshake uses, so it can be tested without a browser. */
export interface PopupHost {
  open(url: string, target: string, features: string): { closed: boolean; close(): void } | null;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
}

const WIDTH = 480;
const HEIGHT = 720;
const STEPS: readonly SignStep[] = ["authorised", "stopped", "paused", "resumed"];

function newNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function requestSignature(opts: {
  appOrigin: string;
  session: string;
  action: SignAction;
  /** Required for `authorise`: the cap the subscriber chose, in seconds. */
  capSeconds?: number;
  host?: PopupHost;
  nonce?: string;
  /** How often to notice that the subscriber closed the popup. */
  closedPollMs?: number;
}): { result: Promise<PopupResult>; cancel: () => void } {
  const host = opts.host ?? (window as unknown as PopupHost);
  const nonce = opts.nonce ?? newNonce();
  const appOrigin = new URL(opts.appOrigin).origin;

  const url = new URL("/authorize", appOrigin);
  url.searchParams.set("session", opts.session);
  url.searchParams.set("action", opts.action);
  if (opts.capSeconds !== undefined) url.searchParams.set("cap", String(opts.capSeconds));
  url.searchParams.set("nonce", nonce);

  const left = Math.round(host.screenX + (host.outerWidth - WIDTH) / 2);
  const top = Math.round(host.screenY + (host.outerHeight - HEIGHT) / 2);
  // Opened before any await: browsers only allow a popup inside the user's click.
  const popup = host.open(url.toString(), "elapse-authorize", `popup,width=${WIDTH},height=${HEIGHT},left=${left},top=${top}`);

  let cleanup = () => {};
  const result = new Promise<PopupResult>((resolve, reject) => {
    if (!popup) {
      reject(new SignatureError("blocked"));
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== appOrigin || event.source !== (popup as unknown)) return;
      const d = event.data as Record<string, unknown> | null;
      if (!d || d.type !== "elapse:result" || d.nonce !== nonce) return;
      if (!STEPS.includes(d.step as SignStep) || typeof d.subscription !== "string" || typeof d.txHash !== "string") return;
      cleanup();
      resolve({ step: d.step as SignStep, subscription: d.subscription, txHash: d.txHash });
    };
    const closedTimer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new SignatureError("closed"));
      }
    }, opts.closedPollMs ?? 500);
    cleanup = () => {
      clearInterval(closedTimer);
      host.removeEventListener("message", onMessage);
    };
    host.addEventListener("message", onMessage);
  });

  return {
    result,
    cancel: () => {
      cleanup();
      popup?.close();
    },
  };
}
