/**
 * FR-EXM-152: the Northwind console. The subscriber writes JavaScript, presses Run, authorises
 * once with `<Authorize>` — in this page, Face ID in the Elapse window — and watches `<Meter>` tick
 * while their code runs on real Lambda. Nobody navigates anywhere; nothing here knows a secret key.
 *
 * FR-EXM-125: the first Run is what starts the meter, so the seconds spent editing are free.
 */
import { Authorize, Meter } from "@elapse/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "./editor";
import { postRun, resolveSub, type RunBody } from "./flow";

type Phase = { k: "idle" } | { k: "authorising"; session: string } | { k: "session"; session: string; sub: string };

const IDLE_STATUS = "Not running — your first run opens the session";
const BETWEEN_RUNS = "Paused between runs — you only pay while your code runs";
const isImage = (v: unknown): v is string => typeof v === "string" && v.startsWith("data:image/");

function resultLine(body: RunBody): string {
  const head = isImage(body.result) ? "image" : typeof body.result === "string" ? body.result : JSON.stringify(body.result);
  return `${head}  (${body.ms}ms on Lambda)${body.logs?.length ? `\n${body.logs.join("\n")}` : ""}`;
}

export function Console({ merchant }: { merchant: string }) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [status, setStatus] = useState(IDLE_STATUS);
  const [out, setOut] = useState<{ pending?: boolean; body?: RunBody; error?: string }>({});
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const editor = useEditor();
  const stashed = useRef<string | null>(null);

  useEffect(() => {
    fetch("/runner-source").then((r) => (r.ok ? r.text() : "")).then(setSource).catch(() => {});
  }, []);

  // FR-EXM-116/118: while a session is open the console says "still here", and says "I'm gone"
  // when the tab closes, so the server ends the meter instead of waiting for the sweep.
  const sub = phase.k === "session" ? phase.sub : null;
  useEffect(() => {
    if (!sub) return;
    const beat = setInterval(() => {
      if (navigator.sendBeacon) navigator.sendBeacon(`/heartbeat?sub=${sub}`);
      else void fetch(`/heartbeat?sub=${sub}`, { method: "POST" });
    }, 5_000);
    const bye = () => navigator.sendBeacon?.(`/end?sub=${sub}`);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", bye);
    };
  }, [sub]);

  const execute = useCallback(
    async (code: string, on: Phase) => {
      if (!code.trim()) {
        setOut({ error: "Write some code first." });
        return;
      }
      setBusy(true);
      setOut({ pending: true });
      setStatus(on.k === "session" ? "Running on Lambda…" : "Starting your meter…");
      const outcome = await postRun(fetch, on.k === "session" ? on.sub : null, code);
      setBusy(false);
      if (outcome.k === "needs_auth") {
        // FR-EXM-114: no session yet. Authorise here; the stashed code runs by itself after.
        stashed.current = code;
        setOut({});
        setStatus("Authorise once, then your code runs");
        setPhase({ k: "authorising", session: outcome.session });
        return;
      }
      if (outcome.k === "error") {
        setOut({ error: outcome.message });
        setStatus(on.k === "session" ? "Running — walk away and it closes itself" : IDLE_STATUS);
        if (on.k !== "session") setPhase({ k: "idle" });
        return;
      }
      setOut(outcome.body.ok ? { body: outcome.body } : { error: outcome.body.error ?? "run failed" });
      // FR-EXM-153: by the time the answer is here the meter is already paused again.
      setStatus(BETWEEN_RUNS);
    },
    [],
  );

  /**
   * FR-EXM-125: authorised. The signature event already carries the `sub_` id, so there is nothing
   * to look up; `/session/:cs` is only the fallback for an event without one. Then run the code they
   * already pressed Run on — that run is what starts the meter.
   */
  const authorised = useCallback(
    async (session: string, subscription?: string) => {
      setStatus("Opening your session…");
      const found = subscription ?? (await resolveSub(fetch, session));
      if (!found) {
        setPhase({ k: "idle" });
        setStatus(IDLE_STATUS);
        setOut({ error: "Your session did not open. Nothing was charged — press Run to try again." });
        return;
      }
      const next: Phase = { k: "session", session, sub: found };
      setPhase(next);
      const code = stashed.current ?? editor.getValue();
      stashed.current = null;
      await execute(code, next);
    },
    [editor, execute],
  );

  const onRun = () => void execute(editor.getValue(), phase);
  const body = out.body;

  return (
    <div>
      <div className="label">
        <span className="k">Session</span>
        <span className="meter">
          <small>{status}</small>
        </span>
      </div>

      {phase.k === "authorising" && (
        <div className="screen">
          <Authorize
            session={phase.session}
            onAuthorised={(e) => void authorised(phase.session, e.subscription)}
            onStarted={(e) => void authorised(phase.session, e.subscription)}
            onError={(e) => {
              setPhase({ k: "idle" });
              setStatus(IDLE_STATUS);
              setOut({ error: e.message });
            }}
          />
        </div>
      )}

      {phase.k === "session" && (
        <div className="screen">
          <Meter
            session={phase.session}
            onStopped={() => setStatus(`Session ended — ${merchant} settled the exact seconds. Press Run to open a new one.`)}
            onError={(e) => setOut({ error: e.message })}
          />
        </div>
      )}

      <p className="note">
        Write JavaScript and Run it on real AWS Lambda. fetch, node builtins via require, anything you like — the longer it
        runs, the more seconds you pay for. Between runs the meter is paused, so thinking time is free.
      </p>

      <div className="screen" id="editor" style={{ height: "190px", padding: 0 }} ref={editor.hostRef}>
        {!editor.monaco && <textarea ref={editor.areaRef} spellCheck={false} aria-label="JavaScript to run" />}
      </div>

      <div className="row">
        <button className="key" id="run" type="button" disabled={busy} onClick={onRun}>
          Run
        </button>
      </div>

      <div className="screen">
        {isImage(body?.result) ? (
          <div>
            <img src={body.result} alt="result" style={{ maxWidth: "100%", height: "auto", imageRendering: "pixelated", display: "block" }} />
            <pre id="out" className="has">{resultLine(body)}</pre>
          </div>
        ) : (
          <pre id="out" className={out.error || body ? "has" : ""}>
            {out.pending ? "Running on Lambda…" : (out.error ?? (body ? resultLine(body) : "The result appears here."))}
          </pre>
        )}
      </div>

      <details>
        <summary className="note">What the runner does (read-only)</summary>
        <pre id="source" className="screen">{source || "loading…"}</pre>
      </details>
    </div>
  );
}
