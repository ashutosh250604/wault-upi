/**
 * Tactile + audio feedback — the layer that makes taps feel native.
 *
 * Everything degrades to a silent no-op: iOS Safari has no vibrate API, and
 * audio needs a user gesture before the browser will let us play anything, so
 * `unlock()` is called from the first pointer/key event.
 */

const PREF_KEY = "walletpay.feedback";

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

let enabled = readEnabled();
let audio: AudioContext | null = null;

export function isFeedbackEnabled(): boolean {
  return enabled;
}

export function setFeedbackEnabled(next: boolean): void {
  enabled = next;
  try {
    window.localStorage.setItem(PREF_KEY, next ? "1" : "0");
  } catch {
    // Preference is best-effort; the session keeps working either way.
  }
  if (next) audio = audio ?? createAudio();
}

function createAudio(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

function context(): AudioContext | null {
  if (!enabled) return null;
  try {
    audio = audio ?? createAudio();
    if (!audio) return null;
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

/** One short sine/triangle blip. */
function tone(
  frequency: number,
  durationMs: number,
  options: { delayMs?: number; gain?: number; type?: OscillatorType } = {},
): void {
  const ctx = context();
  if (!ctx) return;
  try {
    const start = ctx.currentTime + (options.delayMs ?? 0) / 1000;
    const end = start + durationMs / 1000;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = options.type ?? "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    // A quick ramp in/out avoids the click of a hard-started oscillator.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.05, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  } catch {
    // Audio is a nicety — never let it break an interaction.
  }
}

function buzz(pattern: number | number[]): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Unsupported (iOS) or blocked — ignore.
  }
}

export const feedback = {
  /** Keypad press. */
  tap(): void {
    buzz(8);
    tone(620, 34, { gain: 0.028, type: "triangle" });
  },

  /** A PIN digit landed. */
  digit(): void {
    buzz(12);
    tone(760, 30, { gain: 0.03, type: "triangle" });
  },

  /** Money moved. */
  success(): void {
    buzz([14, 36, 24]);
    tone(880, 90, { gain: 0.045 });
    tone(1318, 170, { delayMs: 95, gain: 0.045 });
  },

  /** Something failed — a flat descending buzz reads as "no". */
  error(): void {
    buzz([28, 55, 28]);
    tone(240, 170, { gain: 0.05, type: "sawtooth" });
  },

  /** A soft nudge for non-fatal problems (validation, not found). */
  warn(): void {
    buzz(22);
    tone(340, 120, { gain: 0.04, type: "triangle" });
  },

  /** Call once from a real gesture so later audio isn't blocked. */
  unlock(): void {
    context();
  },
};
