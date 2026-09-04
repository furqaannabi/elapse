/**
 * `usePoll` — re-fetches every 10 s while the tab is visible, keeps the
 * last good data on failure, resumes on focus. FR-DSH-007, FR-DSH-113.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePoll } from "./use-poll";

describe("usePoll (FR-DSH-007)", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("loads once, then again every interval", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const { result } = renderHook(() => usePoll(fetcher, { intervalMs: 10_000 }));
    await waitFor(() => expect(result.current.data).toBe(1));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good data and flags the error when a poll fails", async () => {
    let fail = false;
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return "ok";
    });
    const { result } = renderHook(() => usePoll(fetcher, { intervalMs: 10_000 }));
    await waitFor(() => expect(result.current.data).toBe("ok"));
    fail = true;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.data).toBe("ok");
  });

  it("does not poll while the document is hidden", async () => {
    const fetcher = vi.fn(async () => "x");
    renderHook(() => usePoll(fetcher, { intervalMs: 10_000 }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("restarts and hides old data when the fetcher changes (BR-DSH-002)", async () => {
    const a = vi.fn(async () => "test-data");
    const b = vi.fn(async () => "live-data");
    const { result, rerender } = renderHook(({ f }) => usePoll(f, { intervalMs: 10_000 }), { initialProps: { f: a } });
    await waitFor(() => expect(result.current.data).toBe("test-data"));
    rerender({ f: b });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe("live-data"));
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("reloads on demand", async () => {
    const fetcher = vi.fn(async () => "x");
    const { result } = renderHook(() => usePoll(fetcher, { intervalMs: 10_000 }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.reload();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
