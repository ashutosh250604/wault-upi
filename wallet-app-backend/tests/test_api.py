from wallet.config import _database_uri


def test_health(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_demo_login_returns_token_and_balance(client):
    response = client.post("/demo_login")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["token"]
    assert payload["vpa"] == "9000000001@demoupi"
    assert payload["balance"] == 5000.0


def test_protected_endpoints_require_token(client):
    assert client.get("/get_balance/1").status_code == 401
    assert client.get("/transactions/1").status_code == 401
    assert client.post("/transfer", json={"receiver_id": 2, "amount": 10}).status_code == 401
    assert client.post("/vpas/resolve", json={"vpa": "9000000002@demoupi"}).status_code == 401


def test_balance_and_seeded_history(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]

    balance = client.get(f"/get_balance/{user_id}", headers=headers)
    assert balance.status_code == 200
    assert balance.get_json()["balance"] == 5000.0

    transactions = client.get(f"/transactions/{user_id}", headers=headers).get_json()
    assert len(transactions) >= 5
    assert all("timestamp" in txn and "type" in txn for txn in transactions)
    assert any(txn["type"] == "transfer" and txn["receiver_name"] for txn in transactions)


def test_cannot_touch_another_wallet(client, demo_auth):
    headers = demo_auth["headers"]
    other_id = client.post(
        "/vpas/resolve", json={"vpa": "9000000002@demoupi"}, headers=headers
    ).get_json()["user_id"]

    assert client.get(f"/get_balance/{other_id}", headers=headers).status_code == 403
    assert client.get(f"/transactions/{other_id}", headers=headers).status_code == 403
    assert (
        client.post(
            "/topup", json={"user_id": other_id, "amount": 100}, headers=headers
        ).status_code
        == 403
    )


def test_topup_then_transfer(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]

    topup = client.post(
        "/topup", json={"user_id": user_id, "amount": 1000}, headers=headers
    )
    assert topup.status_code == 200
    assert topup.get_json()["new_balance"] == 6000.0

    receiver = client.post(
        "/vpas/resolve", json={"vpa": "9000000002@demoupi"}, headers=headers
    ).get_json()
    assert receiver["name"] == "Meera Iyer"

    transfer = client.post(
        "/transfer",
        json={"receiver_id": receiver["user_id"], "amount": 100.25, "note": "lunch"},
        headers=headers,
    )
    assert transfer.status_code == 200
    assert transfer.get_json()["txn_id"].startswith("TXN")

    balance = client.get(f"/get_balance/{user_id}", headers=headers).get_json()
    assert balance["balance"] == 5899.75


def test_transfer_rejects_self_and_insufficient_funds(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    receiver = client.post(
        "/vpas/resolve", json={"vpa": "9000000002@demoupi"}, headers=headers
    ).get_json()

    self_transfer = client.post(
        "/transfer", json={"receiver_id": user_id, "amount": 10}, headers=headers
    )
    assert self_transfer.status_code == 400

    too_much = client.post(
        "/transfer",
        json={"receiver_id": receiver["user_id"], "amount": 999999},
        headers=headers,
    )
    assert too_much.status_code == 400
    assert "Insufficient" in too_much.get_json()["message"]


def test_invalid_amounts_are_rejected(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    for bad_amount in [0, -5, "abc", "", 10.555]:
        response = client.post(
            "/topup", json={"user_id": user_id, "amount": bad_amount}, headers=headers
        )
        assert response.status_code == 400, bad_amount


def test_full_onboarding_flow(client):
    start = client.post("/start_login", json={"mobile": "9876543210"})
    assert start.status_code == 200
    otp = start.get_json()["dev_otp"]

    bad = client.post("/verify_otp", json={"mobile": "9876543210", "otp": "000000"})
    assert bad.status_code == 400

    verified = client.post("/verify_otp", json={"mobile": "9876543210", "otp": otp})
    payload = verified.get_json()
    assert payload["ask_name"] is True
    headers = {"Authorization": f"Bearer {payload['token']}"}

    named = client.post(
        "/set_name", json={"name": "Dev Tester", "email": "dev@test.app"}, headers=headers
    )
    assert named.status_code == 200
    assert named.get_json()["vpa"] == "9876543210@demoupi"

    assert client.post("/set_pin", json={"pin": "4321"}, headers=headers).status_code == 200
    assert client.post("/verify_pin", json={"pin": "4321"}, headers=headers).status_code == 200
    assert client.post("/verify_pin", json={"pin": "1111"}, headers=headers).status_code == 403

    profile = client.get("/me", headers=headers).get_json()
    assert profile["name"] == "Dev Tester"
    assert profile["balance"] == 0.0

    # The user cannot pay themselves.
    self_resolve = client.post(
        "/vpas/resolve", json={"vpa": "9876543210@demoupi"}, headers=headers
    )
    assert self_resolve.status_code == 400


def test_postgres_urls_are_pinned_to_the_psycopg2_driver():
    """SQLAlchemy 2.1 defaults a bare postgresql:// URL to psycopg (v3), which
    is not installed, so hosting dashboards must not need to know the driver."""
    assert _database_uri("postgresql://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"
    assert _database_uri("postgres://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"
    assert (
        _database_uri("postgresql://u:p@h/db?sslmode=require")
        == "postgresql+psycopg2://u:p@h/db?sslmode=require"
    )

    # An explicitly chosen driver, and non-Postgres URLs, are left alone.
    assert _database_uri("postgresql+psycopg2://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"
    assert _database_uri("sqlite:///wallet_dev.db") == "sqlite:///wallet_dev.db"


def test_otp_locks_after_three_wrong_attempts(client):
    client.post("/start_login", json={"mobile": "9876543211"})
    for _ in range(3):
        response = client.post(
            "/verify_otp", json={"mobile": "9876543211", "otp": "000000"}
        )
        assert response.status_code == 400

    blocked = client.post("/verify_otp", json={"mobile": "9876543211", "otp": "000000"})
    assert blocked.status_code == 403
    assert "Too many" in blocked.get_json()["message"]
