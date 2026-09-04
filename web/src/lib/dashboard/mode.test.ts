/**
 * Test / live mode store.
 *
 * FR-DSH-003: test mode default, switching is immediate and remembered per
 * browser. FR-DSH-004: everything is scoped by the current mode.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMode, setMode, subscribeMode, MODE_STORAGE_KEY } from "./mode";

describe("mode store (FR-DSH-003)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to test mode", () => {
    expect(getMode()).toBe("test");
  });

  it("remembers the mode per browser", () => {
    setMode("live");
    expect(getMode()).toBe("live");
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe("live");
  });

  it("ignores garbage in storage and falls back to test", () => {
    localStorage.setItem(MODE_STORAGE_KEY, "banana");
    expect(getMode()).toBe("test");
  });

  it("notifies subscribers when the mode changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMode(listener);
    setMode("live");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setMode("test");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
