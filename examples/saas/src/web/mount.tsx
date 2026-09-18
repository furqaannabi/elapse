/**
 * FR-EXM-032: the product page's Elapse island. The server renders a mount point carrying the
 * session id and the publishable key; this bundle (npm run build:web) renders `<Authorize>` and then
 * `<Meter>` in place, so the subscriber never leaves Acme's page. Face ID happens in the Elapse
 * window the SDK opens.
 */
import { Authorize, ElapseProvider, Meter } from "@elapse/react";
import "@elapse/react/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";

function Checkout({ session }: { session: string }) {
  const [started, setStarted] = useState(false);
  return started ? (
    <Meter session={session} onStopped={(e) => console.log("meter stopped", e.txHash)} />
  ) : (
    <Authorize
      session={session}
      onStarted={() => setStarted(true)}
      onAuthorised={() => setStarted(true)}
      onError={(e) => console.error(e.message)}
    />
  );
}

const el = document.getElementById("elapse");
if (el) {
  const { session, publishableKey, apiUrl, appUrl } = el.dataset as Record<string, string>;
  createRoot(el).render(
    <ElapseProvider publishableKey={publishableKey!} baseUrl={apiUrl!} appOrigin={appUrl!}>
      <Checkout session={session!} />
    </ElapseProvider>,
  );
}
