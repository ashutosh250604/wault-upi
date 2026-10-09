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
 *   `paid`            money left the wallet. The supplied `payment-success.mp3`
 *                     and nothing else — see "Supplied recordings" below.
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
 * `SOUND_FILES` lets a supplied file *replace* a cue without touching the call
 * sites. A cue with a file plays only the file — never the file and its
 * synthesiser, which is what a payment used to sound like. The synthesiser is
 * kept for the cues nobody has recorded yet; for a recorded cue it is the
 * fallback for a file that fails to load, and it never plays underneath the
 * recording. See `public/sounds/README.md` for where the files live.
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
 * request settled. `redeemed` covers coins being paid out into the wallet.
 *
 * A cue with a recording is one voice: the file if it loads, its synthesiser if
 * it does not. There is no path that plays both, because two sounds for one
 * payment is exactly what a recorded cue must not do.
 */
const SOUND_FILES: Partial<Record<SoundCue, string>> = {
  paid: "/sounds/payment-success.mp3",
  redeemed: "/sounds/coins-redeemed.mp3",
};

/** Every recording, so it can be warmed before the first payment needs it. */
const SOUND_URLS = Object.values(SOUND_FILES).filter(
  (url): url is string => typeof url === "string",
);

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
 * Returns false when the caller should synthesise instead. A failed `play()`
 * is not the end of the file — a browser may refuse the very first call until
 * it has seen a gesture — so a rejected playback stays retryable; only a load
 * *error* takes the recording out of service for the session.
 */
function playRecording(url: string): boolean {
  const recording = recordingFor(url);
  if (!recording || recording.broken) return false;
  try {
    // Rewind rather than layer: a payment landing on top of the last tick
    // restarts the file instead of doubling it.
    recording.element.currentTime = 0;
    void recording.element.play().catch(() => {
      // Refused (usually autoplay policy) — the next cue tries again. Nothing
      // is synthesised on top, so a payment never sounds twice.
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Say one cue: at most once per `CUE_GAP_MS`, from its recording if it has one.
 *
 * A recorded cue is the recording, full stop: if the file is missing the cue is
 * silent rather than doubled up with the synthesiser it replaced.
 */
function cue(name: SoundCue, synthesise: () => void): void {
  if (!enabled) return;
  const now = Date.now();
  const previous = lastCueAt.get(name);
  if (previous !== undefined && now - previous < CUE_GAP_MS) return;
  lastCueAt.set(name, now);

  const file = SOUND_FILES[name];
  if (file) {
    playRecording(file);
    return;
  }
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
   * The supplied recording is the sound. The synthesiser under it — two tight
   * notes, the second a fifth above the first — is used only where
   * `payment-success.mp3` is missing, so a paid cue is one voice either way.
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
    // Warm the supplied recordings here rather than at the first payment: the
    // clip is then ready to start the instant money moves, instead of fetching
    // 100 kB while the receipt is already on screen.
    if (!enabled) return;
    for (const url of SOUND_URLS) recordingFor(url);
  },
};
