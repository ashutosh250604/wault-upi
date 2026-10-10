# Wault

A UPI-style digital wallet: OTP sign-in, a 4-digit payment PIN, per-user `@okwault` UPI IDs with QR codes, P2P transfers, money requests, a coin/rewards system with scratch cards, and CSV/PDF statements.

Wault is a portfolio project. It is **not** connected to NPCI, UPI or any bank: there is no real money and no real payment rail. Handles use a made-up suffix (`@okwault`) and balances only move between accounts inside this application's own database.

**Live demo:** <https://wault-upi.onrender.com> — on Render's free tier, so the first request after ~15 minutes idle takes 20–50 seconds while the instance wakes up.

**Sample login:** mobile `9000000001`, PIN `1234`, or the *Explore with a ready-made account* button.

## Screenshots

| | |
| --- | --- |
| ![Sign in](docs/screenshots/01-sign-in.png) | ![Wallet home](docs/screenshots/02-home.png) |
| Sign-in, with the one-tap sample account | Wallet home: balance, quick actions, recent payees |
| ![Entering an amount](docs/screenshots/03-payment-amount.png) | ![Payment receipt](docs/screenshots/04-payment-receipt.png) |
| Sending money: verified payee, amount, note | Receipt. A drawn scratch card is announced, not revealed |
| ![Scanner](docs/screenshots/05-scan-qr.png) | ![My QR](docs/screenshots/06-my-qr.png) |
| Scanner, with manual entry as a fallback | Personal QR, encoding a `upi://pay` deep link |
| ![Transactions](docs/screenshots/07-transactions.png) | ![Scratch cards](docs/screenshots/08-scratch-cards.png) |
| History: money in/out, day grouping, statement export | Scratch cards, still under their covers |
| ![Scratch card claimed](docs/screenshots/09-scratch-card-claimed.png) | ![Coins](docs/screenshots/10-coins.png) |
| A scratch card claimed: the reward, and the balance | Coins: what is held, what it is worth, what earned it |
| ![Profile](docs/screenshots/11-profile.png) | ![Linked accounts](docs/screenshots/12-linked-accounts.png) |
| Profile: session, PIN state, sending limit | Linked accounts: sample accounts, PIN-gated balances |
| ![Notifications](docs/screenshots/13-notifications.png) | |
| Inbox: payments, requests and rewards | |

Screenshots are taken from the running application at a 420×900 phone viewport (`docs/screenshots/`, captured from the local build; the sample account is public demo data).

## Features

**Accounts and sign-in**
- OTP sign-in with server-side expiry, attempt limits and a resend cooldown
- Onboarding: name/email → generated UPI ID → 4-digit PIN with a confirm step
- Forgot PIN: a code on the registered number buys a 10-minute reset token, which writes one new PIN. No reset step signs anyone in, and the old PIN stops working immediately
- Session tokens and PIN-reset tokens are different kinds (a `typ` claim), so a reset token is refused as a `Bearer` token

**Payments**
- Transfers by mobile number or UPI ID, both showing the verified recipient name before paying
- Money requests: ask, approve with a PIN, decline, cancel. The transfer and the request closing happen in one commit
- **The PIN is verified server-side on every debit** — payments, request approvals and top-ups — behind one attempt counter: 5 wrong attempts in an IST day
- Daily sending limit (default ₹1,00,000), enforced in the ledger and reported by the same function the amount screen reads
- Top-ups from a linked account debit that account and credit the wallet in one transaction
- History with money-in/out filters, day grouping, tap-through receipts, CSV and PDF statements

**Rewards**
- Every successful payment draws 1–50 coins server-side (weighted towards 1–5; a large draw is genuinely rare). One coin is worth ₹1
- Redemption takes the whole balance once it clears 10 coins: 11 coins pay ₹11, 37 pay ₹37, with nothing rounded off and kept
- A new account gets a 50-coin welcome card, and offers pay in coins too, so there is one reward currency and one balance to watch
- **A draw counts when it is scratched, not when it is decided.** A payment stores the amount and hands over a scratch card; the coins enter the balance only when the card is claimed, so the receipt announces a card rather than a number. Until then the amount is absent from every API response, and the claim is idempotent (a conditional `UPDATE`, so a refresh or a second tap cannot pay twice)

