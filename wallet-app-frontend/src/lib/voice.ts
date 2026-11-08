/**
 * The microphone, and nothing else.
 *
 * `SpeechRecognition` is the browser's own recogniser: Chrome and Safari on iOS
 * 14.5+ have one, Firefox ships it disabled, and an embedded webview usually has
 * none at all. Support is therefore detected rather than assumed, and the caller
 * is expected to hide the whole entry point when `speechProblem()` answers,
 * a microphone that fails after the tap is worse than no microphone.
 *
 * What comes back is a transcript. Everything that decides who is paid and how
 * much lives on the server (see `wallet/voice.py`), because a parser buried in a
 * recognition callback is a parser nobody can test.
 *
 * Two details are handled here that are easy to get wrong:
 *
 *   - **One instruction per listen.** A recogniser can emit several final
 *     results for one utterance; the first is taken and the rest ignored, which
 *     is what stops one sentence becoming two navigations.
 *   - **`aborted` is not an error.** It is our own `abort()` landing, and
 *     reporting it would show the user a failure they did not cause.
 */

interface SpeechAlternative {
  readonly transcript: string;
}

interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
}

interface SpeechResultList {
  readonly length: number;
  readonly [index: number]: SpeechResult;
}

interface SpeechResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}

interface SpeechErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecogniser {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecogniserCtor = new () => SpeechRecogniser;

function recogniserCtor(): SpeechRecogniserCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecogniserCtor;
    webkitSpeechRecognition?: SpeechRecogniserCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Why voice is unavailable here, or null when it will work.
 *
 * The secure-context check matters as much as the API check: a microphone is
 * refused over plain `http://` exactly as a camera is, which is the lesson the
 * scanner already taught this app.
 */
export function speechProblem(): string | null {
  if (recogniserCtor() === null) {
    return "This browser has no speech recognition. Chrome and Safari on iPhone can listen; Firefox cannot.";
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "The microphone needs a secure connection: HTTPS or localhost. Enter the payment instead.";
  }
  return null;
}

/** True when the entry point should be offered at all. */
export function speechSupported(): boolean {
  return speechProblem() === null;
}

const BLOCKED_MESSAGE =
  "Microphone access is blocked. Allow it in your browser's site settings, then try again, or enter the payment instead.";
const MISSING_MESSAGE = "No microphone was found on this device. Enter the payment instead.";
const BUSY_MESSAGE =
  "The microphone is busy in another app. Close it and try again, or enter the payment instead.";

/** What the browser already thinks of the microphone, before anybody asks. */
type MicrophonePermission = "granted" | "prompt" | "denied" | "unknown";

async function microphonePermission(): Promise<MicrophonePermission> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unknown";
  }
  try {
    const status = await navigator.permissions.query({
      // `microphone` is in the permissions registry but not in every TS lib
      // version, and Firefox/Safari reject the name at runtime.
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** The sentence for a refused or absent microphone, by the browser's own name. */
function microphoneError(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return BLOCKED_MESSAGE;
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return MISSING_MESSAGE;
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return BUSY_MESSAGE;
    default:
      return "The microphone didn't start. Try again, or enter the payment instead.";
  }
}

/**
 * Ask the browser for the microphone, on the click that wanted it.
 *
 * The recogniser is left to decide when to ask for permission, and it is a bad
 * decision-maker: the refusal arrives seconds later as "no speech", over a
 * sheet that has already told the reader it is listening. A `getUserMedia` call
 * made from the tap is the one request a browser is guaranteed to put a
 * permission bubble behind, and its rejection names the problem (blocked, no
 * device, device busy) instead of hiding it.
 *
 * Resolves to null once the microphone is usable, or to the sentence to show.
 * The stream is stopped immediately: the recogniser opens its own, and two open
 * microphones on one tab is a light people notice.
 */
export async function askForMicrophone(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "This browser can't reach a microphone. Enter the payment instead.";
  }

  // A browser that has already refused will not prompt again, so there is no
  // point opening a device that can only fail. Say what to change instead.
  if ((await microphonePermission()) === "denied") return BLOCKED_MESSAGE;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return null;
  } catch (error) {
    return microphoneError(error);
  }
}

export interface ListenOptions {
  /** Words as they arrive, before the recogniser has committed to them. */
  onPartial?: (text: string) => void;
  /** The finished instruction, called at most once per listen. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  /** The recogniser has stopped, for any reason. */
  onEnd?: () => void;
  /** Defaults to Indian English, which is what the grammar expects. */
  lang?: string;
}

export interface Listening {
  /** Stop and keep what was heard. */
  stop: () => void;
  /** Stop and discard it. */
  abort: () => void;
}

function speechError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return BLOCKED_MESSAGE;
    case "no-speech":
      return "I didn't hear anything. Tap the microphone and say “pay Rohan 250”.";
    case "audio-capture":
      return "No microphone was found on this device. Enter the payment instead.";
    case "network":
      return "Speech recognition needs a connection. Check your network and try again.";
    case "language-not-supported":
      return "This browser can't recognise Indian English. Enter the payment instead.";
    default:
      return "That didn't come through. Try again, or enter the payment instead.";
  }
}

export function listenForCommand(options: ListenOptions): Listening | null {
  const Ctor = recogniserCtor();
  if (!Ctor) return null;

  let recogniser: SpeechRecogniser;
  try {
    recogniser = new Ctor();
  } catch {
    return null;
  }

  let settled = false;

  recogniser.lang = options.lang ?? "en-IN";
  // One sentence at a time: continuous mode would keep the microphone open after
  // the instruction and send the next thing somebody said to the resolver.
  recogniser.continuous = false;
  recogniser.interimResults = true;
  recogniser.maxAlternatives = 3;

  recogniser.onresult = (event) => {
    if (settled) return;

    const interim: string[] = [];
    const finals: string[] = [];
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) finals.push(text);
      else interim.push(text);
    }

    const partial = interim.join(" ").trim();
    if (partial) options.onPartial?.(partial);

    if (finals.length > 0) {
      settled = true;
      options.onFinal(finals.join(" ").trim());
      try {
        recogniser.stop();
      } catch {
        // Already stopped, nothing to do.
      }
    }
  };

  recogniser.onerror = (event) => {
    // A deliberate abort is not a failure to show anybody.
    if (settled || event.error === "aborted") return;
    settled = true;
    options.onError(speechError(event.error));
  };

  recogniser.onend = () => {
    options.onEnd?.();
  };

  try {
    recogniser.start();
  } catch {
    options.onError("The microphone didn't start. Try again.");
    return null;
  }

  return {
    stop: () => {
      try {
        recogniser.stop();
      } catch {
        // Already stopped, nothing to do.
      }
    },
    abort: () => {
      settled = true;
      try {
        recogniser.abort();
      } catch {
        // Already stopped, nothing to do.
      }
    },
  };
}
