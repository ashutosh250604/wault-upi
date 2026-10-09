"""Entrypoint: `flask run`, `flask db upgrade` and gunicorn all use this module."""

import os

from wallet import create_app

app = create_app()

if __name__ == "__main__":
    # The Werkzeug debugger is remote code execution by design, so it is opt-in
    # (`FLASK_DEBUG=1 python app.py`) and never the default. Production does not
    # reach this branch at all: the container runs `gunicorn app:app`, which
    # reads $PORT itself.
    #
    # PORT is honoured so a local run can be moved off 5000, but `PORT=0` — which
    # some shells export — would otherwise pick an invisible random port, so a
    # zero falls back to the documented 5000.
    app.run(
        debug=os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes"},
        port=int(os.getenv("PORT") or 5000) or 5000,
    )
