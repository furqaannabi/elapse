/**
 * FR-RCT-023/045: the proof drop. Opt in, because a transaction hash on a subscriber's screen is
 * what BR-RCT-001 exists to prevent — a merchant asks for it, and then only the two moments that
 * matter: the meter starting and the meter ending.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElapseProvider, Meter, TxLink } from "../src";

const NOW = 1_757_000_000_000;
const HASH = "0x4cbee5356bc3ee14abfd5b02598639e5fc19ee20c7d61cfdb5943536c3759143";

type Sub = Record<string, unknown>;
const sub = (over: Sub = {}): Sub => ({
  id: "sub_1", object: "subscription", status: "active", product: "prod_1", customer: "cus_1", checkout_session: "cs_1",
  rate_usd_per_second: "0.004", started_at: (NOW - 3_000) / 1000, paused_at: null, canceled_at: null, ended_reason: null,
  max_duration_seconds: 3600, max_escrow_usd: "14.4", funded_usd: "14.4", settled_usd: "0", seconds_elapsed: 0,
  stream_address: "0x1", chain_id: 10143, currency: "ausd", livemode: false, created: NOW / 1000 - 90,
  start_mode: "merchant", start_by: null, subscriber_can_stop: false, start_tx: HASH, end_tx: null, ...over,
});
const wire = (subscription: Sub | null) => ({
  id: "cs_1", object: "checkout.session", status: "complete", expires_at: NOW / 1000 + 86_400,
  merchant: { name: "Northwind", logo_url: null, accent: null, support_url: null, success_url: "https://shop.test/ok", cancel_url: "https://shop.test/no" },
  product: { id: "prod_1", name: "Serverless runtime", rate_usd_per_second: "0.002", allow_pause: false, active: true, start_mode: "merchant" },
  customer: { id: "cus_1", email: null }, subscription, max_duration_seconds: 3600, max_escrow_usd: "14.4", last_max_duration_seconds: null, restarted_as: null,
});

let server: ReturnType<typeof wire>;
function mount(initial: ReturnType<typeof wire>, props: Record<string, unknown> = {}) {
  server = initial;
  const fetchFn = vi.fn(async () => new Response(JSON.stringify(server), { status: 200 }));
  render(
    <ElapseProvider publishableKey="pk_test_1" baseUrl="https://api.test" fetch={fetchFn as unknown as typeof fetch} sound={false}>
      <Meter session="cs_1" {...props} />
    </ElapseProvider>,
  );
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const proof = () => document.querySelector(".elapse-proof");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("FR-RCT-023 <TxLink>", () => {
  it("shows the ends of the hash and links to the chain's explorer, safely", () => {
    render(<TxLink hash={HASH} chainId={10143} />);
    const link = screen.getByRole("link");
    expect(link.textContent).toBe("0x4cbe…9143");
    expect(link.getAttribute("href")).toBe(`https://testnet.monadscan.com/tx/${HASH}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("FR-RCT-045 the proof drop", () => {
  it("says nothing without the prop, because a subscriber should not see a hash by default", async () => {
    mount(wire(sub()));
    await settle();
    expect(proof()).toBeNull();
    expect(screen.queryByText(/0x4cbe/)).toBeNull();
  });

  it("drops when the meter starts, carrying that step's transaction", async () => {
    mount(wire(sub()), { proof: true });
    await settle();
    expect(proof()).toBeTruthy();
    expect(screen.getByText("Meter started")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toContain(HASH);
    expect(proof()!.getAttribute("aria-live")).toBe("polite");
  });

  it("lifts away on its own, leaving the meter to say what is true", async () => {
    mount(wire(sub()), { proof: true });
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_500); });
    expect(proof()).toBeNull();
  });

  it("keeps the start beside the stop when the meter ends, so both transactions are there", async () => {
    const ended = "0x" + "ab".repeat(32);
    mount(wire(sub()), { proof: true });
    await settle();
    server = wire(sub({ status: "canceled", canceled_at: NOW / 1000, ended_reason: "canceled", seconds_elapsed: 3, settled_usd: "0.012", end_tx: ended }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });

    // Amended 2026-09-20: a session can start and end between two reads, so the end never hides the start.
    expect(document.querySelectorAll(".elapse-proof")).toHaveLength(2);
    expect(screen.getByText("Meter started")).toBeTruthy();
    expect(screen.getByText("Meter stopped")).toBeTruthy();
    const hrefs = [...document.querySelectorAll(".elapse-proof a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes(HASH))).toBe(true);
    expect(hrefs.some((h) => h.includes(ended))).toBe(true);
  });

  it("stays quiet through a pause and a resume, which happen around every run", async () => {
    mount(wire(sub()), { proof: true });
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_500); });
    server = wire(sub({ status: "paused", paused_at: NOW / 1000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(proof()).toBeNull();
  });
});

describe("FR-RCT-045 amended: a run too short to watch still proves both ends", () => {
  const END = "0xfeeb1f2c3d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";

  it("shows the start and the end together once the meter has ended", async () => {
    mount(
      wire(sub({ status: "canceled", canceled_at: NOW / 1000, ended_reason: "canceled", settled_usd: "0.006", seconds_elapsed: 3, start_tx: HASH, end_tx: END })),
      { proof: true },
    );
    await settle();

    const drops = document.querySelectorAll(".elapse-proof");
    expect(drops).toHaveLength(2);
    expect(drops[0]!.textContent).toContain("Meter started");
    expect(drops[1]!.textContent).toContain("Meter stopped");

    const links = document.querySelectorAll(".elapse-proof a");
    expect(links[0]!.getAttribute("href")).toContain(HASH);
    expect(links[1]!.getAttribute("href")).toContain(END);
  });

  it("shows only the start while the meter is still running", async () => {
    mount(wire(sub({ start_tx: HASH, end_tx: null })), { proof: true });
    await settle();
    const drops = document.querySelectorAll(".elapse-proof");
    expect(drops).toHaveLength(1);
    expect(drops[0]!.textContent).toContain("Meter started");
  });
});
