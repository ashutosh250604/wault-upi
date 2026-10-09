import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _csv(name: str, default: str):
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _bool(name: str, default: str = "false"):
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _database_uri(raw: str) -> str:
    """Pin the Postgres driver to psycopg2.

    SQLAlchemy 2.1 makes psycopg (v3) the default DBAPI for a bare
    ``postgresql://`` URL, but this project ships psycopg2-binary. Hosting
    dashboards hand out driver-less URLs, so rewrite the scheme here instead of
    asking every deployer to remember ``postgresql+psycopg2://``.
    """
    for scheme in ("postgres://", "postgresql://"):
        if raw.startswith(scheme):
            return "postgresql+psycopg2://" + raw[len(scheme) :]
    return raw


class Config:
    #: The key used when SECRET_KEY is unset. `create_app` warns when it is in
    #: use, because a session signed with a published key is not a session.
    DEV_SECRET_KEY = "dev-only-secret-change-me-use-32-bytes-minimum"

    SECRET_KEY = os.getenv("SECRET_KEY", DEV_SECRET_KEY)

    # Local development uses SQLite; production uses Postgres (Neon) via DATABASE_URL.
    SQLALCHEMY_DATABASE_URI = _database_uri(
        os.getenv("DATABASE_URL", f"sqlite:///{(BASE_DIR / 'wallet_dev.db').as_posix()}")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    # Demo mode powers the public demo: seeded accounts, one-tap login and OTPs in the API response.
    DEMO_MODE = _bool("DEMO_MODE")
    DEMO_MOBILE = os.getenv("DEMO_MOBILE", "9000000001")
    VPA_SUFFIX = os.getenv("VPA_SUFFIX", "okwault")

    JWT_ALGORITHM = "HS256"
    # A wallet session is deliberately short. 30 minutes is the ceiling, and a
    # configured value above it is clamped rather than honoured, so no deploy can
    # quietly hand out a half-day login by setting an env var. The client counts
    # the same window down and signs out when it lapses.
    JWT_EXPIRES_MINUTES = min(int(os.getenv("JWT_EXPIRES_MINUTES", "30")), 30)

    OTP_TTL_MINUTES = int(os.getenv("OTP_TTL_MINUTES", "5"))
    # How many codes a number may ask for in a row before the wait kicks in.
    # Asking again and again is normal while a code is still on its way — people
    # do it whenever the SMS is slow — so the first few are free and the
    # throttle only exists to stop a script turning this into an SMS cannon.
    OTP_FREE_REQUESTS = int(os.getenv("OTP_FREE_REQUESTS", "5"))
    # Minimum seconds between two OTP requests for the same number, once the
    # free requests are used up. The client counts the same window down; the
    # server enforces it, so the button is not the only thing standing between
    # a script and a fresh code every second.
    OTP_RESEND_SECONDS = int(os.getenv("OTP_RESEND_SECONDS", "60"))
    OTP_MAX_ATTEMPTS = 3
    PIN_MAX_ATTEMPTS = 5
    PIN_LOCK_MINUTES = 15
    # How long a verified PIN-reset token stays usable. A reset is finished in
    # the same sitting it starts in — the code has just been typed — so the
    # window is minutes, not hours.
    PIN_RESET_TTL_MINUTES = int(os.getenv("PIN_RESET_TTL_MINUTES", "10"))

    MAX_TOPUP_RUPEES = 100000
    # Ceiling for any single debit: a direct payment, or paying off a request.
    MAX_TRANSFER_RUPEES = int(os.getenv("MAX_TRANSFER_RUPEES", "100000"))
    # What one account may send out in a day, enforced in the ledger. Set to 0 to
    # lift the cap entirely (a self-hosted instance may not want one).
    MAX_DAILY_RUPEES = int(os.getenv("MAX_DAILY_RUPEES", "100000"))
    # Minutes to add to UTC to get the limit day's local midnight — 330 is IST,
    # the same offset `wallet/timeutils.py` renders every timestamp with.
    LIMIT_TZ_OFFSET_MINUTES = int(os.getenv("LIMIT_TZ_OFFSET_MINUTES", "330"))

    CORS_ORIGINS = _csv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )

    # Absolute path: Flask resolves relative send_from_directory roots against the package dir.
    STATIC_FOLDER = os.path.abspath(
        os.getenv("STATIC_FOLDER", str(BASE_DIR / "static_frontend"))
    )
