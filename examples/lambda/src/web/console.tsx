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
import { meterShown, postRun, readAccess, resolveSub, type RunBody, postClaim } from "./flow";

type Phase = { k: "idle" } | { k: "authorising"; session: string } | { k: "session"; session: string; sub: string };

// FR-EXM-153 (amended 2026-09-21): the session runs until the subscriber ends it. The idle line is
// an instruction rather than a state readout — it is the first thing a subscriber reads, and "not
// running" answers a question they have not asked yet. Every other line names what is costing money.
const IDLE_STATUS = "Press Run — editing is free, the meter opens with your first run";
// FR-EXM-153 (restored 2026-09-26): the run is over and so is its session. Until <Meter> reports the
// cancel landing, the honest word is "settling", not "running".
const SETTLING_STATUS = "Run finished — closing the meter and settling the seconds your code ran";
// FR-EXM-125 (amended 2026-09-23): a run can fail before the meter starts — most often a start
// refused because the escrow has not ingested yet. Saying "Running" there tells the subscriber money
// is moving when none is, so the line says only what is certain: that run did not go through.
const RUN_FAILED_STATUS = "That run didn't go through — press Run to try again";
/**
 * FR-EXM-158: the meter is on chain, so it kept billing while this server was restarting. Saying
 * that plainly is what keeps the number trustworthy when the console rejoins a session.
 */
const READOPTED = "This meter kept running while Northwind restarted — those seconds are on it, and it closes by itself.";
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
  /** FR-EXM-152 (amended 2026-09-26): the last session to end, whose receipt stays on screen. */
  const [ended, setEnded] = useState<string | null>(null);
  const stashed = useRef<string | null>(null);
  /** FR-EXM-158: said once, on the first poll that reports an adopted meter. */
  const readopted = useRef(false);

  useEffect(() => {
    fetch("./runner-source").then((r) => (r.ok ? r.text() : "")).then(setSource).catch(() => {});
  }, []);

  // FR-EXM-116/118: while a session is open the console says "still here", and says "I'm gone"
  // when the tab closes, so the server ends the meter instead of waiting for the sweep.
  const sub = phase.k === "session" ? phase.sub : null;
  const cs = phase.k === "session" ? phase.session : null;
  useEffect(() => {
    if (!sub) return;
    const beat = setInterval(() => {
      if (navigator.sendBeacon) navigator.sendBeacon(`./heartbeat?sub=${sub}`);
      else void fetch(`./heartbeat?sub=${sub}`, { method: "POST" });
      // FR-EXM-111: the server is the authority on whether this session is still open. It can be
      // ended from anywhere — the merchant's dashboard, a `sk_` call — and `<Meter>` does not report
      // that to this page, so `/access` is what tells it.
      void fetch(`./access/${sub}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((a) => {
          const signal = readAccess(a);
          if (signal === "ended") {
            // Settled. Drop the session so the beacon and the heartbeat stop with it; its meter
            // stays on screen with the receipt (FR-EXM-152 amended).
            if (cs) setEnded(cs);
            setPhase({ k: "idle" });
            setStatus(`Session ended — ${merchant} settled the exact seconds your code ran. Press Run to start another.`);
            return;
          }
          // FR-EXM-158: a meter this server adopted at boot was billing while the server was down,
          // so the console says so once rather than letting the figure jump unexplained.
          if (a?.readopted && !readopted.current) {
            readopted.current = true;
            setStatus(READOPTED);
            return;
          }
        })
        .catch(() => {});
    }, 5_000);
    const bye = () => navigator.sendBeacon?.(`./end?sub=${sub}`);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", bye);
    };
  }, [sub, cs, merchant]);

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
        setStatus(on.k === "session" ? RUN_FAILED_STATUS : IDLE_STATUS);
        if (on.k !== "session") setPhase({ k: "idle" });
        return;
      }
      setOut(outcome.body.ok ? { body: outcome.body } : { error: outcome.body.error ?? "run failed" });
      // FR-EXM-153 (restored 2026-09-26): the server ended the session with the run. The <Meter>
      // stays on screen until the cancel lands, so its receipt and end transaction still show.
      setStatus(SETTLING_STATUS);
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

  const onRun = () => void execute(editor.getValue(), phase);
  const shown = meterShown(phase, ended);
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
      </div>

      {/* FR-EXM-152: the instrument card Furqaan signed, positioned by Northwind rather than
          docked by the SDK. The editor is the work surface and leads the page; the meter is the
          readout you must never lose, so it sticks to the bottom of the viewport as you scroll
          through output and source. Same component, same card — only the position is ours. */}
      <div className="gauge">
        {shown && (
          // FR-EXM-152 (amended 2026-09-26): the live session's meter, or the last one's once it has
          // ended — its receipt stays until the next session's meter replaces it. `key` makes that a
          // new meter, not the old one re-pointed.
          // FR-EXM-152 (amended 2026-09-21): the instrument, in the page, where <Authorize> stood —
          // the meter on elapse.finance, in Northwind's colours. It was a capsule in the corner until
          // now; the meter is what this console exists to show, so it gets the room.
          // The `.screen` wrapper is what makes "in Northwind's colours" true: every meter rule in
          // northwind.css is scoped under it, so a meter outside one renders in the package's own
          // near-black default. `<Authorize>` has always sat in one; the meter takes the same slot.
          <div className="screen">
            <Meter
              key={shown}
              session={shown}
              // Northwind's meter is Northwind's to stop (FR-CHK-037), and every run stops its own
              // (FR-EXM-153 restored): nothing here for the subscriber to press.
              controls={false}
              // FR-RCT-045: this console's audience is developers and judges, so the start and the end
              // drop in with their transactions — the one place chain words belong on a subscriber's
              // screen is the one a merchant asked for (BR-RCT-001).
              proof
              onStopped={() => {
                setEnded(shown);
                // Only the live session returns the console to idle. A receipt still on screen must
                // never knock a new authorisation back to idle.
                if (phase.k === "session" && phase.session === shown) {
                  setPhase({ k: "idle" });
                  setStatus(`Session ended — ${merchant} settled the exact seconds your code ran. Press Run to start another.`);
                }
              }}
              onError={(e) => setOut({ error: e.message })}
            />
          </div>
        )}
      </div>
      <p className="note">
        Write JavaScript and Run it on real AWS Lambda — fetch, node builtins via require, anything you like. Each Run opens a
        meter, runs your code, and closes the meter when it returns, so you pay for the seconds your code runs.
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
