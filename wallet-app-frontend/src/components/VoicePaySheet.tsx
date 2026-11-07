import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { VoiceInterpretation, VoicePayee } from "../types";
import { api, errorMessage } from "../lib/api";
import { feedback } from "../lib/feedback";
import { firstName, formatCurrency } from "../lib/format";
import { TILE_GLYPH, TILE_STROKE } from "../lib/tiles";
import { listenForCommand, speechProblem } from "../lib/voice";
import type { Listening } from "../lib/voice";
import { usePayeeResolution } from "../hooks/usePayeeResolution";
import { Avatar } from "./ui/Avatar";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, TextInput } from "./ui/Field";
import { ReceiverCard } from "./ReceiverCard";
import { IconMic, IconWarning } from "./ui/Icons";
import { IconTile } from "./ui/IconTile";
import { Sheet } from "./ui/Sheet";
import { Spinner } from "./ui/Spinner";

const MIC = 32;

type Phase = "idle" | "listening" | "thinking" | "confirm" | "choose" | "failed";

const EXAMPLES = [
  "Pay Rohan 250",
  "Pay Mom",
  "Pay 9000000004 five hundred",
  "Pay 9000000002 at okwault",
];

function personLabel(person: VoicePayee): string {
  return person.nickname ?? person.name ?? person.vpa ?? "them";
}

