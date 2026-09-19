/**
 * FR-RCT-050: short cues, synthesised in code, one per transition and never per second. The audio
 * context is built on the first cue — which always follows a tap — and every failure is silent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCues, SOUND_KEY } from "../src/sound";

function fakeAudio() {
  const started: Array<{ from: number; to: number; at: number }> = [];
  const ctx = {
    currentTime: 0,
    state: "running",
    destination: {},
    resume: vi.fn(async () => {}),
    createGain: () => ({
      gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }),
    createOscillator: () => {
      const node = {
        type: "sine",
        frequency: { value: 0, setValueAtTime: vi.fn((v: number, at: number) => { node.freqs.push({ v, at }); }) },
        freqs: [] as Array<{ v: number; at: number }>,
        connect: vi.fn(),
        start: vi.fn((at: number) => { node.startedAt = at; }),
        stop: vi.fn((at: number) => { started.push({ from: node.freqs[0]?.v ?? 0, to: node.freqs.at(-1)?.v ?? 0, at }); }),
        startedAt: 0,
      };
      return node;
    },
  };
  const factory = vi.fn(() => ctx as unknown as AudioContext);
  return { ctx, factory, started };
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* private mode */ }
});

describe("FR-RCT-050 cues", () => {
  it("makes no audio context until the first cue plays", () => {
    const { factory } = fakeAudio();
    const cues = createCues({ enabled: true, context: factory });
    expect(factory).not.toHaveBeenCalled();
    cues.play("started");
    expect(factory).toHaveBeenCalledTimes(1);
    cues.play("stopped");
    expect(factory).toHaveBeenCalledTimes(1); // reused, not rebuilt
  });

  it("plays a rising pair to start and a falling pair to stop", () => {
    const { factory, started } = fakeAudio();
    const cues = createCues({ enabled: true, context: factory });
    cues.play("started");
    expect(started.length).toBeGreaterThanOrEqual(1);
    const rise = started.at(-1)!;
    expect(rise.to).toBeGreaterThan(rise.from);
    started.length = 0;
    cues.play("stopped");
    const fall = started.at(-1)!;
    expect(fall.to).toBeLessThan(fall.from);
  });

  it("is silent when the merchant turned sound off", () => {
    const { factory } = fakeAudio();
    createCues({ enabled: false, context: factory }).play("started");
    expect(factory).not.toHaveBeenCalled();
  });

  it("is silent when the subscriber muted it, and remembers that", () => {
    const { factory } = fakeAudio();
    const cues = createCues({ enabled: true, context: factory });
    cues.setMuted(true);
    cues.play("started");
    expect(factory).not.toHaveBeenCalled();
    expect(localStorage.getItem(SOUND_KEY)).toBe("off");
    // A later page load reads that back.
    expect(createCues({ enabled: true, context: factory }).muted()).toBe(true);
  });

  it("never throws: not when audio fails, not when storage is blocked", () => {
    const boom = vi.fn(() => { throw new Error("no audio"); });
    expect(() => createCues({ enabled: true, context: boom }).play("started")).not.toThrow();
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => createCues({ enabled: true, context: fakeAudio().factory }).setMuted(true)).not.toThrow();
    storage.mockRestore();
  });
});
