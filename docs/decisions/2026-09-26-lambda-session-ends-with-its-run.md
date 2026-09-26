# The Lambda session ends with its run
2026-09-26 · Decided by Furqaan · Status: accepted (supersedes [2026-09-21 the Lambda meter runs until you end it](./2026-09-21-the-lambda-meter-runs-until-you-end-it.md))

## Context
On 2026-09-20 Furqaan signed FR-EXM-153 amended: one session per execution — a Run starts the meter, invokes, and cancels, so the subscriber pays for the seconds their code ran plus the confirmations either side. On 2026-09-21 William's ADR replaced that with a session that stays open across runs: an **End session** control, Pause and Resume as requests to Northwind, a 60-second idle pause and an end after ten further idle minutes. That removed the cost of a Face ID and a fresh escrow deposit on every Run.

Running the live example at examples.elapse.finance on 2026-09-26, Furqaan saw a finished run leave its session open and then paused a minute later, and judged that the product should not behave that way: a run that has finished should have finished billing.

## Decision
A Northwind session ends with its run. A Run authorises if it needs to, starts the meter, invokes, and ends the session through `subscriptions.cancel` whether the code returned or threw; the receipt follows `subscription.canceled`, and the next Run opens a new Checkout session. There is no End session control, and Northwind neither pauses nor resumes — its pause routes, the console's pause requests and the idle pause are withdrawn. The claim and boot reconcile (FR-EXM-157/158), the thirty-second default snippet, the daily limit and the unstarted sweep are unchanged.

## Consequences
The billing story is the simplest one available: you paid for the seconds your code ran, and a finished run has settled. The cost is the friction the 2026-09-21 record removed — every Run needs Face ID and a new escrow deposit, and each pays for its start and cancel confirmations, roughly one to three seconds beyond the code itself. This reverses a decision William signed four days earlier; he should hear it before the change ships. Pause remains demonstrable where it belongs, on examples/saas, where the meter is a resource held over time.

Specs: [examples-lambda-frd](../specs/examples-lambda-frd.md) FR-EXM-153 restored, FR-EXM-155/156 withdrawn — **awaiting signature**; this record precedes them.
