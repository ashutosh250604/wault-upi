# WAULT — UPI-Style Digital Wallet

A full-stack, UPI-inspired wallet: mobile-number sign-in with OTP, a 4-digit UPI PIN, a
unique VPA (`mobile@okwault`) rendered as a scannable QR code, balance, top-up, P2P
transfers, money requests and a transaction history.

Every time the app shows is **IST**, every date is **DD-MM-YYYY**, and every session lasts
at most **30 minutes** — see [Time and sessions](#time-and-sessions).

> **Portfolio project — not real UPI.** There is no NPCI/UPI integration, no real money and
> no real payment rail. Handles use the made-up suffix `@okwault` and payments only
> move balances between accounts inside this app's own database. The Profile screen repeats
> this in its "About WAULT" card, along with the sample logins and the live API/database
> status, so anyone who lands in the app is told the same thing.

**Live demo:** [upi-wallet-demo.onrender.com](https://upi-wallet-demo.onrender.com) (see [Deploy](#deploy))

> The demo runs on Render's free tier, so the first request after ~15 minutes of idle
> takes 20-50 seconds while the instance wakes up.

## Sample accounts

| Account | Mobile | VPA | PIN | Balance |
| --- | --- | --- | --- | --- |
| Aarav Sharma | `9000000001` | `9000000001@okwault` | `1234` | ₹5,000 (+ seeded history) |
| Meera Iyer | `9000000002` | `9000000002@okwault` | `1234` | ₹2,500 |
| Rohan Verma | `9000000004` | `9000000004@okwault` | `1234` | ₹1,800 |
| Ananya Desai | `9000000005` | `9000000005@okwault` | `1234` | ₹950 |
| Gupta Kirana Store | `9000000006` | `9000000006@okwault` | `1234` | ₹4,200 |

The extra accounts exist so the address book, the "Send money to" strip and the
frequent-payer ranking have something real to show on a fresh install. Anyone in that table
can be signed into with the emailed-on-screen OTP.

Two ways to get in:

- **Explore with a ready-made account** on the login screen → one-tap token login as Aarav (no OTP).
- Normal flow with a mobile number → in demo mode the OTP is shown on screen (no SMS provider).

Try a payment: **tap a face under "Send money to" → amount → PIN `1234`**, or **Scan QR →
type `9000000002@okwault`**. Cameras need HTTPS, which the deployed URL provides; typed
numbers and UPI IDs work with or without a camera.

## Features

- OTP login with expiry, attempt limits and a resend cooldown enforced server-side (with
  auto-submit and paste)
- Guided onboarding: name/email → auto-generated VPA → 4-digit PIN (with confirm step)
- Wallet home: balance card with hide/show, quick actions, **"Send money to" avatar strip** of
  people you pay, offers, recent activity
- P2P transfers by mobile number **or** UPI ID, with the **verified recipient name shown before
  paying**
- Address book: searchable contacts, favourites, per-person nicknames, one-tap repeat payments;
  a person's registered name is always read live from the directory and can't be edited away
- Money requests: ask a contact for an amount with a note, see what you owe and what's coming
  to you, and approve an ask with the PIN — the transfer and the request closing land in the
  same commit, so a request can never look open after the money moved
- **The PIN is verified by the server on every debit** (payments, request approvals and
  top-ups), sharing one attempt counter and lockout, so a stolen token alone can't move money
- **Notification inbox** with an unread badge on the home screen: every payment, top-up, money
  request, reward and sign-in writes a line, derived from the ledger rather than typed by hand,
  and each line links through to the screen that owns the detail — including a note when a
  payment leaves a scratch card waiting, which opens the collection rather than the receipt
- **Coins, and one currency for every reward.** Each successful payment draws 1–50 coins from a
  server-side, weighted draw (mostly 1–5, a big number is genuinely rare), recorded against the
  transaction that earned it; a coin is worth **₹1**, and 10 coins is the floor to clear — above
  it a redemption takes the **whole balance** (11 coins pay ₹11, 37 pay ₹37) through the same
  ledger every other credit goes through, so no coin is ever rounded off and kept. A new account
  is handed a **50-coin welcome bonus** on its first verified code,
  and every offer pays in coins too — so the balance chip is the only number to watch, and it is
  the sum of one award log rather than a total anybody maintains
- **A scratch card for the coins a payment wins.** A square card, the cover is the app's own icon
  artwork on a canvas, scratched with the finger, and a twelfth of it is enough to lift by itself — the coins
  underneath are visible from the first stroke. The draw, the reveal and the balance are the
  server's; the card only decides how the number is told
- **Every card you have won, in one place.** Every coin award is a card — a payment's
  draw, an offer's payout and the 50-coin welcome bonus — and the collection screen lists
  them newest first: the ones still under their cover drawn covered and scratchable
  again, the scratched ones keeping what they paid, what won them and the date. The cover
  is remembered server-side, so a card opened on a receipt does not come back covered,
  and `/api/scratch-cards` is reachable from the coins sheet as well as from the receipt
- **Offers that actually pay out.** Progress towards each offer is counted from the ledger, and
  the coins land *in the same commit as the payment that earned them* — no window where a payment
  succeeded and its reward silently did not, and a replay of the same payment can never pay twice
- **Enforced daily sending limit** (default ₹1,00,000), measured in IST so it resets at local
  midnight, checked by the ledger on every debit and reported to the amount screen from the same
  function — the limit a user is shown and the limit that is applied can't disagree
- Linked bank accounts with a default, **PIN-gated "check balance"**, and top-ups that debit the
  chosen account in the same transaction that credits the wallet
- Statement export: a real CSV download built from the ledger, with signed amounts from the
  account owner's point of view
- QR scanner (camera, torch, lazy-loaded) plus manual number/UPI ID entry as a camera-free
  fallback
- Personal QR code with copy / save / share, encoding a `upi://pay?...` deep link
- History with money-in/out filters, day grouping and tap-through receipts
- Money stored as **integer paise**; transfers use an **atomic conditional debit** so
  concurrent requests cannot overdraw a wallet
- JWT sessions capped at 30 minutes, scrypt-hashed PINs/OTPs, PIN lockout after 5 wrong attempts,
  ownership checks on every wallet endpoint

## Frontend notes

- **Typed end to end.** `tsc --noEmit` runs in CI-script form (`npm run typecheck`) and every
  API response is described once in `src/types.ts`.
- **One error path.** All requests go through `src/lib/api.ts`, which normalises failures into
  `ApiError`, turns dead connections into human copy, and reports any 401 to the session
  provider so an expired token signs the user out instead of half-breaking a screen.
- **Client validation mirrors the server**, but only as UX — the server re-validates every
  amount, PIN and ownership rule.
- **Accessible by default:** labelled inputs, `aria-live` errors, Escape-to-close sheets with
  focus management, and `prefers-reduced-motion` support.
- **Fast first paint:** the barcode-decoding engine is code-split, so the scanner's ~156 kB
  chunk only downloads when someone opens the scanner (initial bundle ≈ 430 kB / 129 kB gzip).
- **Honest states:** skeleton loaders, empty states with a next step, retryable error states,
  and a top-level error boundary.

## Architecture

```
wallet-app-frontend (React 19 + Vite)          wallet-app-backend (Flask)
        │                                              │
        │  same origin in production  ◄───────────────► │  /api routes + built SPA
        │  Vite dev server in development               │  SQLAlchemy models
        ▼                                              ▼
   React Router pages ───────────────────────►  Postgres (Neon) or SQLite locally
```

One deployable: the Docker image builds the frontend, then serves `dist/` from Flask so the
app and API share an origin (no CORS, no mixed content, camera works over the single HTTPS URL).

```
wallet-app-backend/
  wallet/
    __init__.py      app factory, health check, SPA serving, CLI
    config.py        env-driven configuration
    models.py        User / Wallet / Transaction / Contact / LinkedAccount / PaymentRequest
                     / Notification / Reward (balances as paise)
    security.py      validators, scrypt hashing, JWT, require_auth
    money.py         paise conversion + transaction references
    ledger.py        the one place money moves: atomic debit/credit + inbox rows
    limits.py        the daily cap window, its enforcement and its snapshot
    rewards.py       the offer catalogue, ledger-derived progress, coin settlement
    coins.py         the coin award log: the draw, the welcome bonus, redemption
    events.py        the single helper every notification is written through
    seed.py          idempotent demo data
    blueprints/      auth.py, wallet.py, people.py, requests.py, accounts.py, inbox.py
  migrations/        Alembic schema
  tests/             pytest suite
wallet-app-frontend/            React 19 + TypeScript + Tailwind v4 (Vite)
  src/
    App.tsx                     routes, session guards, providers
    pages/                      one file per screen (sign-in → onboarding → wallet → payment)
    components/                 app shell + bottom tabs, keypads, PIN pad, QR views, toasts
    components/ui/              design system: Button, Card, Field, Sheet, Badge, states, icons
    lib/                        typed API client, formatting, validation, session storage
    session/                    auth state + cached profile/transactions provider
    types.ts                    the API contract, in one place
```

## API

Every JSON endpoint lives under **`/api`**, so the API can never shadow a client route:
`/requests` is a screen, `/api/requests` is data. `/healthz` stays at the root for hosting
health checks.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/healthz` | – | health check (reports the live database + driver) |
| POST | `/api/start_login` | – | validate mobile, issue OTP (`dev_otp` in demo mode) |
| POST | `/api/verify_otp` | – | verify OTP, returns JWT + user id |
| POST | `/api/demo_login` | – | one-tap session as the seeded sample account (demo mode only) |
| POST | `/api/set_name` | Bearer | save name/email, generate VPA, create wallet |
| POST | `/api/set_pin` | Bearer | store scrypt-hashed PIN |
| POST | `/api/verify_pin` | Bearer | PIN check with lockout |
| GET | `/api/me` | Bearer | current profile + balance (and whether a PIN is set) |
| GET | `/api/get_balance/<id>` | Bearer | wallet balance (own wallet only) |
| POST | `/api/topup` | Bearer + PIN | add funds, optionally debiting a linked account |
| POST | `/api/transfer` | Bearer + PIN | send money: the PIN is verified server-side before the debit |
| POST | `/api/vpas/resolve` | Bearer | UPI ID → verified name + user id |
| POST | `/api/payees/resolve` | Bearer | mobile number *or* UPI ID → verified name + user id |
| GET | `/api/people/recent` | Bearer | home strip: people paid recently, then saved contacts |
| GET | `/api/contacts` | Bearer | the caller's address book |
| POST | `/api/contacts` | Bearer | save a payee (idempotent: re-saving updates the nickname) |
| PATCH | `/api/contacts/<id>` | Bearer | rename / favourite a saved payee |
| DELETE | `/api/contacts/<id>` | Bearer | remove a saved payee |
| POST | `/api/requests` | Bearer | ask someone for money |
| GET | `/api/requests` | Bearer | every ask involving the caller, open ones first |
| POST | `/api/requests/<id>/pay` | Bearer + PIN | approve an ask: verifies the PIN, transfers, closes the request |
| POST | `/api/requests/<id>/decline` | Bearer | refuse an ask (payer only) |
| POST | `/api/requests/<id>/cancel` | Bearer | withdraw an ask (requester only) |
| GET | `/api/accounts` | Bearer | linked bank accounts (masked numbers, default flagged) |
| POST | `/api/accounts/<id>/default` | Bearer | switch the default funding account |
| POST | `/api/accounts/<id>/balance` | Bearer + PIN | the PIN-gated balance check |
| GET | `/api/statements.csv` | Bearer | statement download, optional `?month=YYYY-MM` |
| GET | `/api/transactions/<id>` | Bearer | history with sender/receiver names |
| GET | `/api/limits` | Bearer | today's cap, what's spent and when it resets |
| GET | `/api/notifications` | Bearer | the inbox plus its unread count, newest first |
| POST | `/api/notifications/<id>/read` | Bearer | mark one row read |
| POST | `/api/notifications/read-all` | Bearer | clear the badge |
| DELETE | `/api/notifications/<id>` | Bearer | forget a row (never touches the money it describes) |
| GET | `/api/rewards` | Bearer | this account's offers with progress counted from the ledger |
| GET | `/api/coins` | Bearer | the coin balance, what it is worth, and where the last few came from |
| POST | `/api/coins/redeem` | Bearer | coins → wallet credit (the whole balance, 10 coins minimum) |
| GET | `/api/scratch-cards` | Bearer | every card the wallet has won, newest first |
| POST | `/api/scratch-cards/<id>/scratch` | Bearer | record that a card's cover has been lifted |
| GET | `/api/statements.pdf` | Bearer | the branded PDF statement |

Coins ride along on the responses that earn them: `/api/transfer` and
`/api/requests/<id>/pay` return `coins_earned` (this payment's draw), `coin_card_id`
(the card that draw was handed over on) and `rewards` (any offer it completed,
each with its `coins`), which is what the scratch card reveals. A new account's
50 coins are granted by `/api/verify_otp`, once.

## Local development

### Backend (SQLite by default — no database setup needed)

```bash
cd wallet-app-backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/python
export FLASK_APP=app.py DEMO_MODE=true       # DEMO_MODE seeds no data itself, but it is
                                             # what makes /demo_login work and returns
                                             # the OTP in the response instead of the log
.venv/Scripts/python -m flask db upgrade     # required: the demo database needs the
.venv/Scripts/python -m flask seed-demo      # accounts, so run the seed once too
```

Use `python -m flask`, not the `flask` shim: on Windows `.venv/Scripts/flask.exe` can exit
1 with no output at all, which looks like a broken install.

To sign in without `DEMO_MODE`, the OTP is written to the server log (`OTP for 9000000001:
…`) because no SMS gateway is configured locally.

### Frontend

```bash
cd wallet-app-frontend
npm ci
npm run dev          # http://localhost:5173, talks to http://localhost:5000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (flat config, TypeScript-aware)
npm run build        # production bundle into dist/
```

`npm run dev` needs **Node 20.19+ or 22.12+** (Vite 7 opens the dev server with
`crypto.hash`, which older Node lacks — on Node 20.4 it dies with `TypeError: crypto.hash
is not a function`). `npm run build` still works on older Node, so on an old toolchain use
the single-origin path below, or upgrade Node.

### Single origin (the deployed setup)

Flask serves `dist/` itself, so this reproduces production exactly — same origin, no CORS,
and no Vite dev server. Flask only looks for the bundle in `STATIC_FOLDER`, which defaults
to `wallet-app-backend/static_frontend` (the directory the Docker build creates), so point
it at `dist` or copy the files there. A path that does not exist silently disables the SPA
and `/` answers 404.

```bash
cd wallet-app-frontend && npm run build
cd ../wallet-app-backend
# either copy the bundle where Flask already looks for it…
cp -r ../wallet-app-frontend/dist ./static_frontend
# …or leave it in place and point Flask at it instead
export STATIC_FOLDER="$(cd ../wallet-app-frontend/dist && pwd)"
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
.venv/Scripts/python -m flask run --port 5000
```

Then open <http://127.0.0.1:5000> and use the demo account: mobile `9000000001`, PIN
`1234` (or the one-tap *Explore with a ready-made account* button when `DEMO_MODE=true`).
Rebuild after every frontend change — Flask serves static files, it does not watch them.

To demo from your phone on the same Wi-Fi, point `VITE_API_BASE` in
`wallet-app-frontend/.env.development` at your machine's LAN IP and allow that origin in
`CORS_ORIGINS`. Camera scanning needs HTTPS, so use the deployed URL (or a tunnel) for that.

Tests:

```bash
cd wallet-app-backend && .venv/Scripts/python -m pytest
```

## Time and sessions

The app has one rule about clocks: **store and compare in UTC, show in IST.**

- Every timestamp in the database is UTC, and every window a query filters on is converted
to UTC before it reaches SQL.
- Everything a person reads is rendered in `Asia/Kolkata`: transaction times, day headings,
month banners on statements, the CSV/PDF exports and the greeting on the home screen. A
fixed +05:30 offset is used rather than a timezone database, since India has had no daylight
saving since 1945.
- Dates are printed **DD-MM-YYYY** everywhere. Month banner rows on a statement keep the
month's name, because that is a period label rather than a date.
- The statement window is the user's calendar month, not the server's: `2026-09` runs from
18:30 UTC on 31 August (midnight IST on 1 September) to the same instant on 30 September. A
UTC-boundary month would file a 1am IST payment under the previous month.
- Reference codes (`TXN20261006K7Q2MP`) carry an IST date for the same reason.

Sessions last **30 minutes**, and that ceiling is enforced in code
(`wallet/config.py` clamps `JWT_EXPIRES_MINUTES`), not only in the default — setting the
environment variable to `720` still yields 30 minutes. The client counts the same window down
from the token's `exp` and signs out the moment it lapses, rather than discovering the expiry
with a 401 half-way through a payment. Sign-in responses also return `expires_at` (IST) and
`expires_in` (seconds) so any other client can do the same.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local SQLite file | Postgres connection string in production |
| `SECRET_KEY` | dev value | JWT signing key; use 32+ random bytes |
| `DEMO_MODE` | `false` | seeds demo data, enables `/demo_login`, returns OTP in the API |
| `DEMO_MOBILE` | `9000000001` | account used by one-tap demo login |
| `VPA_SUFFIX` | `okwault` | suffix for generated UPI IDs |
| `MAX_DAILY_RUPEES` | `100000` | daily sending cap per account; `0` lifts it |
| `LIMIT_TZ_OFFSET_MINUTES` | `330` | minutes added to UTC to find the limit day's local midnight (330 = IST) |
| `MAX_TRANSFER_RUPEES` | `100000` | ceiling for a single debit (a payment or a request approval) |
| `OTP_TTL_MINUTES` | `5` | how long a login code stays valid |
| `OTP_FREE_REQUESTS` | `5` | codes a number may ask for in a row before the wait starts |
| `OTP_RESEND_SECONDS` | `60` | seconds between codes once the free requests are used up |
| `CORS_ORIGINS` | `localhost:5173` | comma-separated extra browser origins |
| `JWT_EXPIRES_MINUTES` | `30` | session lifetime in minutes; a larger value is clamped to 30 |
| `STATIC_FOLDER` | `<backend>/static_frontend` | directory of the built SPA that the API serves alongside itself |
| `PORT` | `8000` in the container (`5000` for `python app.py`) | port the server binds to; a `0` falls back to the default |

## Deploy

The repo ships a Render blueprint (`render.yaml`) plus a multi-stage `Dockerfile`. The
container applies migrations and seeds demo data on boot, then serves the API and SPA with
gunicorn.

1. **Push to GitHub** — create an empty repo and push this project to it.
2. **Create a Neon Postgres project** (neon.tech) and copy the connection string
   (`postgresql://user:password@host/db?sslmode=require`).
3. **Render → New → Blueprint → select the repo.** Render reads `render.yaml`; paste the Neon
   string as `DATABASE_URL` when prompted. `SECRET_KEY` is generated for you.
4. First boot runs `flask db upgrade && flask seed-demo`, so the demo accounts exist
   immediately. Health check: `/healthz`.

Notes: on Render's free plan the service sleeps after ~15 minutes idle, so the first request
after a pause takes a few seconds to wake up. Camera QR scanning works because Render serves
HTTPS.

Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, a camera-only `Permissions-Policy` and HSTS, so put the
container behind TLS (Render terminates it for you) — over plain HTTP the HSTS header is
simply ignored by browsers, which is what keeps local development on `http://` working.

The frontend is built in the first Docker stage and served from the same origin, so the only
things a fresh deploy needs to set are `DATABASE_URL` and `SECRET_KEY`. A missing asset is an
honest 404: the SPA fallback only answers extension-less client routes, never a URL that looks
like a file.

## Roadmap

- [ ] Double-entry ledger for every money movement + idempotency keys on transfers
- [ ] PIN change, active sessions, "log out everywhere", delete account
- [x] Address book: saved contacts, favourites, nicknames, recent-payer ranking
- [x] Money requests: ask, pay with PIN, decline, cancel
- [x] Linked accounts, PIN-gated balance check, CSV statements
- [x] Notification inbox, offers that pay in coins, enforced daily limit
- [x] Coin rewards with a scratch card, a 50-coin sign-up bonus and PIN-free redemption
- [ ] Split a bill between several people at once, PDF receipts, date-range statements
- [ ] KYC/verification progress, autopay/mandates and a UPI-Lite-style small-value balance
- [ ] Playwright end-to-end tests plus a GitHub Actions job running typecheck, lint, build and pytest
- [ ] Screenshot gallery and a short architecture write-up at the top of this README