**Everywhere**
- **Money is stored as integer paise**, and every debit is an atomic conditional update, so concurrent requests cannot overdraw a wallet
- Sessions last at most 30 minutes (clamped in code, not only in config); the client counts down from the token's own `exp` and signs out before it lapses
- UTC in the database, IST on screen (fixed +05:30; India has had no DST since 1945), and dates printed DD-MM-YYYY
- Statements, day grouping, reference codes and the daily limit all use the Indian calendar day

## Tech stack

| Layer | Choice |
| --- | --- |
| API | Flask 3, SQLAlchemy, Alembic, Gunicorn |
| Database | PostgreSQL (production), SQLite (local/tests) |
| Auth | JWT sessions, scrypt-hashed PINs and OTPs |
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS v4, React Router |
| Frontend libs | `qrcode.react` (My QR), `@yudiel/react-qr-scanner` + `barcode-detector` (scanner, code-split) |
| Statements | `reportlab` for the branded PDF, `csv` for the export |
| Tests | pytest (66 tests, Flask test client) |
| Hosting | Docker image on Render, PostgreSQL on Neon |

## Architecture

One deployable. The Docker image builds the frontend in a Node stage and serves the built bundle from Flask, so the API and the SPA share an origin: no CORS in production, no mixed content, and the camera works over the single HTTPS URL.

```
wallet-app-frontend (React + Vite)          wallet-app-backend (Flask)
        │                                            │
        │  same origin in production  ◄─────────────► │  /api/* + built SPA
        │  Vite dev server in development             │  SQLAlchemy models
        ▼                                            ▼
  React Router screens ──────────────────────►  PostgreSQL (Neon) / SQLite locally
```

```
wallet-app-backend/
  app.py               entrypoint for flask run, flask db and gunicorn
  wallet/
    __init__.py        app factory, health check, SPA serving, CLI commands
    config.py          environment-driven configuration
    models.py          User, Wallet, Transaction, Contact, LinkedAccount,
                       PaymentRequest, Notification, Reward, CoinAward (paise)
    security.py        validators, scrypt hashing, JWT, require_auth
    money.py           paise conversion, reference codes
    ledger.py          the only place money moves: atomic debit/credit
    limits.py          the daily cap window and its enforcement
    rewards.py         the offer catalogue, ledger-derived progress
    coins.py           the coin award log: the draw, the claim, redemption
    events.py          the single helper every notification is written through
    statement.py       CSV and PDF statements
    seed.py            idempotent demo data
    blueprints/        auth, wallet, people, requests, accounts, inbox
  migrations/          Alembic history
  tests/               pytest suite
wallet-app-frontend/
  src/
    App.tsx            routes, session guards, providers
    pages/             one file per screen
    components/        app shell, keypads, PIN pad, scratch card, QR views
    components/ui/     design system: Button, Card, Field, Sheet, states, icons
    lib/               typed API client, formatting, validation, feedback
    session/           auth state and cached profile/transactions
    types.ts           the API contract, in one place
  public/brand/        logo and icon artwork
  public/sounds/       the two supplied recordings
```

Client route vs API route is deliberate: screens are `/history`, `/scratch-cards`, `/my-qr`; data is `/api/transactions/<id>`, `/api/scratch-cards`, `/api/me`.

## Local setup

Node 20.19+ (or 22.12+) for the dev server; Python 3.11+ for the API database layer.

### 1. Backend

```bash
cd wallet-app-backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/python
```

Create the database and the demo data:

```bash
export FLASK_APP=app.py DEMO_MODE=true
.venv/Scripts/python -m flask db upgrade
.venv/Scripts/python -m flask seed-demo
```

Run it:

```bash
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
.venv/Scripts/python -m flask run --port 5000
```

Use `python -m flask` rather than the `flask` shim: on Windows `.venv/Scripts/flask.exe` can exit 1 with no output at all, which looks like a broken install. With `DEMO_MODE=false` there is no on-screen OTP; the code is written to the server log instead, because no SMS gateway is configured.

### 2. Frontend

```bash
cd wallet-app-frontend
npm ci
npm run dev          # http://localhost:5173, API on http://localhost:5000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production bundle into dist/
```

`npm run dev` needs Node 20.19+ or 22.12+ (Vite 7 uses `crypto.hash`, which older Node lacks). `npm run build` works on older Node, so on an old toolchain use the single-origin setup below.

### 3. Single origin (how production runs)

