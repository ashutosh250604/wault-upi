/**
 * Tactile + audio feedback — the layer that makes taps feel native.
 *
 * Everything degrades to a silent no-op: iOS Safari has no vibrate API, and
 * audio needs a user gesture before the browser will let us play anything, so
 * `unlock()` is called from the first pointer/key event.
 *
 * ## The cues are a small vocabulary, not a pile of beeps
 *
 *   `tap` / `digit`   a key was pressed. Synthesised, always, and never queued:
 *                     they fire many times a second and have to stay cheap.
 *   `success`         something was written down (a contact saved, a payee
 *                     resolved). One quiet blip — it used to be the app's
 *                     loudest two-note chime, which is a lot of ceremony for
 *                     saving an address.
 *   `paid`            money left the wallet. The tick: two tight notes a beat
 *                     apart, high and short, the sound of a cheque clearing.
 *   `received`        money arrived. A warmer, lower rise with a shimmer on top,
 *                     so arriving and leaving are different shapes rather than
 *                     the same noise at two pitches.
 *   `requested`       money was asked for. Two even knocks at the same pitch —
 *                     a question, with no resolution in it, because nothing has
 *                     moved yet.
 *   `coins`           coins were counted out as a payment's reward lands (the
 *                     scratch card revealing). The one cue allowed to be a
 *                     tiny flourish.
 *   `redeemed`        coins were paid out into the wallet. Its own cue rather
 *                     than `coins`, because a redemption is money arriving
 *                     rather than a reward being counted.
 *   `error` / `warn`  refused, and gently refused.
 *
 * ## Supplied recordings
 *
 * `SOUND_FILES` lets a supplied file stand in for any of the cues above without
 * touching the call sites. The path is set once here and the cue keeps working
 * before the file exists: a missing file rejects playback, which flips that cue
 * back to its synthesiser for the rest of the session rather than going silent.
 * See `public/sounds/README.md` for where to drop the recording.
 *
 * ## One voice per cue
 *
 * `cue()` refuses a repeat of the same cue inside `CUE_GAP_MS`. A re-render, a
 * doubled event or two components reacting to one payment therefore produce one
 * sound; a file that is already playing is rewound rather than layered, so the
 * cue can never overlap itself either.
 */

const PREF_KEY = "okwault.feedback";

/** How close together the same cue may be asked for twice, in milliseconds. */
const CUE_GAP_MS = 160;

/** The cues a supplied recording may replace. */
export type SoundCue =
  | "success"
  | "paid"
  | "received"
  | "requested"
  | "coins"
  | "redeemed";

/**
 * Recordings, by cue. Anything not listed here is always synthesised.
 *
 * `paid` covers every way money leaves the wallet — a payment, a top-up, a
 * request settled. `redeemed` covers coins being paid out into the wallet. A
 * cue whose file is missing falls back to its synthesiser and stays there, so
 * the app sounds right even if a recording is renamed or deleted.
 */
const SOUND_FILES: Partial<Record<SoundCue, string>> = {
  paid: "/sounds/payment-success.mp3",
  redeemed: "/sounds/coins-redeemed.mp3",
};

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

let enabled = readEnabled();
let audio: AudioContext | null = null;

/** When each cue was last heard, so a repeat can be refused. */
const lastCueAt = new Map<SoundCue, number>();

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

/** One short blip. */
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

interface Recording {
  element: HTMLAudioElement;
  /** True once this file has failed to load — this cue is synthesised from now on. */
  broken: boolean;
}

const recordings = new Map<string, Recording>();

function recordingFor(url: string): Recording | null {
  const existing = recordings.get(url);
  if (existing) return existing;
  try {
    const element = new Audio(url);
    element.preload = "auto";
    const recording: Recording = { element, broken: false };
    element.addEventListener("error", () => {
      recording.broken = true;
    });
    recordings.set(url, recording);
    return recording;
  } catch {
    return null;
  }
}

/**
 * Play the cue's recording, if it has one that loads.
 *
 * Returns false when the caller should synthesise instead — including the
 * first time a file turns out to be missing, which is why the fallback is
 * wired into the rejected `play()` promise rather than left to the next call.
 */
