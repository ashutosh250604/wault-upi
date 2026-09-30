import logging
import os

from flask import Flask, jsonify, send_from_directory

from .config import Config
from .extensions import cors, db, migrate


def create_app(config_overrides=None):
    app = Flask(__name__, static_folder=None)
    app.config.from_object(Config)
    if config_overrides:
        app.config.update(config_overrides)

    if not app.debug:
        logging.basicConfig(level=logging.INFO)

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

    from .blueprints.auth import bp as auth_bp
    from .blueprints.people import bp as people_bp
    from .blueprints.wallet import bp as wallet_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(wallet_bp)
    app.register_blueprint(people_bp)

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
        candidate = os.path.join(static_dir, path)
        if os.path.isfile(candidate):
            return send_from_directory(static_dir, path)
        return send_from_directory(static_dir, "index.html")