Flask serves the built bundle itself, so this reproduces production exactly — same origin, no CORS, no Vite dev server. Flask looks for the bundle in `STATIC_FOLDER`, which defaults to `wallet-app-backend/static_frontend`.

```bash
cd wallet-app-frontend && npm run build
cd ../wallet-app-backend
export STATIC_FOLDER="$(cd ../wallet-app-frontend/dist && pwd)"
export DEMO_MODE=true SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
.venv/Scripts/python -m flask run --port 5000
```

Open <http://127.0.0.1:5000> and sign in with mobile `9000000001`, PIN `1234`. Rebuild after every frontend change — Flask serves static files, it does not watch them. A `STATIC_FOLDER` that does not exist disables the SPA silently and `/` answers 404.

### 4. Tests

```bash
cd wallet-app-backend && .venv/Scripts/python -m pytest    # 66 tests
cd wallet-app-frontend && npm run typecheck && npm run lint && npm run build
```

The suite runs against a temporary SQLite file and covers auth and lockout, transfers and limits, requests, contacts, accounts, statements, notification scoping, the offer payouts, and the reward lifecycle (a draw is not credited until it is claimed, claiming twice credits once, and an unclaimed card carries no amount in any response).

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | local SQLite file | PostgreSQL connection string in production |
| `SECRET_KEY` | dev value | JWT signing key; use 32+ random bytes |
| `DEMO_MODE` | `false` | seeds demo data, enables `/api/demo_login`, returns the OTP in the API response |
| `DEMO_MOBILE` | `9000000001` | account used by the one-tap sample login |
| `VPA_SUFFIX` | `okwault` | suffix for generated UPI IDs |
| `MAX_DAILY_RUPEES` | `100000` | daily sending cap per account; `0` lifts it |
| `MAX_TRANSFER_RUPEES` | `100000` | ceiling for one debit (payment or request approval) |
| `MAX_TOPUP_RUPEES` | `100000` | ceiling for one top-up |
| `LIMIT_TZ_OFFSET_MINUTES` | `330` | minutes added to UTC to find the limit day's local midnight (330 = IST) |
| `OTP_TTL_MINUTES` | `5` | how long a login code stays valid |
| `OTP_FREE_REQUESTS` | `5` | codes a number may request in a row before the wait applies |
| `OTP_RESEND_SECONDS` | `60` | seconds between codes once the free requests are used |
| `CORS_ORIGINS` | `localhost:5173` | comma-separated extra browser origins |
| `JWT_EXPIRES_MINUTES` | `30` | session lifetime; a larger value is clamped to 30 |
| `STATIC_FOLDER` | `<backend>/static_frontend` | directory of the built SPA that Flask serves alongside the API |
| `PORT` | `8000` in the container, `5000` for `python app.py` | bound port; a `0` falls back to the default |

## Database

- **Local:** nothing to configure. With `DATABASE_URL` unset, the app uses SQLite (`wallet-app-backend/wallet_dev.db`).
- **Production:** a PostgreSQL string (`postgresql://user:password@host/dbname?sslmode=require`). The `psycopg2` driver is added automatically to bare URLs.
- **Schema:** Alembic. `flask db upgrade` applies migrations; `flask db migrate` drafts a new one. The container runs `flask db upgrade` on boot.
- **Seed:** `flask seed-demo` creates five sample accounts with balances and history, their contacts, one or two linked sample accounts each and the welcome coin cards. It is idempotent, so it is safe on every boot, and it is what `DEMO_MODE` uses for the one-tap login.
- **Rows written before the claim rule existed** are stamped as claimed by the migration that added it, so no existing balance changed when the rule changed; `scratched_at` is left alone, so a card that was never opened is still covered.

## Docker and Render

### Why Docker, and what the image does

The backend needs a Python runtime plus a system font, and the frontend needs a Node toolchain to build it. A container pins both, builds the bundle with the same commands used locally, and gives Render one artifact to run. It also makes the "same origin" deployment structural: the built bundle is inside the image, not uploaded beside it.

`wallet-app-backend/Dockerfile` in order:

