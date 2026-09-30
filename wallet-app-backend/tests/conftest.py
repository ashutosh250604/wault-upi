import pytest

from wallet import create_app
from wallet.extensions import db as _db
from wallet.seed import seed_demo


@pytest.fixture()
def app(tmp_path):
    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret-key-that-is-long-enough-for-hs256",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
            "DEMO_MODE": True,
        }
    )
    with application.app_context():
        _db.create_all()
        seed_demo()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def demo_auth(client):
    response = client.post("/api/demo_login")
    assert response.status_code == 200
    payload = response.get_json()
    return {
        "headers": {"Authorization": f"Bearer {payload['token']}"},
        "user_id": payload["user_id"],
    }
