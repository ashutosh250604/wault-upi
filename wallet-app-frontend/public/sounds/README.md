# Sounds

Recordings the app plays instead of synthesising a cue. Everything works
without them — a missing or renamed file is a silent no-op, because the cue
falls back to its synthesiser for the rest of the session.

## What ships

| File                  | Cue        | Plays when                                                     |
| --------------------- | ---------- | -------------------------------------------------------------- |
| `payment-success.mp3` | `paid`     | money left the wallet — a payment, a top-up, a settled request |
| `coins-redeemed.mp3`  | `redeemed` | coins were paid out into the wallet                            |

Both are wired in `src/lib/feedback.ts`, in `SOUND_FILES`:

```ts
const SOUND_FILES: Partial<Record<SoundCue, string>> = {
  paid: "/sounds/payment-success.mp3",
  redeemed: "/sounds/coins-redeemed.mp3",
};
```

## Replacing one

Drop the new file in here under the same name — no code change. To give a cue
that has no recording yet its own file, add its entry to `SOUND_FILES`; the cue
keeps working before the file exists.

Keep a supplied recording short and small. These two are CBR 256 kbps 44.1 kHz
(~3.2 s and ~2.1 s, 169 KB together), which is far more than a phone needs for a
UI cue: re-encoding to 64 kbps mono puts the pair near 35 KB with no audible
loss on a phone speaker. A cue is deduplicated rather than queued (a repeat
inside 160 ms plays once) and a file that is still playing is rewound rather
than layered, so a long recording can outlast the screen that triggered it.

## What happens if a file is missing

Nothing breaks. A cue whose file fails to load falls back to its synthesised
version for the rest of the session, so a wrong filename or a bad export is a
silent no-op rather than a dead payment screen. The server answers a missing
`/sounds/*` path with a `404` — never with the app shell, which a browser would
try to decode as audio.

## Cues a file can replace

| Cue         | When it plays                                      |
| ----------- | -------------------------------------------------- |
| `paid`      | money left the wallet                              |
| `received`  | money arrived from someone else                    |
| `requested` | a request for money was sent                       |
| `success`   | a write succeeded (a contact saved, a payee found)  |
| `coins`     | coins were counted out as a payment's reward lands |
| `redeemed`  | coins were paid out into the wallet                |

`tap` and `digit` (keypad presses) and `error` / `warn` are always synthesised:
the first two fire many times a second and have to stay cheap, and the last two
are feedback about input rather than a moment worth a recording.
