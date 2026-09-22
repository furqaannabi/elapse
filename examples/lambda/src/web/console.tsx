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
import { postRun, readAccess, resolveSub, type RunBody, postClaim } from "./flow";

type Phase = { k: "idle" } | { k: "authorising"; session: string } | { k: "session"; session: string; sub: string };

// FR-EXM-153 (amended 2026-09-21): the session runs until the subscriber ends it. The idle line is
// an instruction rather than a state readout — it is the first thing a subscriber reads, and "not
// running" answers a question they have not asked yet. Every other line names what is costing money.
const IDLE_STATUS = "Press Run — editing is free, the meter opens with your first run";
const RUNNING_STATUS = "Running — end the session when you are done";
// FR-EXM-154/155: a pause the subscriber did not ask for has to say so. <Meter> narrates the ones
// they did ask for (FR-RCT-046); this is the only voice the automatic one has.
const AUTO_PAUSED = "Paused — nothing has run for a minute. Press Run or Resume to carry on.";
/**
 * FR-EXM-158: the meter is on chain, so it kept billing while this server was restarting. Saying
 * that plainly is what keeps the number trustworthy when the console rejoins a session.
 */
const READOPTED = "This meter kept running while Northwind restarted — those seconds are on it. Press End session when you're done.";
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
  const [ending, setEnding] = useState(false);
  // Whether the last pause or resume was one the subscriber asked for. <Meter> narrates those
  // itself; only the sweep's automatic pause needs this page to explain it.
  const asked = useRef(false);
  /** FR-EXM-158: said once, on the first poll that reports an adopted meter. */
  const readopted = useRef(false);

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
      // FR-EXM-111/154: the server is the authority on whether this session is still open. It can
      // be paused by the sweep or ended from anywhere — the merchant's dashboard, a `sk_` call —
      // and `<Meter>` reports neither of those to this page, so `/access` is what tells it.
      void fetch(`/access/${sub}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((a) => {
          const signal = readAccess(a);
          if (signal === "ended") {
            // Settled elsewhere. Drop the session so the beacon, the heartbeat and the End control
            // all stop with it, rather than offering to end something already closed.
            setPhase({ k: "idle" });
            setStatus(`Session ended — ${merchant} settled the exact seconds you were open. Press Run to start another.`);
            setEnding(false);
            return;
          }
          // FR-EXM-158: a meter this server adopted at boot was billing while the server was down,
          // so the console says so once rather than letting the figure jump unexplained.
          if (a?.readopted && !readopted.current) {
            readopted.current = true;
            setStatus(READOPTED);
            return;
          }
          if (asked.current) return;
          if (signal === "paused") setStatus(AUTO_PAUSED);
          if (signal === "running") setStatus((was) => (was === AUTO_PAUSED ? RUNNING_STATUS : was));
        })
        .catch(() => {});
    }, 5_000);
    const bye = () => navigator.sendBeacon?.(`/end?sub=${sub}`);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", bye);
    };
  }, [sub, merchant]);

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
        setStatus(on.k === "session" ? RUNNING_STATUS : IDLE_STATUS);
        if (on.k !== "session") setPhase({ k: "idle" });
        return;
      }
      setOut(outcome.body.ok ? { body: outcome.body } : { error: outcome.body.error ?? "run failed" });
      // FR-EXM-153 (amended 2026-09-21): the run is over, the session is not. It keeps costing
      // money until they pause or end it, so the line says that rather than congratulating them.
      setStatus(RUNNING_STATUS);
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
      // FR-EXM-157: hand Northwind the id rather than waiting for `subscription.created`, which a
      // disconnected `elapse listen` never delivers at all. A refusal ends here: the one thing the
      // console must never do with "I could not confirm that session" is offer to authorise
      // another one.
      const claim = await postClaim(fetch, found);
      if (claim.k !== "ready") {
        setPhase({ k: "idle" });
        setStatus(IDLE_STATUS);
        setOut({ error: claim.k === "refused" ? claim.message : "That session is spent. Press Run to open a new one." });
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

  /**
   * FR-EXM-156: the subscriber asks Northwind; Northwind is the one that calls Elapse. Nothing here
   * is signed and nothing here reaches the platform — the ask travels over Northwind's own wire
   * (FR-RCT-021). Throwing is how `<Meter>` learns to say the merchant could not do it.
   */
  const ask = (what: "pause" | "resume") => async () => {
    if (phase.k !== "session") return;
    asked.current = true;
    const res = await fetch(`/${what}?sub=${phase.sub}`, { method: "POST" });
    if (!res.ok) {
      asked.current = false;
      throw new Error(`${merchant} could not ${what} that meter.`);
    }
  };

  // FR-EXM-155: the gesture this product exists to show. Northwind's control, in Northwind's
  // chrome — `<Meter>` offers the subscriber no Stop for a merchant-started meter (FR-CHK-037).
  const endSession = async () => {
    if (phase.k !== "session" || ending) return;
    setEnding(true);
    setStatus("Ending your session…");
    try {
      // FR-EXM-155: say who ended it. The beacon posts to the same route when the tab goes.
      await fetch(`/end?sub=${phase.sub}&by=subscriber`, { method: "POST" });
    } catch (e) {
      setEnding(false);
      setOut({ error: (e as Error).message });
    }
  };

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

      <div className="screen" id="editor" ref={editor.hostRef}>
        {!editor.monaco && <textarea ref={editor.areaRef} spellCheck={false} aria-label="JavaScript to run" />}
      </div>

      <div className="row">
        <button className="key" id="run" type="button" disabled={busy} onClick={onRun}>
          Run
        </button>
        {phase.k === "session" && (
          // Engraved on the casing rather than moulded as a second amber key: one is the control you
          // press all day, the other is the one that stops the money. They must not look alike.
          <button className="switch" id="end" type="button" disabled={ending} onClick={() => void endSession()}>
            {ending ? "Ending…" : "End session"}
          </button>
        )}
      </div>

      {/* FR-EXM-152: the instrument card Furqaan signed, positioned by Northwind rather than
          docked by the SDK. The editor is the work surface and leads the page; the meter is the
          readout you must never lose, so it sticks to the bottom of the viewport as you scroll
          through output and source. Same component, same card — only the position is ours. */}
      <div className="gauge">
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
              // FR-EXM-152 (amended 2026-09-21): controls are on. This does not hand over a Stop —
              // `canStop` needs `subscriber_can_stop`, false for a started merchant-mode meter
              // (FR-API-139) — so Pause and Resume render and Stop does not, and FR-CHK-037 holds
              // without a special case. Stopping stays Northwind's, on the End session control above.
              controls
              onPauseRequest={ask("pause")}
              onResumeRequest={ask("resume")}
              // FR-RCT-045: this console's audience is developers and judges, so the start and the end
              // drop in with their transactions — the one place chain words belong on a subscriber's
              // screen is the one a merchant asked for (BR-RCT-001).
              proof
              onStopped={() => {
                setEnding(false);
                setPhase({ k: "idle" });
                setStatus(`Session ended — ${merchant} settled the exact seconds you were open. Press Run to start another.`);
              }}
              onError={(e) => setOut({ error: e.message })}
            />
          </div>
        )}
      </div>
      <p className="note">
        Write JavaScript and Run it on real AWS Lambda — fetch, node builtins via require, anything you like. Your session
        stays open between runs and you pay for every second it does, so pause it while you think and end it when you are done.
      </p>

      {/* FR-EXM-155: whose choice this is. Without it, a judge who watches a closed tab cancel a
          subscription concludes Elapse cannot bill anything that outlives a tab. It can; Northwind
          sells compute, so it chooses not to ask. */}
      <p className="fine">
        {merchant} ends your meter when you close this tab, because you are paying for compute. A subscription meant to
        outlive the tab simply never calls cancel.
      </p>

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
