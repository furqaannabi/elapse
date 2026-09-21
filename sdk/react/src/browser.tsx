/**
 * The CDN entry (FR-RCT-001; ADR 2026-09-18 CDN mount API). A page with no bundler has no React to
 * render `<Meter>` into, so this build bundles React, react-dom and motion and exposes the flow as one
 * call:
 *
 *   import { mount } from "https://cdn.jsdelivr.net/npm/@elapse/react/dist/elapse.browser.js";
 *   mount("#elapse", { publishableKey: "pk_test_…", session: "cs_…" });
 *
 * It renders the cap step, then the meter, and nothing else: an app that already has React installs
 * the package and composes the components itself, so it never ships a second React.
 */
import { useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Authorize } from "./authorize";
import { Meter } from "./meter";
import { ElapseProvider } from "./provider";
import type { PopupHost } from "./popup";
import type { StepEvent } from "./use-authorize";

export interface MountOptions {
  /** `pk_test_…` or `pk_live_…`. A secret key throws (BR-RCT-002). */
  publishableKey: string;
  /** The checkout session your server created, `cs_…`. */
  session: string;
  baseUrl?: string;
  appOrigin?: string;
  sound?: boolean;
  onAuthorised?: (e: StepEvent) => void;
  onStarted?: (e: StepEvent) => void;
  onStopped?: (e: StepEvent) => void;
  /**
   * FR-RCT-021 (amended 2026-09-20): pass these and the meter shows Pause and Resume as requests to
   * you — nothing is signed and nothing reaches Elapse. Your server pauses with `subscriptions.pause`.
   */
  onPauseRequest?: () => void;
  onResumeRequest?: () => void;
  onError?: (e: Error) => void;
  /** @internal Testing seams; merchants never set these. */
  fetch?: typeof fetch;
  /** @internal */
  popupHost?: PopupHost;
}

/** One root per element, so a second `mount` replaces the first rather than stacking. */
const roots = new WeakMap<Element, Root>();

function Flow(o: MountOptions): ReactElement {
  const [running, setRunning] = useState(false);
  const step = (fn: ((e: StepEvent) => void) | undefined) => (e: StepEvent) => {
    setRunning(true);
    fn?.(e);
  };
  return running ? (
    <Meter
      session={o.session}
      {...(o.onStopped ? { onStopped: o.onStopped } : {})}
      {...(o.onPauseRequest ? { onPauseRequest: o.onPauseRequest } : {})}
      {...(o.onResumeRequest ? { onResumeRequest: o.onResumeRequest } : {})}
      {...(o.onError ? { onError: o.onError } : {})}
    />
  ) : (
    <Authorize
      session={o.session}
      onAuthorised={step(o.onAuthorised)}
      onStarted={step(o.onStarted)}
      {...(o.onError ? { onError: o.onError } : {})}
    />
  );
}

/**
 * Render Elapse into `target` (an element or a CSS selector). Returns a function that unmounts it.
 * Throws on a secret key, or when the selector matches nothing.
 */
export function mount(target: Element | string, options: MountOptions): () => void {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) throw new Error(`Elapse could not find ${typeof target === "string" ? target : "that element"} on the page.`);
  if (options.publishableKey.startsWith("sk_")) {
    throw new Error("Never put a secret key in the browser. Pass your publishable key (pk_…) to mount().");
  }
  roots.get(el)?.unmount();
  const root = createRoot(el);
  roots.set(el, root);
  root.render(
    <ElapseProvider
      publishableKey={options.publishableKey}
      {...(options.baseUrl ? { baseUrl: options.baseUrl } : {})}
      {...(options.appOrigin ? { appOrigin: options.appOrigin } : {})}
      {...(options.sound === undefined ? {} : { sound: options.sound })}
      {...(options.fetch ? { fetch: options.fetch } : {})}
      {...(options.popupHost ? { popupHost: options.popupHost } : {})}
    >
      <Flow {...options} />
    </ElapseProvider>,
  );
  return () => unmount(el);
}

/** Remove what `mount` rendered into this element. Unknown elements are left alone. */
export function unmount(target: Element | string): void {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;
  roots.get(el)?.unmount();
  roots.delete(el);
}

export { ElapseProvider, Authorize, Meter };
