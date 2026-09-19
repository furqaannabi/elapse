/**
 * FR-EXM-032: the product page's Elapse island. The server renders a mount point carrying the
 * session id and the publishable key; this bundle (npm run build:web) renders `<Authorize>` and then
 * `<Meter>` in place, so the subscriber never leaves Acme's page. Face ID happens in a frame Elapse
 * opens over this page, or a window when the frame cannot do it (FR-RCT-043).
 *
 * The meter docks bottom-right as a capsule (FR-RCT-042) so the rack page keeps its own layout,
 * keeps its Stop — this is a checkout-mode product, the subscriber's meter to stop — and shows the
 * start and end transactions (FR-RCT-045), since the people cloning this example are developers.
 */
import { Authorize, ElapseProvider, Meter } from "@elapse/react";
import "@elapse/react/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";

// region:react-components
function Checkout({ session }: { session: string }) {
  const [started, setStarted] = useState(false);
  return started ? (
    <Meter
      session={session}
      dock="bottom-right"
      proof
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