function capitalised(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

export interface VoicePaySheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Pay someone by saying so.
 *
 * The flow is deliberately three steps rather than one: the microphone fills in
 * who and how much, the sheet shows the *resolved* person (never just the words
 * that were heard), and the existing amount screen takes it from there. A
 * misheard word can therefore never be one keystroke away from a payment, and
 * the PIN, on the screen that has always asked for it, is still the only thing
 * that moves money.
 *
 * The grammar is the server's (`wallet/voice.py`). Everything here is the
 * listening state, the transcript, and the answer.
 */
export function VoicePaySheet({ open, onClose }: VoicePaySheetProps) {
  const navigate = useNavigate();
  const { startPayment } = usePayeeResolution();

  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState<VoiceInterpretation | null>(null);
  const [chosen, setChosen] = useState<VoicePayee | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [retryText, setRetryText] = useState("");
  const [seconds, setSeconds] = useState(0);
  // The typed door onto the same grammar. A browser without a recogniser still
  // gets the feature, and a quiet room is not the only place it works.
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  const listening = useRef<Listening | null>(null);
  // Read once per render: the reason voice can't run here, if it can't.
  const unavailable = speechProblem();
  // No recogniser means there is nothing to tap, so the sheet opens on the typed
  // door rather than promising a microphone that can only fail after the tap.
  const typesOnly = unavailable !== null;
  const showingTyped = typing || typesOnly;

  const stopListening = useCallback(() => {
    listening.current?.abort();
    listening.current = null;
  }, []);

  // A sheet that closes while the microphone is open must let go of it: the
  // recogniser is a device input, not a bit of view state.
  useEffect(() => {
    if (!open) {
      stopListening();
      setPhase("idle");
      setHeard("");
      setAnswer(null);
      setChosen(null);
      setIssue(null);
      setRetryText("");
      setSeconds(0);
      setTyping(false);
      setTyped("");
    }
  }, [open, stopListening]);

  useEffect(() => () => stopListening(), [stopListening]);

  // Recognition ends after a pause on iOS, so a listening state with no clock
  // reads as a hang. The count is also the honest thing to show.
  useEffect(() => {
    if (phase !== "listening") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Every phase puts the keyboard somewhere deliberate. The microphone button a
  // phase was launched from is gone by the time the answer arrives, and focus
  // falling back to <body> means the next Tab starts at the top of the page,
  // behind a dialog that claims the page is unavailable.
  useEffect(() => {
    if (!open) return;
    document.querySelector<HTMLElement>(`[data-voice-focus="${phase}"]`)?.focus();
  }, [open, phase]);

  const interpret = useCallback(async (text: string) => {
    setHeard(text);
    setRetryText(text);
    setPhase("thinking");
    try {
      const result = await api.interpretVoice(text);
      setAnswer(result);
      if (result.payee) {
        setChosen(result.payee);
        setPhase("confirm");
        feedback.success();
      } else if (result.matches.length > 1) {
        setPhase("choose");
      } else {
        setIssue(result.message);
        setPhase("failed");
      }
    } catch (err) {
      setIssue(errorMessage(err));
      setPhase("failed");
    }
  }, []);

  const start = useCallback(() => {
    setIssue(null);
    setAnswer(null);
    setChosen(null);
    setHeard("");
    setRetryText("");
    setSeconds(0);

    if (unavailable) {
      setIssue(unavailable);
      setPhase("failed");
      return;
    }

    feedback.tap();
    setPhase("listening");

    const handle = listenForCommand({
      onPartial: setHeard,
      onFinal: (text) => void interpret(text),
      onError: (message) => {
        setIssue(message);
        setPhase("failed");
      },
      // Only step back to the microphone if nothing was heard; a final result
      // has already moved the sheet on to thinking or confirming.
      onEnd: () => {
        listening.current = null;
        setPhase((current) => (current === "listening" ? "idle" : current));
      },
    });

    listening.current = handle;
    if (!handle) {
      setIssue("The microphone didn't start. Try again, or enter the payment instead.");
      setPhase("failed");
    }
  }, [interpret, unavailable]);

  const finishSpeaking = useCallback(() => {
    listening.current?.stop();
  }, []);

  const payee = chosen ?? answer?.payee ?? null;
  const amount = answer?.amount ?? null;

  const proceed = useCallback(() => {
    if (!payee) return;
    stopListening();
    onClose();
    startPayment(payee, amount === null ? {} : { amount });
  }, [amount, onClose, payee, startPayment, stopListening]);

  const enterManually = useCallback(() => {
    stopListening();
    onClose();
    navigate("/scan?manual=1");
  }, [navigate, onClose, stopListening]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        stopListening();
        onClose();
      }}
      title={typesOnly ? "Pay by typing" : "Pay by voice"}
      description={
        typesOnly
          ? "Type it the way you would say it. Who, and how much if you like."
          : "Say who, and how much if you like."
      }
    >
      {/* What a screen reader hears the moment the answer lands. The sheet swaps
          one phase for another without a page change, so a result nobody
          announces is a dialog that silently became a different dialog. */}
      <p role="status" className="sr-only">
        {phase === "confirm" && payee
          ? `Paying ${payee.name}${amount !== null ? `, ${formatCurrency(amount)}` : ""}. Check the name before you approve.`
          : phase === "choose" && answer
            ? answer.message
            : phase === "failed" && issue
              ? issue
              : ""}
      </p>

      {phase === "idle" ? (
        <>
          {typesOnly ? (
            <p className="rounded-[10px] border border-dashed border-ink-300 p-3 text-[12px] leading-relaxed text-ink-600">
              {unavailable}
            </p>
          ) : (
          <div className="text-center">
            <button
              type="button"
              onClick={start}
              aria-label="Start listening"
              className="mx-auto flex size-[5.5rem] items-center justify-center rounded-full border-[1.5px] border-ink-900 bg-paper-100 text-ink-900 shadow-[4px_4px_0_0_rgba(25,25,22,0.85)] transition hover:bg-paper-200 active:translate-y-px active:shadow-[2px_2px_0_0_rgba(25,25,22,0.85)] focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
            >
              <IconMic size={MIC} strokeWidth={TILE_STROKE} />
            </button>
            <p className="mt-3 text-[12.5px] font-semibold text-ink-700">Tap to speak</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
              Nothing is sent until you confirm who it found.
            </p>
          </div>
          )}

          <div className="mt-5 rounded-[10px] border border-dashed border-ink-300 p-3.5">
            <p className="text-[11.5px] font-semibold text-ink-500">
              {typesOnly ? "The same words, typed" : "Try saying"}
            </p>
            <ul className="mt-2 space-y-1.5">
              {EXAMPLES.map((example) => (
                <li key={example} className="font-mono text-[12.5px] text-ink-700">
                  “{example}”
                </li>
              ))}
            </ul>
          </div>

          {showingTyped ? (
            <div className="mt-4 space-y-2">
              <Field label="Type it instead" hint={'The same words work: “pay Rohan 250”.'}>
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    data-autofocus
                    placeholder="pay Rohan 250"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && typed.trim()) {
                        void interpret(typed);
                      }
                    }}
                  />
                )}
              </Field>
              <Button
                fullWidth
                disabled={!typed.trim()}
                onClick={() => void interpret(typed)}
              >
                Continue
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTyping(true)}
              className="mt-3 w-full text-center text-[12px] font-semibold text-ink-600 underline decoration-ink-300 decoration-1 underline-offset-4 transition hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
            >
              Or type it instead
            </button>
          )}
        </>
      ) : null}

      {phase === "listening" ? (
        <div className="text-center">
          <div className="relative mx-auto grid size-[5.5rem] place-items-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-listen rounded-full bg-seal-500/30"
            />
            <button
              type="button"
              onClick={finishSpeaking}
              aria-label="Stop listening"
              className="relative flex size-[5.5rem] items-center justify-center rounded-full bg-seal-600 text-paper-25 shadow-[0_18px_34px_-20px_rgba(120,35,26,0.9)] focus-visible:ring-2 focus-visible:ring-seal-900/40 focus-visible:outline-none"
            >
              <IconMic size={MIC} strokeWidth={TILE_STROKE} />
            </button>
          </div>
          <p className="mt-3 text-[12.5px] font-semibold text-ink-700">
            Listening{seconds > 0 ? ` · ${seconds}s` : ""}
          </p>
          <p
            aria-live="polite"
            className="mt-2 min-h-10 text-[13px] leading-relaxed text-ink-500"
          >
            {heard || "Say the name and the amount"}
          </p>
          <Button variant="secondary" size="sm" className="mt-1" onClick={finishSpeaking}>
            Done speaking
          </Button>
        </div>
      ) : null}

      {phase === "thinking" ? (
        <div className="py-6 text-center">
          <Spinner size={22} className="mx-auto text-ink-500" />
          <p className="mt-3 text-[13px] font-semibold text-ink-700">
            Working out who you meant…
          </p>
          <p className="mt-1 font-mono text-[12px] text-ink-500">“{heard}”</p>
        </div>
      ) : null}

      {phase === "confirm" && payee ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <p className="text-[11.5px] text-ink-500">You said</p>
            <p className="min-w-0 truncate font-mono text-[11.5px] text-ink-600">“{heard}”</p>
          </div>

          <ReceiverCard name={payee.name} vpa={payee.vpa} />

          {amount !== null ? (
            <div className="rounded-[10px] border-[1.5px] border-ink-900/25 bg-paper-100 p-3.5 text-center">
              <p className="font-display text-[1.9rem] leading-none font-extrabold tracking-[-0.03em] text-ink-900 tabular-nums">
                {formatCurrency(amount)}
              </p>
              {answer?.amount_in_words ? (
                // The same figure a second time, in words: a misheard zero is
                // obvious here in a way two neighbouring numerals never are.
                <p className="mt-1.5 text-[11.5px] text-ink-500">
                  {capitalised(answer.amount_in_words)} only
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-[10px] border border-dashed border-ink-300 p-3 text-center text-[12.5px] text-ink-500">
              You&apos;ll choose the amount on the next screen.
            </p>
          )}

          <Button fullWidth size="lg" onClick={proceed} data-voice-focus="confirm">
            Yes, pay {firstName(payee.nickname ?? payee.name)}
          </Button>
          <Button variant="secondary" fullWidth onClick={start}>
            Not this one. Say it again
          </Button>
        </div>
      ) : null}

      {phase === "choose" && answer ? (
        <div className="space-y-2">
          <p className="pb-1 text-[13px] leading-relaxed font-semibold text-ink-800">
            {answer.message}
          </p>
          {answer.matches.map((person, index) => (
            <button
              key={person.user_id}
              type="button"
              data-voice-focus={index === 0 ? "choose" : undefined}
              onClick={() => {
                feedback.tap();
                setChosen(person);
                setPhase("confirm");
              }}
              className="flex w-full items-center gap-3 rounded-[10px] border-[1.5px] border-ink-900/75 bg-paper-25 p-3 text-left transition hover:bg-paper-100 active:bg-paper-200 focus-visible:ring-2 focus-visible:ring-ink-900/30 focus-visible:outline-none"
            >
              <Avatar name={personLabel(person)} size="sm" tone="ink" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ink-900">
                  {personLabel(person)}
                </span>
                {/* Two people can share a nickname, so the real name is what
                    tells these rows apart. */}
                <span className="block truncate text-[11.5px] text-ink-500">
                  {person.nickname && person.name ? `${person.name} · ` : null}
                  <span className="font-mono tabular-nums">{person.vpa}</span>
                </span>
              </span>
            </button>
          ))}
          <Button variant="secondary" fullWidth onClick={start}>
            Say it again
          </Button>
        </div>
      ) : null}

      {phase === "failed" ? (
        <div className="space-y-3">
          {/* Focused, not clicked: the card is where the answer to "what went
              wrong?" lives, so it is what a keyboard user should land on. */}
          <div data-voice-focus="failed" tabIndex={-1} className="rounded-[10px] focus:outline-none">
            <Card tone="muted" className="flex gap-2.5">
              <IconTile tone="seal" scale="sm">
                <IconWarning size={TILE_GLYPH.sm} strokeWidth={TILE_STROKE} />
              </IconTile>
              <p className="text-[12.5px] leading-relaxed text-ink-700">{issue}</p>
            </Card>
          </div>

          {unavailable === null ? (
            <>
              <Field
                label="Say it another way"
                hint="Edit what was heard and send it, or use the microphone again."
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={retryText}
                    onChange={(event) => setRetryText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && retryText.trim()) {
                        void interpret(retryText);
                      }
                    }}
                  />
                )}
              </Field>
              <Button
                fullWidth
                disabled={!retryText.trim()}
                onClick={() => void interpret(retryText)}
              >
                Use this
              </Button>
              <Button variant="secondary" fullWidth onClick={start}>
                Try the microphone again
              </Button>
            </>
          ) : null}

          <Button variant="ghost" fullWidth onClick={enterManually}>
            Enter a payment instead
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
