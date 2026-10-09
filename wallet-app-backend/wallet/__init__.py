import logging
import os

from flask import Flask, jsonify, send_from_directory

from .config import Config
from .extensions import cors, db, migrate

# Single prefix for every JSON endpoint, and never a client route.
API_PREFIX = "/api"


def create_app(config_overrides=None):
    app = Flask(__name__, static_folder=None)
    app.config.from_object(Config)
    if config_overrides:
        app.config.update(config_overrides)

    if not app.debug:
        logging.basicConfig(level=logging.INFO)

    # A session token is only as trustworthy as the key that signed it. The
    # fallback exists so a fresh clone runs with no setup, which also means a
    # deploy that forgets SECRET_KEY signs every session with a value that is
    # published in this repository. Say so in the log rather than failing the
    # start: the local-dev flow deliberately runs without one.
    if app.config["SECRET_KEY"] == Config.DEV_SECRET_KEY:
        app.logger.warning(
            "SECRET_KEY is unset and the development key is in use — set SECRET_KEY "
            "before deploying (the hosting config generates one; see .env.example)."
        )

    db.init_app(app)
    migrate.init_app(app, db)
    cors.init_app(
        app,
        resources={r"/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        # The address book edits in place, so the browser preflights PATCH/DELETE.
        methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    )

    from .blueprints.accounts import bp as accounts_bp
    from .blueprints.auth import bp as auth_bp
    from .blueprints.inbox import bp as inbox_bp
    from .blueprints.people import bp as people_bp
    from .blueprints.requests import bp as requests_bp
    from .blueprints.wallet import bp as wallet_bp

    # Everything under /api so the API can never shadow a client route. Without
    # this, `GET /requests` (the API) and `/requests` (the screen) are the same
    # path, and a browser refresh or a shared link hits the JSON endpoint
    # instead of the app. /healthz stays at the root for hosting health checks.
    app.register_blueprint(auth_bp, url_prefix=API_PREFIX)
    app.register_blueprint(wallet_bp, url_prefix=API_PREFIX)
    app.register_blueprint(people_bp, url_prefix=API_PREFIX)
    app.register_blueprint(requests_bp, url_prefix=API_PREFIX)
    app.register_blueprint(accounts_bp, url_prefix=API_PREFIX)
    app.register_blueprint(inbox_bp, url_prefix=API_PREFIX)

    @app.after_request
    def security_headers(response):
        """The browser-side protections the app can state about itself.

        A payment app is a phishing target by nature, so four headers are set
        on every response — JSON, statement download and the SPA alike:

          - `nosniff` stops a browser from second-guessing a Content-Type, which
            is how a JSON body gets treated as scriptable HTML.
          - `DENY` framing: WAULT is never embedded, and an un-framable page
            cannot be clickjacked into approving a payment.
          - `no-referrer` keeps a UPI ID or a statement URL from leaking to a
            third party through the `Referer` of an outbound link.
          - `Permissions-Policy` allows the camera — the scanner needs it — and
            switches off the sensors the app has no use for.

        HSTS is sent unconditionally because it is only honoured on an HTTPS
        response: over plain HTTP (local development) browsers ignore it, and
        behind a TLS-terminating proxy it locks the domain to HTTPS for a year.
        """
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(self), microphone=(), geolocation=()"
        )
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
        return response

    @app.get("/healthz")
    def healthz():
        # Report the live DBAPI so a deploy can prove it reached Postgres (rather
        # than silently falling back to the SQLite file inside the container).
        return jsonify(
            {
                "status": "ok",
                "demo_mode": app.config["DEMO_MODE"],
                "db": db.engine.dialect.name,
                "driver": db.engine.dialect.driver,
            }
        )

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"message": "Not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return jsonify({"message": "Method not allowed"}), 405

    @app.errorhandler(500)
    def server_error(error):
        app.logger.exception("Unhandled error: %s", error)
        return jsonify({"message": "Internal server error"}), 500

    @app.cli.command("seed-demo")
    def seed_demo_command():
        """Create the demo accounts (idempotent)."""
        from .seed import seed_demo

        seed_demo()
        print("Demo accounts are ready.")

    _register_frontend(app)
    return app


def _register_frontend(app):
    """Serve the built frontend (single origin) when it exists."""
    static_dir = app.config["STATIC_FOLDER"]
    if not static_dir or not os.path.isdir(static_dir):
        return

    @app.get("/")
    def index():
        return send_from_directory(static_dir, "index.html")

    @app.get("/<path:path>")
    def spa_assets(path):
        # An unknown /api path is a client bug, not a page: answer with JSON so
        # a typo doesn't quietly hand the app an HTML document to parse.
        if path == API_PREFIX.strip("/") or path.startswith(f"{API_PREFIX.strip('/')}/"):
            return jsonify({"message": "Not found"}), 404

        candidate = os.path.join(static_dir, path)
        if os.path.isfile(candidate):
            return send_from_directory(static_dir, path)

        # A request for a missing *file* — an image, a font, an audio cue — is a
        # 404, not the app. Handing back index.html would have the browser try to
        # decode an HTML document as a PNG or a sound, and would hide a renamed
        # or deleted asset until someone noticed the silence. Client routes never
        # carry an extension, so every extension-less path still reaches the SPA.
        if "." in os.path.basename(path):
            return jsonify({"message": "Not found"}), 404

        return send_from_directory(static_dir, "index.html")
