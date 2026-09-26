/**
 * FR-EXM-032: the product page's Elapse island. The server renders a mount point carrying the
 * session id and the publishable key; this bundle (npm run build:web) renders `<Authorize>` and then
 * `<Meter>` in place, so the subscriber never leaves Acme's page. Face ID happens in a frame Elapse
 * opens over this page, or a window when the frame cannot do it (FR-RCT-043).
 *
 * The meter renders as the instrument in the page (FR-EXM-032 amended 2026-09-21): the layout the
 * meter on elapse.finance wears, painted in Acme's own colours by `acme.css`. It keeps its Stop —
 * this is a checkout-mode product, the subscriber's meter to stop — and shows the start and end
 * transactions (FR-RCT-045), since the people cloning this example are developers.
 *
 * Pause is not the subscriber's to take ([ADR 2026-09-20]), so `onPauseRequest` asks Acme instead.
 * All Acme's page does is make the request and let it settle: `<Meter>` says who was asked and what
 * they answered (React FR-RCT-046). That is the whole integration — no state, no status UI.
 */
import { Authorize, ElapseProvider, Meter } from "@elapse/react";
import "@elapse/react/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";

// region:react-components
/** Ask your own server, which holds the secret key. A refusal throws; that is how `<Meter>` knows. */
const askAcme = (what: "pause" | "resume", session: string) => async () => {
  const res = await fetch(`./${what}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session }),
  });
  if (res.status !== 202) throw new Error(`Acme answered ${res.status}`);
};

function Checkout({ session }: { session: string }) {
  const [started, setStarted] = useState(false);
  return started ? (
    <Meter
      session={session}
      proof
      onPauseRequest={askAcme("pause", session)}
      onResumeRequest={askAcme("resume", session)}
      onStopped={(e) => console.log("meter stopped", e.txHash)}
    />
  ) : (
    <Authorize
      session={session}
      onStarted={() => setStarted(true)}
      onAuthorised={() => setStarted(true)}
      onError={(e) => console.error(e.message)}
    />
  );
}

// endregion

// region:react-provider
const el = document.getElementById("elapse");
if (el) {
  const { session, publishableKey, apiUrl, appUrl } = el.dataset as Record<string, string>;
  createRoot(el).render(
    <ElapseProvider publishableKey={publishableKey!} baseUrl={apiUrl!} appOrigin={appUrl!}>
      <Checkout session={session!} />
    </ElapseProvider>,
  );
}
// endregion
