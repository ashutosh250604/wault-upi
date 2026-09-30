# UPI-Style Digital Wallet (Demo)

A full-stack, UPI-inspired wallet demo: mobile-number sign-in with OTP, a 4-digit UPI PIN,
a unique VPA (`mobile@demoupi`) rendered as a scannable QR code, balance, top-up, P2P
transfers and a transaction history.

> **Demo project — not real UPI.** There is no NPCI/UPI integration, no real money and no
> real payment rail. Handles use the made-up suffix `@demoupi` and payments only move
> balances between accounts inside this app's own database.

**Live demo:** [upi-wallet-demo.onrender.com](https://upi-wallet-demo.onrender.com) (see [Deploy](#deploy))

> The demo runs on Render's free tier, so the first request after ~15 minutes of idle
> takes 20-50 seconds while the instance wakes up.

## Demo accounts

| Account | Mobile | VPA | PIN | Balance |
| --- | --- | --- | --- | --- |
| Aarav Sharma | `9000000001` | `9000000001@demoupi` | `1234` | ₹5,000 (+ seeded history) |
| Meera Iyer | `9000000002` | `9000000002@demoupi` | `1234` | ₹2,500 |
| Rohan Verma | `9000000004` | `9000000004@demoupi` | `1234` | ₹1,800 |
| Ananya Desai | `9000000005` | `9000000005@demoupi` | `1234` | ₹950 |
| Gupta Kirana Store | `9000000006` | `9000000006@demoupi` | `1234` | ₹4,200 |

The extra accounts exist so the address book, the "Send money to" strip and the
frequent-payer ranking have something real to show on a fresh install. Anyone in that table
can be signed into with the demo OTP.

Two ways to get in:

- **Explore demo account** on the login screen → one-tap token login as Aarav (no OTP).
- Normal flow with a mobile number → in demo mode the OTP is shown on screen (no SMS provider).

Try a payment: **tap a face under "Send money to" → amount → PIN `1234`**, or **Scan QR →
type `9000000002@demoupi`**. Cameras need HTTPS, which the deployed URL provides; typed
numbers and UPI IDs work with or without a camera.

## Features

- OTP login with expiry, attempt limits and resend timer (with auto-submit and paste)
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
- **The PIN is verified by the server on every debit** (payments and request approvals), sharing
  one attempt counter and lockout, so a stolen token alone can't move money
- QR scanner (camera, torch, lazy-loaded) plus manual number/UPI ID entry as a camera-free
  fallback
- Personal QR code with copy / save / share, encoding a `upi://pay?...` deep link
- History with money-in/out filters, day grouping and tap-through receipts
- Money stored as **integer paise**; transfers use an **atomic conditional debit** so
  concurrent requests cannot overdraw a wallet
- JWT sessions, scrypt-hashed PINs/OTPs, PIN lockout after 5 wrong attempts,
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
- **Fast first paint:** the barcode-decoding engine is code-split, so the scanner's ~150 kB
  chunk only downloads when someone opens the scanner (initial bundle ≈ 359 kB / 111 kB gzip).
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
    models.py        User / Wallet / Transaction (balances as paise)
    security.py      validators, scrypt hashing, JWT, require_auth
    money.py         paise conversion + transaction references
    seed.py          idempotent demo data
    blueprints/      auth.py, wallet.py
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
| POST | `/api/demo_login` | – | one-tap demo session (demo mode only) |
| POST | `/api/set_name` | Bearer | save name/email, generate VPA, create wallet |
| POST | `/api/set_pin` | Bearer | store scrypt-hashed PIN |
| POST | `/api/verify_pin` | Bearer | PIN check with lockout |
| GET | `/api/me` | Bearer | current profile + balance (and whether a PIN is set) |
| GET | `/api/get_balance/<id>` | Bearer | wallet balance (own wallet only) |
| POST | `/api/topup` | Bearer | add funds (own wallet only) |
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
| GET | `/api/transactions/<id>` | Bearer | history with sender/receiver names |

## Local development

Backend (SQLite by default — no database setup needed):

```bash
cd wallet-app-backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m flask db upgrade
.venv/Scripts/python -m flask seed-demo
.venv/Scripts/python -m flask run --port 5000
```

Frontend:

```bash
cd wallet-app-frontend
npm ci
npm run dev          # http://localhost:5173, talks to http://localhost:5000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (flat config, TypeScript-aware)
npm run build        # production bundle into dist/
```

The production bundle is served by Flask itself, so `npm run build` then visiting
`http://localhost:5000` reproduces the deployed setup exactly (same origin, no CORS).

To demo from your phone on the same Wi-Fi, point `VITE_API_BASE` in
`wallet-app-frontend/.env.development` at your machine's LAN IP and allow that origin in
`CORS_ORIGINS`. Camera scanning needs HTTPS, so use the deployed URL (or a tunnel) for that.

Tests:

```bash
cd wallet-app-backend && .venv/Scripts/python -m pytest
```

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local SQLite file | Postgres connection string in production |
| `SECRET_KEY` | dev value | JWT signing key; use 32+ random bytes |
| `DEMO_MODE` | `false` | seeds demo data, enables `/demo_login`, returns OTP in the API |
| `DEMO_MOBILE` | `9000000001` | account used by one-tap demo login |
| `VPA_SUFFIX` | `demoupi` | suffix for generated UPI IDs |
| `CORS_ORIGINS` | `localhost:5173` | comma-separated extra browser origins |
| `JWT_EXPIRES_HOURS` | `12` | session lifetime |

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

## Roadmap

- [ ] Double-entry ledger for every money movement + idempotency keys on transfers
- [ ] PIN change, active sessions, "log out everywhere", delete account
- [x] Address book: saved contacts, favourites, nicknames, recent-payer ranking
- [x] Money requests: ask, pay with PIN, decline, cancel
- [ ] Split a bill between several people at once, statements (CSV/PDF), notifications centre
- [ ] Playwright end-to-end tests plus a GitHub Actions job running typecheck, lint, build and pytest
- [ ] Screenshot gallery and a short architecture write-up at the top of this README
