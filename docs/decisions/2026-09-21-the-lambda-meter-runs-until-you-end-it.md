# The Lambda example's meter runs until the subscriber ends it
2026-09-21 · Decided by William · Status: accepted

## Context

`examples/lambda` is the demo a judge will click. Run against the live testnet stack it billed like this:

```
16:26:31  ▶ run sub_…  → "Hello, world!"  (0ms)   [1/20 today]
16:27:32  evt_…  subscription.canceled  → session closed · 62s · $0.12
```

On 2026-09-19 that line was read as "Elapse charged me for nothing", and two decisions followed the same day. [The keeper may pause](./2026-09-19-keeper-may-pause.md) gave the relayer `pause()`/`resume()` so the meter could run only while code runs. Hours later FR-EXM-153 was amended again, to **end** the session with each run rather than pause it — the option that ADR had explicitly weighed and rejected, because "the next run needs a new permit — a Face ID per invocation".

Running the result found what that cost. There is no Stop, no Pause, no Resume and no End anywhere in the demo, because a session that lives for one invocation has nothing to stop. Elapse's own hook — *"Cancel at 83 seconds. Pay 83 seconds."* — cannot be demonstrated in the application built to demonstrate it. Every Run also asks for a fresh authorisation.

Re-reading the 62-second line with that in hand: the session **was** open for 62 seconds and the subscriber paid for 62 seconds, which is exactly "you only pay what elapsed". What was wrong was not the arithmetic but the authorship. The idle timeout ended the session; the subscriber never held the off switch, so 62 seconds they did not choose felt like 62 seconds they were charged for. The answer is to give them the switch, not to shorten the session until the switch is unnecessary.

A second scenario was weighed and rejected for this example. A meter can equally represent an *entitlement* — a SaaS seat, where closing a tab means nothing and billing continues until the customer cancels. The platform supports that today; `active → paused | canceled` is exactly that shape. Northwind is not that. It sells compute by the second, so leaving genuinely is "I am done", and a meter that kept billing an absent subscriber would be a meter nobody trusts.

## Decision

The Lambda console's session runs on wall-clock time from the first Run until it is ended, and the subscriber ends it with an **End session** control in Northwind's own chrome. `<Meter>` gains Pause and Resume as requests to Northwind (FR-RCT-021/046, signed 2026-09-21) against a product created with `allow_pause`. A session that is idle for 60 seconds while its tab is still present is **paused**, not ended, and is ended only after ten further minutes; the tab-close beacon, the stale-heartbeat sweep and the escrow cap are untouched. The console states that ending on leaving is Northwind's policy rather than Elapse's behaviour. This supersedes the 2026-09-19 FR-EXM-153/154 amendments and restores the session model those amendments replaced.

## Consequences

- **The hook becomes demonstrable.** A judge can watch the meter tick, press End at 83 seconds and be charged 83 seconds. No other lifecycle in this example can show that.
- **One authorisation per session, not per invocation.** The Face ID tax the 2026-09-19 ADR warned about is paid back.
- **Idle time is billed again**, which is what the 2026-09-19 reversal was trying to avoid. The auto-pause is what makes that acceptable: the exposure is bounded at 60 seconds, the subscriber can resume rather than re-authorise, and paused seconds are never billed (BR-CON-003).
- **Gas.** An auto-pause is a relayer transaction nobody asked for, so a forgotten tab costs the platform gas even though it costs the subscriber nothing. The relayer runway sample (FR-WRK-074) should be re-read once this has run for a while.
- **`controls={false}` comes off the console's `<Meter>`.** This does not hand the subscriber a Stop: `canStop` requires `subscriber_can_stop`, false for a started merchant-mode subscription (FR-API-139), so Pause and Resume render and Stop does not. FR-CHK-037 holds without special-casing.
- **Copy on both pages changes**, and one committed test asserts the old wording. `console-copy.test.ts` currently requires that the landing does *not* say "the seconds your session is open"; under this decision that is what it should say. The test is rewritten to assert the new claim, not deleted.
- **The SaaS reading is closed off explicitly.** Without a line saying whose choice the auto-end is, a judge watching a closed tab cancel a subscription may conclude Elapse cannot bill an entitlement. It can; Northwind simply does not ask it to.
- Supersedes the FR-EXM-153/154 amendments of 2026-09-19. It leaves [the keeper may pause](./2026-09-19-keeper-may-pause.md) standing and finally uses the power that ADR granted.
