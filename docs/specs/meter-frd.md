# Meter primitives — FRD

Status: **Built (retro-documented)** · Surface: shared · Sources: detailed doc §7 step 4, §9; design brief "The hero element is time"; CLAUDE.md "The meter".

## Problem

Every Elapse surface shows the same fact: a rate, a running clock, and a dollar figure that must be exactly right and must never over-state what the subscriber owes.

## Functional requirements

| Id | Requirement | Test |
| --- | --- | --- |
| FR-MTR-001 | Rates arrive as decimal USD-per-second strings and are parsed once into bigint nano-dollars (1e-9 USD). | `parseRate("0.004") === 4_000_000n` |
| FR-MTR-002 | Elapsed time is computed from `started_at` and `now`; it is never negative and freezes at `paused_at`. | `elapsedMs` tests |
| FR-MTR-003 | Live accrual = rate × elapsed at millisecond resolution, floored. | `accruedNano` tests |
| FR-MTR-004 | Settled amount uses whole seconds only, mirroring `AccrualStream.settle`; it is always ≤ live accrual. | `settledNano` property test |
| FR-MTR-005 | Money formats with thousands grouping, floored to 2 decimals (3 for live counters; 3 for sub-cent receipts). | `formatUsd` tests |
| FR-MTR-006 | Elapsed formats as `hh:mm:ss` with hours growing past 99, and can be split into digit groups with tenths. | `formatElapsed` tests |
| FR-MTR-007 | `useMeter` re-renders at 100 ms while running, stops when paused or the tab is hidden. | hook test (pending) |
| FR-MTR-008 | `Readout` renders elapsed and accrued in tabular numerals with no layout shift; the live colour appears only while running. | component test (pending) |
| FR-MTR-009 | `ChartStrip` draws a trace only for running spans, lifts the pen (eased, 220 ms) on stop, keeps history gaps, pauses offscreen, and does not scroll under reduced motion. | visual review (done) |

## Business rules

| Id | Rule |
| --- | --- |
| BR-MTR-001 | No `parseFloat` on money anywhere in the UI. |
| BR-MTR-002 | Nothing pulses or blinks per tick; only digits change. |
| BR-MTR-003 | Per-minute and per-hour figures are derived (×60, ×3600), never stored. |

## Open

- FR-MTR-007/008 tests not yet written (components were built without tests; flagged in CLAUDE.md review).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-03 | Claude (for William) | First draft from the detailed doc and design brief. |
| 2026-09-03 | Claude | Retro-documented from the built landing. |