1. **Stage 1 — `FROM node:20-alpine AS frontend`.** Copies `package.json` and `package-lock.json` first and runs `npm ci`, then copies the source and runs `npm run build`. Installing before copying the source is what keeps the dependency layer cached across code changes; `npm ci` installs the lockfile exactly, so the image cannot drift from the commit.
2. **Stage 2 — `FROM python:3.12-slim`.** A fresh runtime image. Only stage 2 ships: Node, the frontend source and `node_modules` are discarded.
3. **`ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1`.** No `.pyc` files in the layer, and logs reach Render's log stream immediately rather than being buffered.
4. **`apt-get install fonts-dejavu-core`.** The PDF statement prints a rupee sign; reportlab's built-in Helvetica has no `₹` glyph, so `wallet/statement.py` looks for a Unicode face and falls back to "INR" when it cannot find one. This is the package that provides it. `rm -rf /var/lib/apt/lists/*` in the same layer keeps the image smaller.
5. **`COPY wallet-app-backend/requirements.txt` + `pip install`.** Runtime dependencies only, installed before the application code so they are cached separately.
6. **`COPY wallet-app-backend/ ./` then `COPY --from=frontend /frontend/dist ./static_frontend`.** The API and the built SPA end up in one image, which is what lets Flask serve both from one origin — the path `STATIC_FOLDER` expects.
7. **`EXPOSE 8000`.** Documentation for humans and tooling; Render routes to `$PORT`, which is why nothing else depends on it.
8. **`CMD ["sh", "-c", "flask db upgrade && flask seed-demo && gunicorn app:app --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 60"]`.** One process tree per deploy: migrate, seed (idempotent), then serve with 2 Gunicorn workers and a 60-second timeout. `$PORT` is Render's; `8000` is the local default.

`.dockerignore` excludes `node_modules`, virtualenvs, `__pycache__`, `dist`, `.git`, `.env` and database files from the build context. Excluding `dist` is deliberate: the bundle is built *inside* the image, so a stale local build can never be shipped by accident.

### Does the image still need to exist?

Yes. Render's Docker runtime runs this image; the alternative is Render's native Python runtime, which would need the SPA built and deployed by a separate service or a build step — more moving parts for the same result. The build is reproducible and does not depend on anything outside the repository.

### The Render service name and the URL

**The Dockerfile does not contain the service name.** It never has: it is a build recipe and a start command, and neither takes a name. The name that produces the hostname lives in the Render service — `render.yaml`'s `name:` when the Blueprint creates it, or the dashboard when the service is created there.

Facts, measured on this deployment rather than assumed:

- The `*.onrender.com` subdomain is set **when the service is created**, from the service name. Renaming the service afterwards changes the dashboard label only; the old subdomain keeps answering, and the new name's host returns Render's 404. Render's documentation describes no supported way to change the subdomain of an existing service.
- To move to a new hostname, create a **new** service whose name is the hostname you want, copy the environment variables across, and delete the old service. The database is a separate resource, so nothing moves with it.
- The rename here was done that way: the app answers on **`wault-upi.onrender.com`**, the old `upi-wallet-demo` host is gone, and `render.yaml` declares `name: wault-upi` so the Blueprint and the live service agree. Rendering the service name in the Dockerfile would have changed nothing — a Dockerfile has no say in it.
- **Keep `render.yaml`'s `name:` equal to the live service's name.** Render matches Blueprint services by name, so a `name:` that does not match is not a rename: it is a second service the next Blueprint sync would create, beside the one that is actually serving.
- A **custom domain** (*Settings → Custom Domains*) is the supported way to get a branded URL: add the domain, point a `CNAME` at the service's `onrender.com` host, and Render issues the TLS certificate. The `onrender.com` subdomain keeps working until it is turned off there.
- **No host is hard-coded in the app.** The frontend talks to the origin it was served from, so a new host needs no rebuild, no environment variable and no CORS change. The only reference in the repository is the live-demo link in this README.

### Deploying

1. Push the repository to GitHub.
2. Create a PostgreSQL database (this deployment uses Neon) and copy the connection string.
3. Render → **New → Blueprint**, select the repo, and paste the string as `DATABASE_URL` when prompted. `SECRET_KEY` is generated. The service is defined in `render.yaml`: Docker runtime, `wallet-app-backend/Dockerfile`, context at the repository root, health check `/healthz`.
4. First boot runs `flask db upgrade && flask seed-demo`, so the sample accounts exist immediately.

Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a camera-only `Permissions-Policy` and HSTS. Terminate TLS in front of the container (Render does); over plain HTTP the HSTS header is ignored, which is what keeps local development on `http://` working. A request for a missing asset is an honest 404 — the SPA fallback answers extension-less client routes only, never a URL that looks like a file.

