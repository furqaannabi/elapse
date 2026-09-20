/**
 * FR-EXM-152: the console's entry point, bundled by `npm run build:web`. The server renders the
 * mount node with the publishable key and the Elapse origins; everything else is React.
 */
import { ElapseProvider } from "@elapse/react";
import "@elapse/react/styles.css";
import { createRoot } from "react-dom/client";
import { Console } from "./console";

const el = document.getElementById("root");
if (el) {
  const { publishableKey, apiUrl, appUrl, merchant, maxDuration } = el.dataset as Record<string, string>;
  createRoot(el).render(
    <ElapseProvider publishableKey={publishableKey!} baseUrl={apiUrl!} appOrigin={appUrl!}>
      <Console merchant={merchant ?? "The merchant"} cap={Number(maxDuration ?? 3600)} />
    </ElapseProvider>,
  );
}
