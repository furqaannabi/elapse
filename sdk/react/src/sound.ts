/**
 * The meter's cues (FR-RCT-050): four short sounds, synthesised here rather than shipped as files,
 * so the package stays small and nothing has to load before a subscriber can hear that their meter
 * started.
 *
 * The rules that shape this: one cue per transition and never one per second — a meter that beeps
 * while it runs would be unbearable and is forbidden (BR-CHK-002 in sound); the audio context is
 * built on the first cue, which always follows a tap, because browsers refuse one before that; the
 * subscriber can mute and that choice is remembered; and every failure here is silent, because a
 * blocked speaker must never break a payment.
 *
 * The shape is two notes: rising when something begins, falling when it ends — the same grammar a
 * phone's payment sheet uses, at a volume that will not startle anyone.
 */

export type Cue = "authorised" | "started" | "stopped" | "capReached";

/** Where the subscriber's mute lives. Per browser, per origin; never sent anywhere. */
export const SOUND_KEY = "elapse:sound";

/** Two notes each, in hertz, and how long the pair lasts. */
const CUES: Record<Cue, { notes: [number, number]; ms: number }> = {
  authorised: { notes: [659.25, 987.77], ms: 180 }, // E5 → B5, the "you're in" pair
  started: { notes: [523.25, 783.99], ms: 180 }, // C5 → G5
  stopped: { notes: [783.99, 523.25], ms: 200 }, // G5 → C5, the same pair backwards
  capReached: { notes: [880, 587.33], ms: 260 }, // A5 → D5, longer, so it reads as an ending
};

const PEAK = 0.06; // quiet enough for a phone held near a face

export interface Cues {
  play(cue: Cue): void;
  muted(): boolean;
  setMuted(muted: boolean): void;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "off";
  } catch {
    return false; // private mode, blocked storage: sound on, nothing remembered
  }
}

export function createCues(o: { enabled: boolean; context?: () => AudioContext }): Cues {
  let muted = readMuted();
  let ctx: AudioContext | null = null;

  const open = (): AudioContext | null => {
    if (ctx) return ctx;
    try {
      const make = o.context ?? (() => new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());
      ctx = make();
      return ctx;
    } catch {
      return null; // no Web Audio here; the meter is just as correct in silence
    }
  };

  return {
    muted: () => muted,
    setMuted(next: boolean) {
      muted = next;
      try {
        localStorage.setItem(SOUND_KEY, next ? "off" : "on");
      } catch {
        // nothing to remember it with; the choice still holds for this page
      }
    },
    play(cue: Cue) {
      if (!o.enabled || muted) return;
      try {
        const audio = open();
        if (!audio) return;
        void audio.resume?.();
        const { notes, ms } = CUES[cue];
        const now = audio.currentTime;
        const seconds = ms / 1000;
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(PEAK, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
        gain.connect(audio.destination);

        const osc = audio.createOscillator();
        osc.type = "triangle"; // soft edges; a sine is too thin to hear on a laptop speaker
        osc.frequency.setValueAtTime(notes[0], now);
        osc.frequency.setValueAtTime(notes[1], now + seconds / 2);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + seconds);
      } catch {
        // a cue is never worth an exception
      }
    },
  };
}