## Known limitations

- **No real UPI.** No NPCI integration, no bank connection, no real money. Payments move balances between accounts in this database.
- **Linked accounts are seeded sample data.** They stand in for the accounts a top-up could come from; they are rows in this app's database, and the Accounts screen says so on screen. See [Linked accounts](#linked-accounts-what-the-feature-is) below.
- **OTPs are not sent by SMS.** In demo mode the code is returned in the API response so the sample logins work; otherwise it is written to the server log.
- **The sample login is conditional.** The one-tap account is rendered only when `/healthz` answers `demo_mode: true` for that request, so a logged-out device with a blocked, offline or failed health call sees the ordinary sign-in form only. It comes back on a reload.
- **Reward audio is synthesised unless a recording replaces it.** `payment-success.mp3` and `coins-redeemed.mp3` are supplied recordings; the tap, error and scratch cues are generated in the browser. Browsers block audio until the first gesture, and iOS Safari has no vibration API.
- **No KYC, no mandates, no autopay.** See the roadmap.
- **Free-tier hosting.** The demo instance sleeps after ~15 minutes idle, and the PDF statement depends on the font package described above (the container installs it; a bare `python:3.12-slim` without it prints "INR" instead of `₹`).

### Linked accounts: what the feature is

The Accounts screen lists **sample bank accounts**: rows in the `linked_accounts` table, belonging to a named user, each with a bank, a holder name, a masked account number, an IFSC, an optional nickname, a default flag and a stored balance. They are seeded by `flask seed-demo` from a table in `wallet/seed.py` and attached to specific sample mobiles — the sample account `9000000001` gets two (SBI "Salary" and HDFC "Savings"), the other sample users get one each.

What they are used for:

- **Choosing where a top-up comes from.** `POST /api/topup` accepts an `account_id`; the account's stored balance is debited with a conditional `UPDATE` and the wallet is credited in the same commit — the same "cannot overdraw, cannot half-happen" shape as a transfer.
- **A PIN-gated balance check.** `POST /api/accounts/<id>/balance` reveals an account's stored balance only with the payment PIN, and the list endpoint returns masked numbers and no balance.

What they are **not**:

- Not a bank connection, and not a real account. Nothing leaves this database.
- Not the source of the wallet balance. The wallet has its own balance; a top-up moves part of a sample account into it, but the wallet total is never the sum of the linked accounts (the sample wallet holds ₹5,000 while its two sample accounts hold ₹48,250 and ₹11,240).
- Not available to a newly registered user. Only the seeded sample users have accounts, and there is no endpoint to add one, so a new account sees an empty list. Making it work for ordinary users would need an "add account" flow with ownership verification (a penny-drop or an account-aggregator provider), and a decision about where the money would actually come from.

## Roadmap

### Planned features

- [ ] Split a bill between several people
- [ ] Date-range statements and PDF receipts
- [ ] Add-a-linked-account flow for ordinary users, with a verification step (penny-drop), replacing the seeded sample accounts

### Technical improvements

- [ ] Double-entry ledger for every money movement, plus idempotency keys on transfers
- [ ] Active sessions list, "log out everywhere", account deletion
- [ ] Playwright end-to-end tests, and a CI job running typecheck, lint, build and pytest
- [ ] Structured logging and error reporting on the API

### Optional integrations

- [ ] A real SMS provider for OTP delivery (the code path already exists; only the sender is missing)
- [ ] An account-aggregator or payments provider for genuinely linked accounts — this needs provider onboarding, contractual approval and regulatory clearance before it is anything but a plan
- [ ] **KYC is not implemented and is not planned as a demo feature.** Real identity verification means a licensed provider, storing identity documents, and complying with RBI KYC rules; a portfolio project has no way to do that honestly. Any KYC work here would be limited to a UI placeholder that is clearly labelled as such, or it should be left out entirely.

### Done

- [x] OTP sign-in, onboarding, PIN with lockout
- [x] Transfers, money requests, contacts, daily limit
- [x] Notification inbox, offers, coin rewards with scratch cards
- [x] Linked sample accounts with a PIN-gated balance check
- [x] CSV and PDF statements
- [x] Forgot PIN
