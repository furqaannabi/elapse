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

// FR-EXM-153: the session ends with the run — it does not pause between runs, so neither status
// may say it does. The idle line is an instruction rather than a state readout: it is the first
// thing a subscriber reads, and "not running" answers a question they have not asked yet.
const IDLE_STATUS = "Press Run — editing is free, the meter opens with your first run";
const BETWEEN_RUNS = "Session ended and settled. Press Run to open a new one.";
const isImage = (v: unknown): v is string => typeof v === "string" && v.startsWith("data:image/");

function resultLine(body: RunBody): string {
  const head = isImage(body.result) ? "image" : typeof body.result === "string" ? body.result : JSON.stringify(body.result);
  return `${head}  (${body.ms}ms on Lambda)${body.logs?.length ? `\n${body.logs.join("\n")}` : ""}`;
}

export function Console({ merchant, cap }: { merchant: string; cap: number }) {
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
      // FR-EXM-153 (amended): by the time the answer is here the session has already ended.
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
            // FR-RCT-010 amended: Northwind chooses the cap, so Run opens the Elapse window at once.
            cap={cap}
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
        // FR-EXM-152 (amended 2026-09-21): the instrument, in the page, where <Authorize> stood —
        // the meter on elapse.finance, in Northwind's colours. It was a capsule in the corner until
        // now; the meter is what this console exists to show, so it gets the room.
        // The `.screen` wrapper is what makes "in Northwind's colours" true: every meter rule in
        // northwind.css is scoped under it, so a meter outside one renders in the package's own
        // near-black default. `<Authorize>` has always sat in one; the meter takes the same slot.
        <div className="screen">
          <Meter
            session={phase.session}
            // Northwind's meter is Northwind's to stop (FR-CHK-037): the subscriber gets no Stop,
            // not even in the held second before the first run starts it.
            controls={false}
            // FR-RCT-045: this console's audience is developers and judges, so the start and the end
            // drop in with their transactions — the one place chain words belong on a subscriber's
            // screen is the one a merchant asked for (BR-RCT-001).
            proof
            onStopped={() => setStatus(`Session ended — ${merchant} settled the exact seconds. Press Run to open a new one.`)}
            onError={(e) => setOut({ error: e.message })}
          />
        </div>
      )}

      <p className="note">
        Write JavaScript and Run it on real AWS Lambda. fetch, node builtins via require, anything you like — the longer it
        runs, the more seconds you pay for. The session ends with the run, so thinking time is free — the next Run opens a new one.
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
        {/* The `.screen` is the wrapper, not the `<pre>`: northwind.css writes the wrapping rules
            as `.screen pre`, so a self-screened `<pre>` takes the box and lets long source lines
            run outside it. Same nesting as every other readout on this page. */}
        <div className="screen">
          <pre id="source">{source || "loading…"}</pre>
        </div>
      </details>
    </div>
  );
}
