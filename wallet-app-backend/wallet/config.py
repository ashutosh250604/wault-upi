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
    SECRET_KEY = os.getenv(
        "SECRET_KEY", "dev-only-secret-change-me-use-32-bytes-minimum"
    )

    # Local development uses SQLite; production uses Postgres (Neon) via DATABASE_URL.
    SQLALCHEMY_DATABASE_URI = _database_uri(
        os.getenv("DATABASE_URL", f"sqlite:///{(BASE_DIR / 'wallet_dev.db').as_posix()}")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    # Demo mode powers the public demo: seeded accounts, one-tap login and OTPs in the API response.
    DEMO_MODE = _bool("DEMO_MODE")
    DEMO_MOBILE = os.getenv("DEMO_MOBILE", "9000000001")
    VPA_SUFFIX = os.getenv("VPA_SUFFIX", "demoupi")

    JWT_ALGORITHM = "HS256"
    JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "12"))

    OTP_TTL_MINUTES = int(os.getenv("OTP_TTL_MINUTES", "5"))
    OTP_MAX_ATTEMPTS = 3
    PIN_MAX_ATTEMPTS = 5
    PIN_LOCK_MINUTES = 15

    MAX_TOPUP_RUPEES = 100000

    CORS_ORIGINS = _csv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )

    # Absolute path: Flask resolves relative send_from_directory roots against the package dir.
    STATIC_FOLDER = os.path.abspath(
        os.getenv("STATIC_FOLDER", str(BASE_DIR / "static_frontend"))
    )