function playRecording(url: string, fallback: () => void): boolean {
  const recording = recordingFor(url);
  if (!recording || recording.broken) return false;
  try {
    // Rewind rather than layer: a payment landing on top of the last tick
    // restarts the file instead of doubling it.
    recording.element.currentTime = 0;
    const started = recording.element.play();
    if (started) {
      started.catch(() => {
        recording.broken = true;
        fallback();
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Say one cue: at most once per `CUE_GAP_MS`, from its file if it has one. */
function cue(name: SoundCue, synthesise: () => void): void {
  if (!enabled) return;
  const now = Date.now();
  const previous = lastCueAt.get(name);
  if (previous !== undefined && now - previous < CUE_GAP_MS) return;
  lastCueAt.set(name, now);

  const file = SOUND_FILES[name];
  if (file && playRecording(file, synthesise)) return;
  synthesise();
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

  /**
   * Something was written down — a payee resolved, a contact saved, a profile
   * updated. One quiet note: it confirms without celebrating, because none of
   * these are the moment the screen exists for.
   */
  success(): void {
    buzz(10);
    cue("success", () => {
      tone(784, 58, { gain: 0.03, type: "triangle" });
    });
  },

  /**
   * Money left the wallet — a payment, a top-up, a request settled.
   *
   * The tick: two tight notes, the second a fifth above the first, on top of
   * each other so they read as one gesture rather than a melody. Short, clean
   * and bright, with nothing in the low end to rumble on a phone speaker — the
   * sound of the receipt printing, not of a casino paying out.
   */
  paid(): void {
    buzz([14, 42, 18]);
    cue("paid", () => {
      tone(1318, 38, { gain: 0.05 });
      tone(1976, 92, { delayMs: 30, gain: 0.052 });
    });
  },

  /**
   * Someone paid you.
   *
   * A rising pair with a shimmer over it: lower than the payment tick and
   * slower, warm rather than crisp, so money arriving is unmistakable against
   * money leaving even at a phone's volume.
   */
  received(): void {
    buzz([10, 34, 18]);
    cue("received", () => {
      tone(659, 96, { gain: 0.04, type: "triangle" });
      tone(988, 150, { delayMs: 74, gain: 0.046, type: "triangle" });
      tone(1318, 120, { delayMs: 74, gain: 0.014 });
    });
  },

  /**
   * You asked someone for money.
   *
   * Two even knocks at one pitch: the same note twice is a question. Nothing
   * has moved, so the cue resolves nothing — it just marks that the request
   * left, which is why it is also the quietest of the three.
   */
  requested(): void {
    buzz([10, 44, 10]);
    cue("requested", () => {
      tone(523, 62, { gain: 0.038, type: "triangle" });
      tone(523, 62, { delayMs: 118, gain: 0.03, type: "triangle" });
    });
  },

  /**
   * Coins counted out onto the receipt: four falls, each a wooden "tuk" with a
   * metallic ring on top, close enough together to read as "tuk tuk tuk".
   *
   * Gains stay under 0.05 and the sequence is short on purpose — the target is
   * "satisfying", not a slot machine.
   */
  coins(): void {
    buzz([12, 26, 12, 30, 14]);
    cue("coins", () => {
      const falls = [
        { at: 0, freq: 1180, gain: 0.05 },
        { at: 88, freq: 1410, gain: 0.046 },
        { at: 168, freq: 1090, gain: 0.04 },
        { at: 252, freq: 1330, gain: 0.034 },
      ];
      for (const fall of falls) {
        tone(fall.freq, 62, { delayMs: fall.at, gain: fall.gain, type: "triangle" });
        tone(fall.freq / 4.8, 84, { delayMs: fall.at, gain: fall.gain * 0.45 });
      }
      // One quiet shimmer to close the sequence once the coins have settled.
      tone(1760, 130, { delayMs: 330, gain: 0.02 });
    });
  },

  /**
   * Coins were paid out into the wallet.
   *
   * Fires once the server confirms the redemption rather than when the button
   * is pressed, because a refused redemption must not sound like a payout. The
   * supplied recording is the sound; the fallback below is a coin settling onto
   * a warmer, lower pair, so a missing file still reads as money arriving
   * rather than as a reward being counted.
   */
  redeemed(): void {
    buzz([16, 40, 22]);
    cue("redeemed", () => {
      tone(1244, 70, { gain: 0.048, type: "triangle" });
      tone(659, 110, { delayMs: 84, gain: 0.042, type: "triangle" });
      tone(988, 150, { delayMs: 168, gain: 0.04, type: "triangle" });
    });
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
