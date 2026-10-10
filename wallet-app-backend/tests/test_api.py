import pathlib
from datetime import datetime, timedelta, timezone

from pytest import mark, skip

from wallet import coins
from wallet.coins import (
    AWARD_MAX_COINS,
    AWARD_MIN_COINS,
    SIGNUP_BONUS_COINS,
    award_weights,
)
from wallet.config import _database_uri
from wallet.extensions import db
from wallet.limits import day_window
from wallet.models import CoinAward, User
from wallet.timeutils import ist_date, utcnow


PIN = "1234"


def login_as(client, mobile):
    """Sign in as an existing (seeded) account through the OTP flow."""
    otp = client.post("/api/start_login", json={"mobile": mobile}).get_json()["dev_otp"]
    payload = client.post(
        "/api/verify_otp", json={"mobile": mobile, "otp": otp}
    ).get_json()
    return {
        "headers": {"Authorization": f"Bearer {payload['token']}"},
        "user_id": payload["user_id"],
    }


def onboard(client, mobile, name):
    """Walk a brand-new mobile through OTP -> name -> PIN and return its auth."""
    otp = client.post("/api/start_login", json={"mobile": mobile}).get_json()["dev_otp"]
    payload = client.post(
        "/api/verify_otp", json={"mobile": mobile, "otp": otp}
    ).get_json()
    headers = {"Authorization": f"Bearer {payload['token']}"}
    client.post("/api/set_name", json={"name": name}, headers=headers)
    client.post("/api/set_pin", json={"pin": "1234"}, headers=headers)
    return {"headers": headers, "user_id": payload["user_id"]}


def claim_every_card(client, headers):
    """Scratch every card still under a cover, returning the coins they paid.

    A card is what a payout arrives as, and the coin balance moves only when it
    is scratched — so a test about what a payout is worth has to open the cards
    that payout produced, exactly as a user does. Returns the total credited, so
    a caller can check it against what it expected the payouts to be.
    """
    credited = 0
    for card in client.get("/api/scratch-cards", headers=headers).get_json()["cards"]:
        if card["scratched"]:
            continue
        body = client.post(
            f"/api/scratch-cards/{card['id']}/scratch", headers=headers
        ).get_json()
        credited += body["credited"]
    return credited


def grant_claimed(app, client, headers, user_id, amount):
    """Write an award and claim it, which is the only way coins reach a balance.

    `coins.grant` records a draw; the card over it is what counts the coins. A
    test that wants an exact balance therefore has to do both halves, and this
    does — through the same endpoint a user's scratch goes through.
    """
    with app.app_context():
        award = CoinAward(user_id=user_id, coins=amount, reason=CoinAward.REASON_PAYMENT)
        db.session.add(award)
        db.session.commit()
        card_id = award.id

    body = client.post(f"/api/scratch-cards/{card_id}/scratch", headers=headers).get_json()
    assert body["credited"] == amount
    return body["coins"]


def test_health(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ok"
    # The test app runs on SQLite; a Postgres deploy must report "postgresql"/"psycopg2".
    assert body["db"] == "sqlite"
    assert body["driver"] == "pysqlite"


def test_every_response_carries_the_browser_side_protections(client, demo_auth):
    """The headers a payment app states about itself, on JSON and on the SPA."""
    for response in (
        client.get("/healthz"),
        client.get("/api/coins", headers=demo_auth["headers"]),
        client.post("/api/demo_login"),
    ):
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert "camera=(self)" in response.headers["Permissions-Policy"]
        # Ignored by browsers over plain HTTP, so it is safe to always send.
        assert response.headers["Strict-Transport-Security"].startswith("max-age=")


def test_a_missing_asset_is_a_404_rather_than_the_app_shell(tmp_path):
    """The SPA fallback owns client routes, not files the browser asked for.

    Answering `/sounds/payment-success.mp3` with index.html would have the
    browser decode an HTML document as a sound, and would hide a renamed or
    deleted asset behind a silent fallback until someone noticed it.
    """
    from wallet import create_app

    static = tmp_path / "dist"
    (static / "brand").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html><title>shell</title>", encoding="utf-8")
    (static / "brand" / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret-key-that-is-long-enough-for-hs256",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'spa.db').as_posix()}",
            "DEMO_MODE": True,
            "STATIC_FOLDER": str(static),
        }
    )
    spa = application.test_client()

    # An extension-less path is a client route: it still gets the app shell.
    shell = spa.get("/history")
    assert shell.status_code == 200
    assert shell.mimetype == "text/html"
    assert b"shell" in shell.data

    # A real asset is served as itself...
    assert spa.get("/brand/logo.png").status_code == 200

    # ...and one that is gone is an honest 404, not HTML wearing an asset's URL.
    missing = spa.get("/sounds/payment-success.mp3")
    assert missing.status_code == 404
    assert missing.mimetype == "application/json"


def test_demo_login_returns_token_and_balance(client):
    response = client.post("/api/demo_login")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["token"]
    assert payload["vpa"] == "9000000001@okwault"
    assert payload["balance"] == 5000.0


def test_protected_endpoints_require_token(client):
    assert client.get("/api/get_balance/1").status_code == 401
    assert client.get("/api/transactions/1").status_code == 401
    assert client.post("/api/transfer", json={"receiver_id": 2, "amount": 10}).status_code == 401
    assert client.post("/api/vpas/resolve", json={"vpa": "9000000002@okwault"}).status_code == 401


def test_balance_and_seeded_history(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]

    balance = client.get(f"/api/get_balance/{user_id}", headers=headers)
    assert balance.status_code == 200
    assert balance.get_json()["balance"] == 5000.0

    transactions = client.get(f"/api/transactions/{user_id}", headers=headers).get_json()
    assert len(transactions) >= 5
    assert all("timestamp" in txn and "type" in txn for txn in transactions)
    assert any(txn["type"] == "transfer" and txn["receiver_name"] for txn in transactions)


def test_cannot_touch_another_wallet(client, demo_auth):
    headers = demo_auth["headers"]
    other_id = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()["user_id"]

    assert client.get(f"/api/get_balance/{other_id}", headers=headers).status_code == 403
    assert client.get(f"/api/transactions/{other_id}", headers=headers).status_code == 403
    assert (
        client.post(
            "/api/topup", json={"user_id": other_id, "amount": 100}, headers=headers
        ).status_code
        == 403
    )


def test_topup_then_transfer(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]

    topup = client.post(
        "/api/topup",
        json={"user_id": user_id, "amount": 1000, "pin": PIN},
        headers=headers,
    )
    assert topup.status_code == 200
    # ₹1000 is the first qualifying top-up, so the welcome offer pays 25 coins
    # inside the same commit as the top-up itself — coins, not cash: the offer
    # moves the coin balance, and the wallet balance is only the top-up.
    assert topup.get_json()["new_balance"] == 6000.0
    assert topup.get_json()["rewards"] == [
        {
            "code": "first_topup",
            "title": "25 coins",
            "headline": "On your first top-up",
            "coins": 25,
            "amount": 25.0,
        }
    ]
    # Two cards and no coins: the welcome bonus and the offer are decided and
    # stored, and neither counts until it is scratched.
    pending = client.get("/api/coins", headers=headers).get_json()
    assert pending["coins"] == 0
    assert pending["cards_waiting"] == 2
    assert claim_every_card(client, headers) == SIGNUP_BONUS_COINS + 25
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == (
        SIGNUP_BONUS_COINS + 25
    )

    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()
    assert receiver["name"] == "Meera Iyer"

    transfer = client.post(
        "/api/transfer",
        json={
            "receiver_id": receiver["user_id"],
            "amount": 100.25,
            "note": "lunch",
            "pin": PIN,
        },
        headers=headers,
    )
    assert transfer.status_code == 200
    assert transfer.get_json()["txn_id"].startswith("TXN")
    # One payment of three, so the payments offer is still open.
    assert "rewards" not in transfer.get_json()

    balance = client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()
    assert balance["balance"] == 5899.75


def test_transfer_rejects_self_and_insufficient_funds(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()

    self_transfer = client.post(
        "/api/transfer",
        json={"receiver_id": user_id, "amount": 10, "pin": PIN},
        headers=headers,
    )
    assert self_transfer.status_code == 400

    too_much = client.post(
        "/api/transfer",
        json={"receiver_id": receiver["user_id"], "amount": 999999, "pin": PIN},
        headers=headers,
    )
    assert too_much.status_code == 400
    # Over the per-transfer ceiling, refused before the balance is even consulted.
    assert "Limit" in too_much.get_json()["message"]

    broke = client.post(
        "/api/transfer",
        json={"receiver_id": receiver["user_id"], "amount": 60000, "pin": PIN},
        headers=headers,
    )
    assert broke.status_code == 400
    assert "Insufficient" in broke.get_json()["message"]


def test_invalid_amounts_are_rejected(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    for bad_amount in [0, -5, "abc", "", 10.555]:
        response = client.post(
            "/api/topup", json={"user_id": user_id, "amount": bad_amount}, headers=headers
        )
        assert response.status_code == 400, bad_amount


def test_full_onboarding_flow(client):
    start = client.post("/api/start_login", json={"mobile": "9876543210"})
    assert start.status_code == 200
    otp = start.get_json()["dev_otp"]

    bad = client.post("/api/verify_otp", json={"mobile": "9876543210", "otp": "000000"})
    assert bad.status_code == 400

    verified = client.post("/api/verify_otp", json={"mobile": "9876543210", "otp": otp})
    payload = verified.get_json()
    assert payload["ask_name"] is True
    headers = {"Authorization": f"Bearer {payload['token']}"}

    named = client.post(
        "/api/set_name", json={"name": "Dev Tester", "email": "dev@test.app"}, headers=headers
    )
    assert named.status_code == 200
    assert named.get_json()["vpa"] == "9876543210@okwault"

    # Half-onboarded: named, but no PIN yet — the client uses this to route
    # the user back to the PIN step.
    assert client.get("/api/me", headers=headers).get_json()["has_pin"] is False

    assert client.post("/api/set_pin", json={"pin": "4321"}, headers=headers).status_code == 200
    assert client.post("/api/verify_pin", json={"pin": "4321"}, headers=headers).status_code == 200
    assert client.post("/api/verify_pin", json={"pin": "1111"}, headers=headers).status_code == 403

    profile = client.get("/api/me", headers=headers).get_json()
    assert profile["name"] == "Dev Tester"
    assert profile["balance"] == 0.0
    assert profile["has_pin"] is True

    # The user cannot pay themselves.
    self_resolve = client.post(
        "/api/vpas/resolve", json={"vpa": "9876543210@okwault"}, headers=headers
    )
    assert self_resolve.status_code == 400


def test_transfer_requires_a_pin_that_the_server_verifies(client, demo_auth):
    headers = demo_auth["headers"]
    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()["user_id"]

    # A stolen token alone must not be able to move money.
    missing = client.post(
        "/api/transfer", json={"receiver_id": receiver, "amount": 10}, headers=headers
    )
    assert missing.status_code == 400

    wrong = client.post(
        "/api/transfer",
        json={"receiver_id": receiver, "amount": 10, "pin": "9999"},
        headers=headers,
    )
    assert wrong.status_code == 403
    assert "Incorrect PIN" in wrong.get_json()["message"]

    # Neither attempt touched the balance.
    assert client.get(f"/api/get_balance/{demo_auth['user_id']}", headers=headers).get_json()[
        "balance"
    ] == 5000.0

    ok = client.post(
        "/api/transfer",
        json={"receiver_id": receiver, "amount": 10, "pin": PIN},
        headers=headers,
    )
    assert ok.status_code == 200
    assert client.get(f"/api/get_balance/{demo_auth['user_id']}", headers=headers).get_json()[
        "balance"
    ] == 4990.0


def test_pin_lockout_is_shared_by_every_debit_path(client, demo_auth):
    headers = demo_auth["headers"]
    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()["user_id"]

    for _ in range(5):
        client.post(
            "/api/transfer",
            json={"receiver_id": receiver, "amount": 10, "pin": "9999"},
            headers=headers,
        )

    # Wrong attempts through /transfer lock the PIN for /verify_pin too — the
    # counter cannot be sidestepped by picking a different endpoint.
    locked = client.post("/api/verify_pin", json={"pin": PIN}, headers=headers)
    assert locked.status_code == 403
    assert "locked" in locked.get_json()["message"].lower()

    refused = client.post(
        "/api/transfer",
        json={"receiver_id": receiver, "amount": 10, "pin": PIN},
        headers=headers,
    )
    assert refused.status_code == 403


def test_request_lifecycle_ends_in_a_real_transfer(client, demo_auth):
    aarav = demo_auth
    meera = login_as(client, "9000000002")

    created = client.post(
        "/api/requests",
        json={"identifier": "9000000002", "amount": 300, "note": "Dinner"},
        headers=aarav["headers"],
    )
    assert created.status_code == 201
    request_id = created.get_json()["id"]
    assert created.get_json()["direction"] == "outgoing"
    assert created.get_json()["status"] == "pending"
    assert created.get_json()["counterparty"]["name"] == "Meera Iyer"

    # The payer sees the ask, the requester does not see it as "waiting for you".
    incoming = client.get("/api/requests", headers=meera["headers"]).get_json()
    assert [row for row in incoming if row["id"] == request_id][0]["direction"] == "incoming"

    # Only the person who was asked can approve or refuse it.
    assert (
        client.post(
            f"/api/requests/{request_id}/pay", json={"pin": PIN}, headers=aarav["headers"]
        ).status_code
        == 403
    )

    wrong_pin = client.post(
        f"/api/requests/{request_id}/pay", json={"pin": "9999"}, headers=meera["headers"]
    )
    assert wrong_pin.status_code == 403
    assert (
        client.get(f"/api/get_balance/{meera['user_id']}", headers=meera["headers"]).get_json()[
            "balance"
        ]
        == 2500.0
    )

    paid = client.post(
        f"/api/requests/{request_id}/pay", json={"pin": PIN}, headers=meera["headers"]
    )
    assert paid.status_code == 200
    assert paid.get_json()["txn_id"].startswith("TXN")
    assert paid.get_json()["request"]["status"] == "paid"

    # Money moved, in both directions, and the ledger shows it as a real payment.
    assert (
        client.get(f"/api/get_balance/{meera['user_id']}", headers=meera["headers"]).get_json()[
            "balance"
        ]
        == 2200.0
    )
    # 5000 + the 300 received. The "when someone pays you" offer unlocked by
    # arriving money pays Aarav 10 coins, which is not wallet money — the
    # balance is the transfer alone.
    assert (
        client.get(f"/api/get_balance/{aarav['user_id']}", headers=aarav["headers"]).get_json()[
            "balance"
        ]
        == 5300.0
    )
    # The welcome bonus and the "when someone pays you" offer are cards; the
    # offer's 10 coins count when Aarav scratches them.
    assert client.get("/api/coins", headers=aarav["headers"]).get_json()["coins"] == 0
    assert claim_every_card(client, aarav["headers"]) == SIGNUP_BONUS_COINS + 10
    assert client.get("/api/coins", headers=aarav["headers"]).get_json()["coins"] == (
        SIGNUP_BONUS_COINS + 10
    )
    ledger = client.get(
        f"/api/transactions/{meera['user_id']}", headers=meera["headers"]
    ).get_json()
    assert ledger[0]["note"] == "Dinner"
    assert ledger[0]["receiver_name"] == "Aarav Sharma"

    # Paying twice is refused rather than moving the money again.
    again = client.post(
        f"/api/requests/{request_id}/pay", json={"pin": PIN}, headers=meera["headers"]
    )
    assert again.status_code == 409
    assert "already paid" in again.get_json()["message"]


def test_request_a_payer_cannot_cover_stays_open(client, demo_auth):
    aarav = demo_auth
    meera = login_as(client, "9000000002")

    created = client.post(
        "/api/requests", json={"identifier": "9000000002", "amount": 9000}, headers=aarav["headers"]
    ).get_json()

    refused = client.post(
        f"/api/requests/{created['id']}/pay", json={"pin": PIN}, headers=meera["headers"]
    )
    assert refused.status_code == 400
    assert "Insufficient" in refused.get_json()["message"]

    # The failed approval must not leave a half-settled request behind.
    still_open = client.get("/api/requests", headers=meera["headers"]).get_json()
    assert [row for row in still_open if row["id"] == created["id"]][0]["status"] == "pending"
    assert (
        client.get(f"/api/get_balance/{meera['user_id']}", headers=meera["headers"]).get_json()[
            "balance"
        ]
        == 2500.0
    )


def test_decline_and_cancel_are_role_scoped_and_move_no_money(client, demo_auth):
    aarav = demo_auth
    meera = login_as(client, "9000000002")

    created = client.post(
        "/api/requests", json={"identifier": "9000000002", "amount": 50}, headers=aarav["headers"]
    ).get_json()

    assert (
        client.post(f"/api/requests/{created['id']}/decline", headers=aarav["headers"]).status_code
        == 403
    )
    assert (
        client.post(f"/api/requests/{created['id']}/cancel", headers=meera["headers"]).status_code
        == 403
    )

    declined = client.post(f"/api/requests/{created['id']}/decline", headers=meera["headers"])
    assert declined.status_code == 200
    assert declined.get_json()["status"] == "declined"
    assert declined.get_json()["resolved_at"]

    # A closed request can't be closed twice, or paid afterwards.
    assert (
        client.post(f"/api/requests/{created['id']}/decline", headers=meera["headers"]).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/requests/{created['id']}/pay", json={"pin": PIN}, headers=meera["headers"]
        ).status_code
        == 409
    )

    cancelled = client.post(
        "/api/requests", json={"identifier": "9000000002", "amount": 60}, headers=aarav["headers"]
    ).get_json()
    assert (
        client.post(f"/api/requests/{cancelled['id']}/cancel", headers=aarav["headers"]).get_json()[
            "status"
        ]
        == "cancelled"
    )

    assert (
        client.get(f"/api/get_balance/{aarav['user_id']}", headers=aarav["headers"]).get_json()[
            "balance"
        ]
        == 5000.0
    )


def test_request_validation_and_third_party_isolation(client, demo_auth):
    headers = demo_auth["headers"]

    assert (
        client.post("/api/requests", json={"identifier": "9000000001", "amount": 10}, headers=headers)
        .status_code
        == 400
    )
    assert (
        client.post("/api/requests", json={"identifier": "9000000002", "amount": 0}, headers=headers)
        .status_code
        == 400
    )
    assert (
        client.post("/api/requests", json={"identifier": "9111111111", "amount": 10}, headers=headers)
        .status_code
        == 404
    )
    assert client.post("/api/requests", json={"amount": 10}, headers=headers).status_code == 400

    request_id = client.post(
        "/api/requests", json={"identifier": "9000000002", "amount": 10}, headers=headers
    ).get_json()["id"]

    stranger = onboard(client, "9000000955", "Nosy Parker")
    assert client.get("/api/requests", headers=stranger["headers"]).get_json() == []
    # 404, not 403: a stranger can't even confirm the request exists.
    assert (
        client.post(
            f"/api/requests/{request_id}/pay", json={"pin": PIN}, headers=stranger["headers"]
        ).status_code
        == 404
    )


def test_asking_twice_for_the_same_amount_refreshes_the_open_request(client, demo_auth):
    headers = demo_auth["headers"]

    first = client.post(
        "/api/requests",
        json={"identifier": "9000000002", "amount": 75, "note": "chai"},
        headers=headers,
    )
    assert first.status_code == 201

    second = client.post(
        "/api/requests",
        json={"identifier": "9000000002", "amount": 75, "note": "chai for two"},
        headers=headers,
    )
    assert second.status_code == 200
    assert second.get_json()["id"] == first.get_json()["id"]
    assert second.get_json()["note"] == "chai for two"

    pending = [
        row
        for row in client.get("/api/requests", headers=headers).get_json()
        if row["status"] == "pending"
    ]
    assert len(pending) == 1


def test_accounts_are_listed_default_first_and_only_one_is_default(client, demo_auth):
    headers = demo_auth["headers"]

    accounts = client.get("/api/accounts", headers=headers).get_json()
    assert len(accounts) == 2
    assert accounts[0]["is_default"] is True
    # The masked number is the only account identifier the client ever sees.
    assert accounts[0]["masked_number"].startswith("•••• ")
    assert len(accounts[0]["account_last4"]) == 4
    assert "balance" not in accounts[0]

    switched = client.post(f"/api/accounts/{accounts[1]['id']}/default", headers=headers)
    assert switched.status_code == 200
    assert switched.get_json()["account"]["is_default"] is True

    refreshed = client.get("/api/accounts", headers=headers).get_json()
    assert [item["is_default"] for item in refreshed] == [True, False]
    assert refreshed[0]["id"] == accounts[1]["id"]

    # Another user's account is invisible, and can't be switched or read.
    other = login_as(client, "9000000002")
    assert (
        client.post(
            f"/api/accounts/{accounts[0]['id']}/default", headers=other["headers"]
        ).status_code
        == 404
    )


def test_checking_a_linked_balance_requires_the_pin(client, demo_auth):
    headers = demo_auth["headers"]
    account = client.get("/api/accounts", headers=headers).get_json()[0]

    assert (
        client.post(f"/api/accounts/{account['id']}/balance", json={}, headers=headers).status_code
        == 400
    )
    wrong = client.post(
        f"/api/accounts/{account['id']}/balance", json={"pin": "9999"}, headers=headers
    )
    assert wrong.status_code == 403
    assert "Incorrect PIN" in wrong.get_json()["message"]

    ok = client.post(
        f"/api/accounts/{account['id']}/balance", json={"pin": PIN}, headers=headers
    )
    assert ok.status_code == 200
    assert ok.get_json()["balance"] == 48250.0
    assert ok.get_json()["checked_at"]


def test_topup_from_a_linked_account_debits_it_and_needs_a_pin(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    account = client.get("/api/accounts", headers=headers).get_json()[0]

    no_pin = client.post(
        "/api/topup",
        json={"user_id": user_id, "amount": 500, "account_id": account["id"]},
        headers=headers,
    )
    assert no_pin.status_code == 400
    assert (
        client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()["balance"]
        == 5000.0
    )

    okay = client.post(
        "/api/topup",
        json={"user_id": user_id, "amount": 500, "account_id": account["id"], "pin": PIN},
        headers=headers,
    )
    assert okay.status_code == 200
    # ₹500 clears the ₹100 first-top-up threshold, so the offer's 25 coins ride
    # along — in the coin balance, not in this one.
    assert okay.get_json()["new_balance"] == 5500.0
    assert okay.get_json()["account"]["balance"] == 47750.0

    # A top-up larger than the linked account holds is refused outright.
    too_big = client.post(
        "/api/topup",
        json={"user_id": user_id, "amount": 90000, "account_id": account["id"], "pin": PIN},
        headers=headers,
    )
    assert too_big.status_code == 400
    assert "doesn't have that much" in too_big.get_json()["message"]
    assert (
        client.get(f"/api/accounts", headers=headers).get_json()[0]["is_default"] is True
    )

    # Someone else's account is not a valid funding source.
    other = login_as(client, "9000000002")
    assert (
        client.post(
            "/api/topup",
            json={
                "user_id": other["user_id"],
                "amount": 10,
                "account_id": account["id"],
                "pin": PIN,
            },
            headers=other["headers"],
        ).status_code
        == 404
    )


def test_statement_csv_exports_only_the_callers_ledger(client, demo_auth):
    headers = demo_auth["headers"]

    response = client.get("/api/statements.csv", headers=headers)
    assert response.status_code == 200
    assert response.mimetype == "text/csv"
    assert "attachment" in response.headers["Content-Disposition"]
    assert "okwault-statement" in response.headers["Content-Disposition"]

    text = response.get_data(as_text=True)
    rows = text.strip().splitlines()
    assert rows[0].startswith("Date,Time,Reference,Type,Direction")
    assert len(rows) > 5
    # Amounts are signed from the statement owner's point of view.
    assert any(line.split(",")[7].startswith("-") for line in rows[1:])
    assert "Credit" in text
    # Meera's statement must not leak into Aarav's file.
    meera = login_as(client, "9000000002")
    meera_text = client.get("/api/statements.csv", headers=meera["headers"]).get_data(
        as_text=True
    )
    assert meera_text != text
    assert "Aarav Sharma" in meera_text

    # A month filter narrows the window instead of exporting everything.
    filtered = client.get("/api/statements.csv?month=2020-01", headers=headers)
    assert filtered.status_code == 200
    assert len(filtered.get_data(as_text=True).strip().splitlines()) == 1


@mark.parametrize("bad_month", ["2026-13", "nonsense"])
def test_statement_ignores_an_unparseable_month(client, demo_auth, bad_month):
    response = client.get(
        f"/api/statements.csv?month={bad_month}", headers=demo_auth["headers"]
    )
    assert response.status_code == 200
    # Falls back to the full statement rather than erroring on a bad query.
    assert len(response.get_data(as_text=True).strip().splitlines()) > 1


def test_statement_pdf_is_a_scoped_download(client, demo_auth):
    headers = demo_auth["headers"]

    response = client.get("/api/statements.pdf", headers=headers)
    assert response.status_code == 200
    assert response.mimetype == "application/pdf"
    assert "attachment" in response.headers["Content-Disposition"]
    assert "okwault-statement" in response.headers["Content-Disposition"]
    assert response.headers["Content-Disposition"].endswith('.pdf"')
    # A real PDF, not an error page wearing the right mimetype.
    assert response.data.startswith(b"%PDF")
    assert len(response.data) > 2000

    assert client.get("/api/statements.pdf").status_code == 401

    # Another account downloads its own statement, not this one.
    meera = login_as(client, "9000000002")
    assert client.get("/api/statements.pdf", headers=meera["headers"]).data != response.data


def test_statement_pdf_brands_the_period_it_was_asked_for(client, demo_auth):
    headers = demo_auth["headers"]

    empty = client.get(
        "/api/statements.pdf?from=2020-01-01&to=2020-01-31", headers=headers
    )
    # An empty window is still a valid statement — it just says so.
    assert empty.status_code == 200
    assert empty.data.startswith(b"%PDF")

    full = client.get("/api/statements.pdf", headers=headers)
    assert len(full.data) > len(empty.data)


def test_statement_window_labels_and_fallbacks():
    """The window is the user's calendar month, not the server's.

    Its boundaries are IST midnights converted to UTC, so September runs from
    18:30 UTC on 31 August — which is exactly midnight on the 1st in India. A
    statement that started at UTC midnight would file a payment made at 1am IST
    on the 1st under the previous month.
    """
    from wallet.blueprints.accounts import _statement_window

    start, end, label = _statement_window({"month": "2026-09"})
    assert label == "September 2026"
    assert (start.month, start.day, start.hour, start.minute) == (8, 31, 18, 30)
    assert (end.month, end.day, end.hour, end.minute) == (9, 30, 18, 30)

    start, end, label = _statement_window({"from": "2026-09-01", "to": "2026-09-30"})
    assert label == "01-09-2026 to 30-09-2026"
    # `to` is inclusive: the window closes at IST midnight on 1 October.
    assert (start.month, start.day, start.hour, start.minute) == (8, 31, 18, 30)
    assert (end.month, end.day, end.hour, end.minute) == (9, 30, 18, 30)

    # Anything missing or unparseable falls back to the whole statement.
    assert _statement_window({"from": "yesterday"})[2] == "All transactions"
    assert _statement_window({"from": "2026-09-30", "to": "2026-09-01"})[2] == "All transactions"
    assert _statement_window({})[2] == "All transactions"
    assert _statement_window({"from": "2026-09-01"})[1:] == (None, "From 01-09-2026")


def test_times_are_rendered_in_ist():
    """One conversion rule for the whole backend: store UTC, show IST."""
    from datetime import datetime, timezone

    from wallet.timeutils import format_date, format_datetime, to_ist

    # 20:30 UTC on 30 September is 02:00 on 1 October in India — the case that
    # makes a UTC-rendered date wrong rather than merely different.
    late = datetime(2026, 9, 30, 20, 30, tzinfo=timezone.utc)
    assert format_date(late) == "01-10-2026"
    assert format_datetime(late) == "01-10-2026, 02:00"
    assert to_ist(late).utcoffset().total_seconds() == 19800
    # SQLite hands back naive datetimes; they are UTC, never local time.
    assert format_date(datetime(2026, 9, 30, 20, 30)) == "01-10-2026"


def test_sessions_last_thirty_minutes(client):
    """A wallet session is half an hour, and a token says so."""
    from datetime import datetime, timedelta, timezone

    from wallet.security import issue_token, token_expiry

    config = client.application.config
    assert config["JWT_EXPIRES_MINUTES"] == 30
    assert "JWT_EXPIRES_HOURS" not in config

    issued = datetime(2026, 10, 6, 9, 0, tzinfo=timezone.utc)
    with client.application.app_context():
        assert token_expiry(issued) == issued + timedelta(minutes=30)
        # The claim in the token itself is the same half hour.
        import jwt

        # Minted now, so this one decodes on its own merits: whatever the clock
        # says, a fresh token is good for exactly 30 minutes.
        claims = jwt.decode(
            issue_token(7),
            config["SECRET_KEY"],
            algorithms=[config["JWT_ALGORITHM"]],
        )
        assert claims["exp"] - claims["iat"] == 1800


def test_the_session_ceiling_is_clamped_whatever_the_env_says(monkeypatch):
    """A deploy asking for a 12-hour login gets 30 minutes instead.

    The ceiling has to live in code rather than in the default, or "maximum 30
    minutes" is only true until somebody sets an environment variable.
    """
    import importlib

    import wallet.config as config_module

    monkeypatch.setenv("JWT_EXPIRES_MINUTES", "720")
    try:
        reloaded = importlib.reload(config_module)
        assert reloaded.Config.JWT_EXPIRES_MINUTES == 30
    finally:
        monkeypatch.delenv("JWT_EXPIRES_MINUTES", raising=False)
        importlib.reload(config_module)


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


def test_resolve_accepts_mobile_numbers_as_well_as_upi_ids(client, demo_auth):
    headers = demo_auth["headers"]

    by_mobile = client.post("/api/payees/resolve", json={"mobile": "9000000002"}, headers=headers)
    assert by_mobile.status_code == 200
    assert by_mobile.get_json()["name"] == "Meera Iyer"

    # +91 / spaced input is normalised rather than rejected.
    messy = client.post("/api/payees/resolve", json={"identifier": "+91 90000 00002"}, headers=headers)
    assert messy.status_code == 200
    assert messy.get_json()["user_id"] == by_mobile.get_json()["user_id"]

    assert (
        client.post("/api/payees/resolve", json={"identifier": "not a handle"}, headers=headers)
        .status_code
        == 400
    )
    assert (
        client.post("/api/payees/resolve", json={"mobile": "9111111111"}, headers=headers)
        .status_code
        == 404
    )
    # Paying yourself, and paying a wallet that never finished onboarding.
    assert (
        client.post("/api/payees/resolve", json={"mobile": "9000000001"}, headers=headers)
        .status_code
        == 400
    )
    # A wallet that verified by OTP but never finished onboarding has no name to
    # show the payer, so it must not be payable.
    otp = client.post("/api/start_login", json={"mobile": "9000000999"}).get_json()["dev_otp"]
    client.post("/api/verify_otp", json={"mobile": "9000000999", "otp": otp})
    blank = client.post("/api/payees/resolve", json={"mobile": "9000000999"}, headers=headers)
    assert blank.status_code == 409
    assert "finished setting up" in blank.get_json()["message"]


def test_contacts_crud_is_idempotent_and_owner_scoped(client, demo_auth):
    headers = demo_auth["headers"]
    saved_count = len(client.get("/api/contacts", headers=headers).get_json())

    # The seeded address book already holds a few demo people.
    assert saved_count >= 4

    onboard(client, "9000000088", "Dev Friend")
    first = client.post(
        "/api/contacts", json={"identifier": "9000000088", "nickname": "Dev Friend"}, headers=headers
    )
    assert first.status_code == 201
    contact_id = first.get_json()["id"]
    assert first.get_json()["nickname"] == "Dev Friend"
    assert first.get_json()["name"] == "Dev Friend"

    # Saving the same person again updates instead of duplicating.
    again = client.post("/api/contacts", json={"identifier": "9000000088@okwault"}, headers=headers)
    assert again.status_code == 200
    assert again.get_json()["id"] == contact_id

    listed = client.get("/api/contacts", headers=headers).get_json()
    assert len([c for c in listed if c["user_id"] == again.get_json()["user_id"]]) == 1
    assert len(listed) == saved_count + 1

    starred = client.patch(
        f"/api/contacts/{contact_id}", json={"is_favourite": True}, headers=headers
    )
    assert starred.status_code == 200
    assert starred.get_json()["is_favourite"] is True

    # A second user cannot see or touch the first user's address book.
    other = onboard(client, "9000000977", "Nosy Neighbour")
    assert client.get("/api/contacts", headers=other["headers"]).get_json() == []
    assert (
        client.delete(f"/api/contacts/{contact_id}", headers=other["headers"]).status_code == 404
    )
    assert (
        client.patch(
            f"/api/contacts/{contact_id}", json={"is_favourite": True}, headers=other["headers"]
        ).status_code
        == 404
    )

    assert client.delete(f"/api/contacts/{contact_id}", headers=headers).status_code == 200
    assert len(client.get("/api/contacts", headers=headers).get_json()) == saved_count


def test_contacts_reject_self_unknown_and_bad_input(client, demo_auth):
    headers = demo_auth["headers"]
    assert (
        client.post("/api/contacts", json={"identifier": "9000000001"}, headers=headers).status_code
        == 400
    )
    assert (
        client.post("/api/contacts", json={"identifier": "9111111111"}, headers=headers).status_code
        == 404
    )
    assert client.post("/api/contacts", json={"identifier": "x"}, headers=headers).status_code == 400


def test_people_recent_ranks_recency_then_appends_saved_contacts(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]

    recent = client.get("/api/people/recent", headers=headers).get_json()
    assert len(recent) >= 4
    # Meera is the only seeded counterparty paid more than once.
    assert recent[0]["name"] == "Meera Iyer"
    assert recent[0]["txn_count"] == 3
    assert recent[0]["is_saved"] is True

    # A saved contact with no history yet still shows up, ranked last.
    stranger = onboard(client, "9000000988", "Nikhil Rao")
    client.post("/api/contacts", json={"identifier": "9000000988"}, headers=headers)
    recent = client.get("/api/people/recent", headers=headers).get_json()
    last = recent[-1]
    assert last["user_id"] == stranger["user_id"]
    assert last["txn_count"] == 0
    assert last["is_saved"] is True

    # limit is honoured and clamped.
    assert len(client.get("/api/people/recent?limit=2", headers=headers).get_json()) == 2
    assert len(client.get("/api/people/recent?limit=999", headers=headers).get_json()) <= 20


def test_transfer_stamps_last_paid_on_a_saved_contact(client, demo_auth):
    headers = demo_auth["headers"]
    payee = onboard(client, "9000000966", "Paid Person")

    saved = client.post(
        "/api/contacts", json={"identifier": "9000000966"}, headers=headers
    ).get_json()
    assert saved["last_paid_at"] is None

    client.post("/api/topup", json={"user_id": demo_auth["user_id"], "amount": 500}, headers=headers)
    assert (
        client.post(
            "/api/transfer",
            json={
                "receiver_id": payee["user_id"],
                "amount": 25,
                "note": "chai",
                "pin": PIN,
            },
            headers=headers,
        ).status_code
        == 200
    )

    refreshed = client.get("/api/contacts", headers=headers).get_json()[0]
    assert refreshed["last_paid_at"] is not None

    recent = client.get("/api/people/recent", headers=headers).get_json()
    assert recent[0]["user_id"] == payee["user_id"]
    assert recent[0]["last_note"] == "chai"
    assert recent[0]["last_direction"] == "out"


def test_otp_locks_after_three_wrong_attempts(client):
    client.post("/api/start_login", json={"mobile": "9876543211"})
    for _ in range(3):
        response = client.post(
            "/api/verify_otp", json={"mobile": "9876543211", "otp": "000000"}
        )
        assert response.status_code == 400

    blocked = client.post("/api/verify_otp", json={"mobile": "9876543211", "otp": "000000"})
    assert blocked.status_code == 403
    assert "Too many" in blocked.get_json()["message"]


def test_the_first_five_otp_requests_are_free_and_the_sixth_waits(client, app):
    """A slow SMS is not a reason to throttle anyone.

    Asking again while a code is still on its way is what everyone does, so the
    first `OTP_FREE_REQUESTS` requests for a number go through unchallenged and
    carry no wait. Only the request after them is held back, and the hold is
    enforced here rather than by the client's resend button.
    """
    mobile = "9876500001"
    free = app.config["OTP_FREE_REQUESTS"]
    assert free >= 2, "the free-request rule is what this test is about"

    for index in range(free - 1):
        answer = client.post("/api/start_login", json={"mobile": mobile})
        assert answer.status_code == 200, f"request {index + 1} of {free} should be free"
        body = answer.get_json()
        # No wait to announce while requests are still free, so the screen has
        # no countdown to show and nothing to disable.
        assert body["resend_available_at"] is None
        assert body["requests_remaining"] == free - index - 1

    # The last free request is where the window opens: it succeeds, and it
    # carries the instant the next one may be made — which is what the client's
    # countdown runs on, instead of a second clock it started itself.
    fifth = client.post("/api/start_login", json={"mobile": mobile})
    assert fifth.status_code == 200
    assert fifth.get_json()["requests_remaining"] == 0
    assert fifth.get_json()["resend_available_at"] is not None

    assert client.post("/api/start_login", json={"mobile": mobile}).status_code == 429
    sixth = client.post("/api/start_login", json={"mobile": mobile})
    assert sixth.status_code == 429
    body = sixth.get_json()
    assert "wait" in body["message"].lower()
    assert body["retry_after"] > 0
    stamp = datetime.fromisoformat(body["resend_available_at"])
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    # The hold is the configured window, counted from the request that ran out.
    # Generous on the low side: the clock has moved on since that request was
    # stamped, and the whole suite is slow enough here for a second or two of
    # drift to be the test's fault rather than the endpoint's.
    window = app.config["OTP_RESEND_SECONDS"]
    left = stamp - utcnow()
    assert timedelta(seconds=window - 10) <= left <= timedelta(seconds=window), (
        f"{left.total_seconds():.1f}s left of a {window}s window"
    )

    # The refusals must not have invalidated the code already issued.
    otp = fifth.get_json()["dev_otp"]
    assert (
        client.post("/api/verify_otp", json={"mobile": mobile, "otp": otp}).status_code == 200
    )

    # Verifying ends the run: the next sign-in starts with its free requests
    # again, rather than inheriting a throttle from a login that succeeded.
    restarted = client.post("/api/start_login", json={"mobile": mobile})
    assert restarted.status_code == 200
    assert restarted.get_json()["requests_remaining"] == free - 1

    # A run that lapsed is over too: a code nobody used has expired, so asking
    # again hours later is not "the sixth request", it is the first.
    with app.app_context():
        ttl = app.config["OTP_TTL_MINUTES"]
        user = User.query.filter_by(mobile=mobile).first()
        user.last_otp_sent_at = utcnow() - timedelta(minutes=ttl + 1)
        db.session.commit()
    assert client.post("/api/start_login", json={"mobile": mobile}).status_code == 200


def test_the_inbox_logs_both_sides_of_a_payment(client, demo_auth):
    aarav = demo_auth
    meera = login_as(client, "9000000002")
    payee = client.post(
        "/api/vpas/resolve",
        json={"vpa": "9000000002@okwault"},
        headers=aarav["headers"],
    ).get_json()["user_id"]

    client.post(
        "/api/topup",
        json={"user_id": aarav["user_id"], "amount": 100, "pin": PIN},
        headers=aarav["headers"],
    )
    assert (
        client.post(
            "/api/transfer",
            json={"receiver_id": payee, "amount": 100, "note": "lunch", "pin": PIN},
            headers=aarav["headers"],
        ).status_code
        == 200
    )

    inbox = client.get("/api/notifications", headers=aarav["headers"]).get_json()
    assert inbox["unread_count"] >= 1
    # The payment and the coins it paid out are two notes, written together.
    sent = [row for row in inbox["notifications"] if row["kind"] == "money_sent"][0]
    assert sent["kind"] == "money_sent"
    assert sent["title"] == "Money sent to Meera Iyer"
    assert sent["body"] == "lunch"
    assert sent["amount"] == 100.0
    assert sent["is_read"] is False
    assert sent["reference"].startswith("TXN")

    # The payee's inbox describes the same ledger row from the other side.
    mine = client.get("/api/notifications", headers=meera["headers"]).get_json()
    received = [row for row in mine["notifications"] if row["kind"] == "money_received"]
    assert received[0]["title"] == "Money received from Aarav Sharma"
    assert received[0]["amount"] == 100.0


def test_a_request_and_a_refusal_both_reach_the_other_person(client, demo_auth):
    aarav = demo_auth
    meera = login_as(client, "9000000002")

    created = client.post(
        "/api/requests",
        json={"identifier": "9000000002", "amount": 250, "note": "cabs"},
        headers=aarav["headers"],
    ).get_json()

    asked = client.get("/api/notifications", headers=meera["headers"]).get_json()
    assert asked["notifications"][0]["kind"] == "request_received"
    assert asked["notifications"][0]["title"] == "Aarav Sharma asked you for money"
    assert asked["notifications"][0]["amount"] == 250.0

    client.post(f"/api/requests/{created['id']}/decline", headers=meera["headers"])
    told = client.get("/api/notifications", headers=aarav["headers"]).get_json()
    assert told["notifications"][0]["kind"] == "request_declined"
    assert told["notifications"][0]["title"] == "Meera Iyer declined your request"


def test_inbox_rows_can_be_read_marked_cleared_and_deleted(client, demo_auth):
    headers = demo_auth["headers"]
    inbox = client.get("/api/notifications", headers=headers).get_json()
    note_id = inbox["notifications"][0]["id"]
    assert inbox["unread_count"] >= 2

    read = client.post(f"/api/notifications/{note_id}/read", headers=headers)
    assert read.status_code == 200
    assert read.get_json()["notification"]["is_read"] is True
    assert read.get_json()["unread_count"] == inbox["unread_count"] - 1

    cleared = client.post("/api/notifications/read-all", headers=headers)
    assert cleared.status_code == 200
    assert cleared.get_json()["unread_count"] == 0
    assert cleared.get_json()["marked"] == inbox["unread_count"] - 1

    removed = client.delete(f"/api/notifications/{note_id}", headers=headers)
    assert removed.status_code == 200
    remaining = client.get("/api/notifications", headers=headers).get_json()
    assert all(row["id"] != note_id for row in remaining["notifications"])


def test_the_inbox_and_rewards_are_owner_scoped_and_need_a_token(client, demo_auth):
    stranger = onboard(client, "9000000944", "Quiet Stranger")
    aarav_note = client.get("/api/notifications", headers=demo_auth["headers"]).get_json()[
        "notifications"
    ][0]["id"]

    assert client.get("/api/notifications").status_code == 401
    assert client.get("/api/rewards").status_code == 401
    assert client.get("/api/limits").status_code == 401

    # The stranger's inbox holds only their own news — signing in, setting a PIN,
    # and the welcome scratch card every new account is handed — and none of
    # Aarav's ledger activity leaks across.
    stranger_inbox = client.get("/api/notifications", headers=stranger["headers"]).get_json()
    assert {row["kind"] for row in stranger_inbox["notifications"]} == {
        "security",
        "scratch_card",
    }
    assert all(row["id"] != aarav_note for row in stranger_inbox["notifications"])
    assert all(row["amount"] is None for row in stranger_inbox["notifications"])

    # 404 rather than 403: a stranger can't confirm which ids are real.
    assert (
        client.post(
            f"/api/notifications/{aarav_note}/read", headers=stranger["headers"]
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/api/notifications/{aarav_note}", headers=stranger["headers"]
        ).status_code
        == 404
    )


def test_a_payment_hands_over_a_scratch_card_that_pays_when_it_is_scratched(
    client, demo_auth
):
    """The card is the receipt's, the collection is the user's, the two are the
    same card — and it pays once, when it is opened."""
    headers = demo_auth["headers"]
    payee = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()["user_id"]

    before = client.get("/api/coins", headers=headers).get_json()

    # A payment that draws a card hands over the card, and says nothing else:
    # what it drew is under the cover.
    paid = client.post(
        "/api/transfer",
        json={"receiver_id": payee, "amount": 25, "note": "chai", "pin": PIN},
        headers=headers,
    ).get_json()
    assert paid["scratch_card_waiting"] is True
    assert "coins_earned" not in paid
    card_id = paid["coin_card_id"]

    # The balance has not moved. A draw nobody has been shown is not money.
    unopened = client.get("/api/coins", headers=headers).get_json()
    assert unopened["coins"] == before["coins"]
    assert unopened["cards_waiting"] == before["cards_waiting"] + 1

    collection = client.get("/api/scratch-cards", headers=headers).get_json()
    # Every award is a card: this payment's draw and the welcome bonus the
    # account was handed when it signed in.
    assert collection["total"] == 2
    assert collection["unscratched"] == 2
    card = next(item for item in collection["cards"] if item["id"] == card_id)
    assert collection["cards"][0]["reference"] == paid["txn_id"]  # newest first
    # ...and the amount is not on the wire either, so a covered card cannot hand
    # its prize over — not to a response, a screenshot or a failed cover.
    assert card["coins"] is None
    assert card["scratched"] is False
    assert card["paid_to"] == "Meera Iyer"
    assert card["amount"] == 25.0
    assert card["reference"] == paid["txn_id"]
    # Timezone-aware and the moment of the payment. A naive string on the wire
    # is read as the browser's own zone, which put a card won at 11:40 pm IST on
    # screen at 6:10 pm — the bug this assertion exists to keep out.
    stamp = datetime.fromisoformat(card["at"])
    assert stamp.tzinfo is not None
    assert abs((utcnow() - stamp).total_seconds()) < 120

    # The scratch is the claim, and the only thing that counts the coins: the
    # amount arrives in this response, and the balance moves by exactly it.
    scratched = client.post(f"/api/scratch-cards/{card_id}/scratch", headers=headers)
    assert scratched.status_code == 200
    claimed = scratched.get_json()
    won = claimed["card"]["coins"]
    assert won is not None and AWARD_MIN_COINS <= won <= AWARD_MAX_COINS
    assert claimed["card"]["scratched"] is True
    assert claimed["credited"] == won
    assert claimed["coins"]["coins"] == unopened["coins"] + won
    assert claimed["coins"]["cards_waiting"] == 1  # the welcome bonus is left

    # A second look at the same card is not a second prize: the same amount, and
    # nothing credited again.
    again = client.post(f"/api/scratch-cards/{card_id}/scratch", headers=headers)
    assert again.status_code == 200
    assert again.get_json()["card"]["coins"] == won
    assert again.get_json()["credited"] == 0
    assert again.get_json()["coins"]["coins"] == unopened["coins"] + won

    settled = client.get("/api/scratch-cards", headers=headers).get_json()
    assert settled["unscratched"] == 1  # the welcome bonus, still under its cover
    payment_card = next(item for item in settled["cards"] if item["id"] == card_id)
    assert payment_card["coins"] == won

    bonus = next(item for item in settled["cards"] if item["reason"] == "signup")
    assert bonus["caption"] == "Welcome bonus"
    assert bonus["coins"] is None  # decided, and not a word of it on the wire
    assert bonus["reference"] is None and bonus["amount"] is None
    opened = client.post(f"/api/scratch-cards/{bonus['id']}/scratch", headers=headers)
    assert opened.status_code == 200
    assert opened.get_json()["credited"] == SIGNUP_BONUS_COINS
    assert (
        opened.get_json()["coins"]["coins"]
        == unopened["coins"] + won + SIGNUP_BONUS_COINS
    )

    # A top-up draws no coins, so it hands over no card.
    topped = client.post(
        "/api/topup", json={"user_id": demo_auth["user_id"], "amount": 50}, headers=headers
    ).get_json()
    assert "coin_card_id" not in topped
    assert client.get("/api/scratch-cards", headers=headers).get_json()["total"] == 2

    # The inbox says there is a card to open, and points at the collection.
    inbox = client.get("/api/notifications", headers=headers).get_json()["notifications"]
    waiting = [row for row in inbox if row["kind"] == "scratch_card"]
    assert waiting, "a payment that drew coins writes a note about its card"
    assert waiting[0]["title"] == "A scratch card is waiting"
    assert "Meera Iyer" in waiting[0]["body"]


def test_a_card_counts_only_when_it_is_scratched_and_only_once(client):
    """The reward lifecycle, end to end, in one place.

    A payment generates a card, the card is listed, nothing is credited and no
    amount is anywhere until it is scratched, the scratch credits it exactly
    once, and the scratch is remembered. A top-up below the offer threshold is
    used so that the only cards in play are the payment's draw and the welcome
    bonus — otherwise this test would be asserting the offer's arithmetic too.
    """
    payer = fresh_payer(client, "9000000911", "Lifecycle Payer", topup_rupees=50)
    headers = payer["headers"]
    payee = onboard(client, "9000000912", "Lifecycle Payee")

    payment = client.post(
        "/api/transfer",
        json={"receiver_id": payee["user_id"], "amount": 12, "pin": PIN},
        headers=headers,
    ).get_json()
    card_id = payment["coin_card_id"]

    # 1-4: the card exists, and the amount is nowhere near the client.
    listed = client.get("/api/scratch-cards", headers=headers).get_json()
    assert listed["total"] == 2
    assert listed["unscratched"] == 2
    assert all(card["coins"] is None for card in listed["cards"])

    # 4-5: the dashboard does not move when the card is generated.
    chip = client.get("/api/coins", headers=headers).get_json()
    assert chip["coins"] == 0
    assert chip["earned"] == 0
    assert chip["redeemable"] == 0
    assert chip["awards"] == []
    assert chip["cards_waiting"] == 2

    # 6-7: the scratch credits it, and the fresh balance comes back with it.
    claimed = client.post(
        f"/api/scratch-cards/{card_id}/scratch", headers=headers
    ).get_json()
    won = claimed["card"]["coins"]
    assert won is not None and 1 <= won <= AWARD_MAX_COINS
    assert claimed["credited"] == won
    assert claimed["coins"]["coins"] == won
    assert claimed["coins"]["awards"] == [
        {"coins": won, "reason": "payment", "label": "Payment rewarded", "at": claimed["coins"]["awards"][0]["at"]}
    ]

    # 6b: and not twice. A repeat is the same card, not a second prize.
    repeat = client.post(
        f"/api/scratch-cards/{card_id}/scratch", headers=headers
    ).get_json()
    assert repeat["credited"] == 0
    assert repeat["coins"]["coins"] == won

    # 8: revisiting shows the state it was left in — cover off, amount still there.
    again = client.get("/api/scratch-cards", headers=headers).get_json()
    reopened = next(card for card in again["cards"] if card["id"] == card_id)
    assert reopened["scratched"] is True
    assert reopened["coins"] == won
    assert reopened["scratched_at"]
    assert again["unscratched"] == 1

    # A claim for a card that does not exist is refused and moves nothing.
    before = client.get("/api/coins", headers=headers).get_json()["coins"]
    assert (
        client.post("/api/scratch-cards/987654/scratch", headers=headers).status_code == 404
    )
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == before


def test_two_claims_of_one_card_credit_it_once(client, demo_auth, app):
    """The claim is atomic, so a race cannot pay for one card twice.

    The endpoint test covers a second tap arriving later. This covers the same
    instant: two claims of one card inside one session, which is what a refresh
    and a swipe landing together look like to the database. Only the claim that
    changes the row may count the coins — `claim_card` does the lift as a
    conditional UPDATE and reads the row count, rather than a read-then-write
    where both callers would see an unclaimed card and both would credit it.
    """
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    payee = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()["user_id"]
    card_id = client.post(
        "/api/transfer",
        json={"receiver_id": payee, "amount": 5, "pin": PIN},
        headers=headers,
    ).get_json()["coin_card_id"]

    with app.app_context():
        card, first = coins.claim_card(user_id, card_id)
        assert first == card.coins
        assert first >= AWARD_MIN_COINS

        _, second = coins.claim_card(user_id, card_id)
        assert second == 0
        db.session.commit()

    # One card, one prize: the balance equals the one credit.
    wallet = client.get("/api/coins", headers=headers).get_json()
    assert wallet["coins"] == first
    with app.app_context():
        award = db.session.get(CoinAward, card_id)
        assert award.scratched_at is not None
        assert sum(
            row.coins
            for row in CoinAward.query.filter(CoinAward.claimed_at.isnot(None)).all()
        ) == first


def test_an_offer_pays_out_as_a_card_with_its_own_caption(client, demo_auth):
    """A card won by an offer says which offer paid it."""
    headers = demo_auth["headers"]
    before = client.get("/api/scratch-cards", headers=headers).get_json()["total"]

    # ₹100 is the first-top-up threshold, so the offer pays 25 coins inside the
    # top-up's own commit — and those coins are a card like any other.
    topped = client.post(
        "/api/topup",
        json={"user_id": demo_auth["user_id"], "amount": 100, "pin": PIN},
        headers=headers,
    ).get_json()
    assert topped["rewards"][0]["coins"] == 25

    collection = client.get("/api/scratch-cards", headers=headers).get_json()
    assert collection["total"] == before + 1
    offer_card = collection["cards"][0]
    assert offer_card["caption"] == "On your first top-up"
    assert offer_card["coins"] is None  # under its cover like every other card
    assert offer_card["scratched"] is False
    assert offer_card["paid_to"] is None
    assert offer_card["reason"] == "offer:first_topup"

    # An offer's payout is claimed exactly like a payment's draw.
    opened = client.post(
        f"/api/scratch-cards/{offer_card['id']}/scratch", headers=headers
    ).get_json()
    assert opened["credited"] == 25
    assert opened["card"]["coins"] == 25


def test_scratch_cards_are_owner_scoped_and_need_a_token(client, demo_auth):
    """Someone else's card is not a card you can open."""
    headers = demo_auth["headers"]
    payee = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()["user_id"]
    card_id = client.post(
        "/api/transfer",
        json={"receiver_id": payee, "amount": 25, "pin": PIN},
        headers=headers,
    ).get_json()["coin_card_id"]

    assert client.get("/api/scratch-cards").status_code == 401

    stranger = onboard(client, "9000000931", "Card Thief")
    theirs = client.get("/api/scratch-cards", headers=stranger["headers"]).get_json()
    # Their own welcome bonus and nothing else — not the other wallet's card.
    assert theirs["total"] == 1
    assert all(item["id"] != card_id for item in theirs["cards"])
    # 404 rather than 403: the collection is not a way to confirm which ids exist.
    assert (
        client.post(
            f"/api/scratch-cards/{card_id}/scratch", headers=stranger["headers"]
        ).status_code
        == 404
    )
    assert (
        client.post("/api/scratch-cards/999999/scratch", headers=headers).status_code == 404
    )

    # The wallet that owns it can still open it.
    assert (
        client.post(f"/api/scratch-cards/{card_id}/scratch", headers=headers).status_code
        == 200
    )


def test_rewards_pay_out_once_the_qualifying_payment_settles(client, demo_auth, app):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]

    rewards = {item["code"]: item for item in client.get("/api/rewards", headers=headers).get_json()}
    assert set(rewards) == {"first_topup", "three_payments", "first_money_in"}
    # Seeded history predates the offers, so nothing is pre-earned: progress is
    # counted from the moment the offer started, not from the account's birth.
    assert rewards["first_topup"]["progress"] == 0
    assert rewards["three_payments"]["target"] == 3
    assert rewards["first_topup"]["status"] == "active"
    assert rewards["first_topup"]["expires_at"]

    # A top-up below the qualifying size doesn't count towards the welcome offer.
    client.post(
        "/api/topup", json={"user_id": user_id, "amount": 50, "pin": PIN}, headers=headers
    )
    assert (
        client.get("/api/rewards", headers=headers).get_json()[0]["progress"] == 0
    )

    qualifying = client.post(
        "/api/topup", json={"user_id": user_id, "amount": 100, "pin": PIN}, headers=headers
    )
    # 5000 + the ₹50 that didn't qualify + this ₹100. No cashback rides along:
    # the offer pays coins, and the wallet balance is only the top-up.
    assert qualifying.get_json()["new_balance"] == 5150.0
    assert qualifying.get_json()["rewards"][0]["coins"] == 25

    after = {item["code"]: item for item in client.get("/api/rewards", headers=headers).get_json()}
    assert after["first_topup"]["status"] == "credited"
    assert after["first_topup"]["credited_at"]
    assert after["first_topup"]["coins"] == 25
    assert after["first_topup"]["reward"] == 25.0

    # The payout is a real coin award, tagged with the offer that made it —
    # which is what keeps the coin balance one sum of one log — and it reaches
    # the balance the way every payout does, by being scratched.
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == 0
    assert claim_every_card(client, headers) == SIGNUP_BONUS_COINS + 25
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == (
        SIGNUP_BONUS_COINS + 25
    )
    with app.app_context():
        award = CoinAward.query.filter_by(
            user_id=user_id, reason="offer:first_topup"
        ).one()
        assert award.coins == 25
        assert award.transaction_id is None

    # No rupees moved: the two top-ups are the newest ledger rows, and nothing
    # in the history is a cashback any more.
    ledger = client.get(f"/api/transactions/{user_id}", headers=headers).get_json()
    assert [row["type"] for row in ledger[:2]] == ["topup", "topup"]
    assert all(row["type"] != "cashback" for row in ledger)

    # And it cannot be paid twice — a credited offer is skipped, not re-earned.
    client.post(
        "/api/topup", json={"user_id": user_id, "amount": 100, "pin": PIN}, headers=headers
    )
    assert (
        client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()["balance"]
        == 5250.0
    )
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == (
        SIGNUP_BONUS_COINS + 25
    )


def test_the_third_payment_credits_fifty_coins_and_a_refusal_credits_nothing(
    client, demo_auth, app
):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    payee = onboard(client, "9000000933", "Offer Payee")

    client.post(
        "/api/topup", json={"user_id": user_id, "amount": 1000, "pin": PIN}, headers=headers
    )
    # Over the daily cap: refused, so it must not count towards any offer either.
    assert (
        client.post(
            "/api/transfer",
            json={"receiver_id": payee["user_id"], "amount": 200000, "pin": PIN},
            headers=headers,
        ).status_code
        == 400
    )

    answers = []
    for amount in (10, 20, 30):
        answers.append(
            client.post(
                "/api/transfer",
                json={"receiver_id": payee["user_id"], "amount": amount, "pin": PIN},
                headers=headers,
            ).get_json()
        )

    assert "rewards" not in answers[0]
    assert "rewards" not in answers[1]
    assert answers[2]["rewards"] == [
        {
            "code": "three_payments",
            "title": "50 coins",
            "headline": "On your next 3 payments",
            "coins": 50,
            "amount": 50.0,
        }
    ]
    # 5000 + 1000 top-up - 60 paid. Neither offer moved the wallet: the welcome
    # bonus, the ₹25 top-up offer and the ₹50 payments offer are all coins.
    assert (
        client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()["balance"]
        == 5940.0
    )
    # ...and each of them is one row in the award log, tagged with what paid it.
    with app.app_context():
        offers = {
            row.reason: row.coins
            for row in CoinAward.query.filter_by(user_id=user_id).all()
            if row.reason != CoinAward.REASON_PAYMENT
        }
    assert offers == {
        CoinAward.REASON_SIGNUP: SIGNUP_BONUS_COINS,
        "offer:first_topup": 25,
        "offer:three_payments": 50,
    }


def test_the_daily_cap_is_reported_and_enforced_by_the_same_numbers(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    payee = onboard(client, "9000000922", "Cap Payee")

    client.post(
        "/api/topup", json={"user_id": user_id, "amount": 100000, "pin": PIN}, headers=headers
    )

    before = client.get("/api/limits", headers=headers).get_json()
    assert before["daily_limit"] == 100000.0
    assert before["spent_today"] == 0.0
    assert before["remaining"] == 100000.0
    assert before["per_transaction"] == 100000
    assert before["resets_at"]

    assert (
        client.post(
            "/api/transfer",
            json={"receiver_id": payee["user_id"], "amount": 60000, "pin": PIN},
            headers=headers,
        ).status_code
        == 200
    )
    after = client.get("/api/limits", headers=headers).get_json()
    assert after["spent_today"] == 60000.0
    assert after["remaining"] == 40000.0
    assert after["used_percent"] == 60.0

    # One rupee past what's left is refused before anything is debited, and the
    # message quotes the very number the limits endpoint reports.
    refused = client.post(
        "/api/transfer",
        json={"receiver_id": payee["user_id"], "amount": 40001, "pin": PIN},
        headers=headers,
    )
    assert refused.status_code == 400
    assert "Only ₹40,000.00" in refused.get_json()["message"]
    assert (
        client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()["balance"]
        == 45000.0
    )
    # A refused payment is not a notification-worthy event: nothing happened.
    inbox = client.get("/api/notifications", headers=headers).get_json()
    assert all(row["kind"] != "money_sent" or row["amount"] != 40001.0 for row in inbox["notifications"])


def fresh_payer(client, mobile, name, topup_rupees=500):
    """A brand-new account, funded and ready to pay.

    A brand-new account is the only account whose coin history a test can know:
    a real one starts with the welcome bonus and nothing else, and the seeded
    demo accounts have already been handed theirs.
    """
    payer = onboard(client, mobile, name)
    client.post(
        "/api/topup",
        json={"user_id": payer["user_id"], "amount": topup_rupees, "pin": PIN},
        headers=payer["headers"],
    )
    return payer


def test_every_payment_awards_coins_and_the_award_is_written_down(client, app):
    """Each payment pays, the amount is the server's, and it is recorded once.

    The payout is random, so the assertions are about the shape of the earning
    rather than a fixed number: something is always awarded, it is inside the
    range, the balance is exactly the sum of what was written down, and the
    award is attached to the payment that earned it.
    """
    payer = fresh_payer(client, "9000000931", "Coin Payer")
    headers = payer["headers"]
    payee = onboard(client, "9000000932", "Coin Payee")

    started = client.get("/api/coins", headers=headers).get_json()
    assert started["coin_value"] == 1.0
    assert started["min_redeem"] == 10
    # A brand-new account holds two cards and no coins: the welcome bonus, and
    # the 25 the ₹500 `fresh_payer` top-up earned for the first-top-up offer —
    # the same top-up that put the offers in play, counted rather than
    # discarded (see `settle_due`). Neither is spendable until it is scratched,
    # so nothing of either is in the balance, the history or the total yet.
    assert started["coins"] == 0
    assert started["cards_waiting"] == 2
    assert started["awards"] == []

    # Four payments, each drawing a card and saying nothing about it.
    for _ in range(4):
        answer = client.post(
            "/api/transfer",
            json={"receiver_id": payee["user_id"], "amount": 5, "pin": PIN},
            headers=headers,
        ).get_json()
        assert answer["scratch_card_waiting"] is True
        assert "coins_earned" not in answer

    # The draws are on record before anybody has looked at them...
    with app.app_context():
        rows = CoinAward.query.filter_by(
            user_id=payer["user_id"], reason=CoinAward.REASON_PAYMENT
        ).all()
        assert len(rows) == 4
        assert len({row.transaction_id for row in rows}) == 4
        drawn = [row.coins for row in rows]
        awarded = sum(drawn)
        assert all(AWARD_MIN_COINS <= value <= AWARD_MAX_COINS for value in drawn)

    # ...and it is scratching them that pays: the balance is exactly what the
    # cards were worth, once each.
    assert claim_every_card(client, headers) == SIGNUP_BONUS_COINS + 25 + awarded + 50
    after = client.get("/api/coins", headers=headers).get_json()
    # Four draws and the 50-coin offer the third payment completed, all on top
    # of the welcome bonus and the top-up offer.
    assert after["earned"] == SIGNUP_BONUS_COINS + 25 + awarded + 50
    assert (
        after["coins"]
        == after["earned"] - after["redeemed"]
        == started["coins"] + awarded + 50 + SIGNUP_BONUS_COINS + 25
    )
    assert after["cards_waiting"] == 0
    # The award history reads newest first — this test's four payments, and the
    # offer the third of them completed — and each row says where it came from.
    assert [(row["reason"], row["coins"]) for row in after["awards"]] == [
        ("payment", drawn[3]),
        ("payment", drawn[2]),
        ("offer:three_payments", 50),
        ("payment", drawn[1]),
        ("payment", drawn[0]),
    ]
    assert [row["label"] for row in after["awards"]][:4] == [
        "Payment rewarded",
        "Payment rewarded",
        "Offer reward",
        "Payment rewarded",
    ]

    # A top-up is money arriving, not a payment made, so it earns nothing.
    coins_before = after["coins"]
    client.post(
        "/api/topup", json={"user_id": payer["user_id"], "amount": 50, "pin": PIN}, headers=headers
    )
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == coins_before

    # A draw writes to the inbox, in the same commit as the payment — and says
    # only that a card is waiting, never what it is worth.
    notes = client.get("/api/notifications", headers=headers).get_json()["notifications"]
    kinds = [row["kind"] for row in notes]
    assert "scratch_card" in kinds
    waiting = [row for row in notes if row["kind"] == "scratch_card"]
    assert waiting and all("scratch" in row["body"].lower() for row in waiting)
    assert all(row["amount"] is None for row in waiting)
    assert all(str(value) not in row["title"] for row in waiting for value in drawn if value > 5)


def test_the_award_draw_is_small_most_of_the_time_but_reaches_fifty(app):
    """The odds, stated as odds.

    A uniform 1–50 would average 25 coins a payment and make a large award
    ordinary. The draw is meant to be weighted the other way — mostly pocket
    change, with the big numbers genuinely rare — so this checks the declared
    weights as well as a few thousand real draws.
    """
    weights = award_weights()
    assert [value for value, _ in weights] == list(
        range(AWARD_MIN_COINS, AWARD_MAX_COINS + 1)
    )
    # Every value is reachable, including the top of the range: "rare" and
    # "impossible" are different things.
    assert all(weight >= 1 for _, weight in weights)

    total = sum(weight for _, weight in weights)
    head = sum(weight for value, weight in weights if value <= 5)
    assert head / total > 0.5, "1-5 should be the common case"
    tail = [weight for value, weight in weights if value >= 6]
    assert tail == sorted(tail, reverse=True), "6-50 should get rarer as they climb"

    # The declared odds and the generator should agree.
    with app.app_context():
        draws = [coins._draw_award() for _ in range(4000)]
    assert all(AWARD_MIN_COINS <= value <= AWARD_MAX_COINS for value in draws)
    small = sum(1 for value in draws if value <= 5) / len(draws)
    assert 0.6 < small < 0.8, f"1-5 came up {small:.0%} of the time"
    assert any(value > 5 for value in draws), "the tail has to actually happen"
    assert sum(draws) / len(draws) < 10, "the average payout should stay small"


def test_coins_redeem_into_the_wallet_and_cannot_be_spent_twice(client):
    payer = fresh_payer(client, "9000000941", "Redeem Payer", topup_rupees=1000)
    headers = payer["headers"]
    user_id = payer["user_id"]
    payee = onboard(client, "9000000942", "Redeem Payee")

    # Pay and scratch until the balance clears the minimum. The payout is
    # random, so the number of payments it takes is not fixed — the balance is
    # what matters, and it only moves for the cards that have been opened.
    for _ in range(60):
        if client.get("/api/coins", headers=headers).get_json()["coins"] >= 10:
            break
        assert (
            client.post(
                "/api/transfer",
                json={"receiver_id": payee["user_id"], "amount": 1, "pin": PIN},
                headers=headers,
            ).status_code
            == 200
        )
        claim_every_card(client, headers)

    before = client.get("/api/coins", headers=headers).get_json()
    assert before["coins"] >= 10
    # Clearing the minimum offers the whole balance — a coin is ₹1 and none of
    # them are held back to make the payout a round number.
    assert before["redeemable"] == before["coins"]
    assert before["redeemable_value"] == float(before["redeemable"])
    assert before["redeemable"] >= 10
    balance_before = client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()[
        "balance"
    ]

    redeemed = client.post("/api/coins/redeem", json={}, headers=headers)
    assert redeemed.status_code == 200
    body = redeemed.get_json()
    assert body["coins_redeemed"] == before["redeemable"]
    assert body["amount"] == float(before["redeemable"])
    # Everything held went out, so the coin balance is empty rather than holding
    # a remainder of a few coins.
    assert body["coins"]["coins"] == 0
    assert body["coins"]["redeemable"] == 0

    balance_after = client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()[
        "balance"
    ]
    assert balance_after == balance_before + float(before["redeemable"])

    # The credit is a real ledger row, visible as a coin reward.
    ledger = client.get(f"/api/transactions/{user_id}", headers=headers).get_json()
    coin_rows = [row for row in ledger if row["type"] == "coins"]
    assert len(coin_rows) == 1
    assert coin_rows[0]["amount"] == float(before["redeemable"])
    assert coin_rows[0]["receiver"] == user_id

    # Spending them again is refused, and the balance doesn't move.
    again = client.post("/api/coins/redeem", json={}, headers=headers)
    assert again.status_code == 400
    # An empty balance is not a payout: the refusal names the minimum rather
    # than leaving the reader to work it out.
    refusal = again.get_json()["message"]
    assert "10" in refusal and "redeem" in refusal
    assert (
        client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()["balance"]
        == balance_after
    )


def test_redemption_pays_out_the_whole_balance_at_a_rupee_a_coin(client, app):
    """11 coins pay ₹11, 37 pay ₹37 — the ten is the gate, not the step.

    Redemption used to round the balance down to whole tens and leave the odd
    coins behind, which quietly kept money the user had earned: a balance of 37
    paid ₹30 and parked 7. The spec is one rupee a coin from ten upwards, so the
    two figures are checked at the exact sizes it names, against the wallet
    balance rather than against the response alone.
    """
    payer = fresh_payer(client, "9000000971", "Exact Payer", topup_rupees=50)
    headers = payer["headers"]
    user_id = payer["user_id"]

    # Start from an empty coin balance: the welcome bonus is real coins, and
    # clearing it through the API is how any account ends up holding nothing.
    # It has to be scratched first — that is what puts it in the balance at all.
    assert claim_every_card(client, headers) == SIGNUP_BONUS_COINS
    cleared = client.post("/api/coins/redeem", json={}, headers=headers)
    assert cleared.status_code == 200
    assert cleared.get_json()["coins_redeemed"] == SIGNUP_BONUS_COINS

    for held, expected in ((11, 11.0), (37, 37.0)):
        grant_claimed(app, client, headers, user_id, held)

        before = client.get("/api/coins", headers=headers).get_json()
        assert before["coins"] == held
        assert before["redeemable"] == held, "no rounding to the nearest ten"
        assert before["redeemable_value"] == expected

        balance_before = client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()[
            "balance"
        ]
        paid = client.post("/api/coins/redeem", json={}, headers=headers)
        assert paid.status_code == 200
        body = paid.get_json()
        assert body["coins_redeemed"] == held
        assert body["amount"] == expected
        assert body["coins"]["coins"] == 0
        assert body["coins"]["redeemable"] == 0

        balance_after = client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()[
            "balance"
        ]
        assert balance_after == balance_before + expected

    # Nine coins are still short of the gate, named amount or not.
    grant_claimed(app, client, headers, user_id, 9)
    short = client.post("/api/coins/redeem", json={}, headers=headers)
    assert short.status_code == 400
    assert "10 are needed" in short.get_json()["message"]
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == 9


def test_coin_redemption_rules_are_stated_not_guessed(client, app, monkeypatch):
    """Half-finished coin balances get a reason, not a generic refusal.

    The payout is pinned to a single coin here, because this test is about the
    wording of a refusal that only happens while the balance is short — it is
    not about the draw. The welcome bonus is part of the balance, so the figures
    below are the bonus plus the one coin the payment is pinned to.
    """
    monkeypatch.setattr(coins, "_draw_award", lambda: 1)
    # A top-up deliberately below the ₹100 the first-top-up offer needs, so the
    # only coins in play are the welcome bonus and the pinned payout.
    payer = fresh_payer(client, "9000000951", "Rules Payer", topup_rupees=50)
    headers = payer["headers"]
    payee = onboard(client, "9000000952", "Rules Payee")

    client.post(
        "/api/transfer",
        json={"receiver_id": payee["user_id"], "amount": 1, "pin": PIN},
        headers=headers,
    )

    # Scratch the two cards the account is holding — the welcome bonus and the
    # one-coin draw just made — because that is what puts them in the balance.
    held = claim_every_card(client, headers)
    assert held == SIGNUP_BONUS_COINS + 1
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == held

    # A named amount is not a menu: a redemption takes the whole balance, so
    # asking for seven of the fifty-one on hand is refused — and the refusal
    # says what is actually held rather than what the wallet would prefer.
    odd = client.post("/api/coins/redeem", json={"coins": 7}, headers=headers)
    assert odd.status_code == 400
    assert f"You have {held} coins" in odd.get_json()["message"]
    assert "takes all of them" in odd.get_json()["message"]

    # Asking for more than is held is refused the same way.
    greedy = client.post("/api/coins/redeem", json={"coins": held + 9}, headers=headers)
    assert greedy.status_code == 400
    assert f"You have {held} coins" in greedy.get_json()["message"]

    # Redeem the balance — all of it, since 51 coins clear the minimum.
    assert client.post("/api/coins/redeem", json={}, headers=headers).status_code == 200
    assert client.get("/api/coins", headers=headers).get_json()["coins"] == 0

    # A balance under the minimum is refused with the shortfall rather than a
    # shrug, and the refusal names the gate it has to clear.
    grant_claimed(app, client, headers, payer["user_id"], 4)
    short = client.post("/api/coins/redeem", json={}, headers=headers)
    assert short.status_code == 400
    assert "10 are needed" in short.get_json()["message"]

    assert client.get("/api/coins").status_code == 401
    assert client.post("/api/coins/redeem", json={}).status_code == 401


def test_signing_up_hands_over_fifty_coins_exactly_once(client, app):
    """The welcome bonus belongs to sign-up, not to signing in.

    It is granted where an account becomes real — the moment a one-time code is
    verified — and the guard is the award log itself, so signing in again, or
    five times again, cannot hand it over twice.
    """
    mobile = "9000000961"
    otp = client.post("/api/start_login", json={"mobile": mobile}).get_json()["dev_otp"]
    payload = client.post(
        "/api/verify_otp", json={"mobile": mobile, "otp": otp}
    ).get_json()
    headers = {"Authorization": f"Bearer {payload['token']}"}
    user_id = payload["user_id"]

    assert SIGNUP_BONUS_COINS == 50
    # The bonus arrives as a card. It is decided and stored at sign-up, and the
    # balance does not know about it — nor does the client, which is why the
    # amount is absent rather than merely undrawn.
    held = client.get("/api/coins", headers=headers).get_json()
    assert held["coins"] == 0
    assert held["redeemable"] == 0
    assert held["awards"] == []
    assert held["cards_waiting"] == 1

    cards = client.get("/api/scratch-cards", headers=headers).get_json()
    assert cards["total"] == 1
    assert cards["cards"][0]["reason"] == "signup"
    assert cards["cards"][0]["caption"] == "Welcome bonus"
    assert cards["cards"][0]["coins"] is None

    # The scratch is the claim, and it is what makes the coins real.
    scratched = client.post(
        f"/api/scratch-cards/{cards['cards'][0]['id']}/scratch", headers=headers
    ).get_json()
    assert scratched["credited"] == SIGNUP_BONUS_COINS
    first = scratched["coins"]
    assert first["coins"] == 50
    assert first["value"] == 50.0
    assert first["redeemable"] == 50
    assert len(first["awards"]) == 1
    assert first["awards"][0]["coins"] == 50
    assert first["awards"][0]["reason"] == "signup"
    assert first["awards"][0]["label"] == "Welcome bonus"

    # Coins are not wallet money: 50 coins are worth ₹50 and none of it is in
    # the balance until they are redeemed. A bonus you can spend by accident is
    # not a bonus, it is a credit.
    # (Read from `/me`, which answers before a wallet row exists at all.)
    assert client.get("/api/me", headers=headers).get_json()["balance"] == 0.0

    titles = [
        row["title"]
        for row in client.get("/api/notifications", headers=headers).get_json()[
            "notifications"
        ]
    ]
    assert "A welcome scratch card is waiting" in titles
    # Not one of them names the amount: the card is the only place it exists.
    assert not any("50" in title for title in titles)

    # Two more sign-ins. The bonus is not a sign-in bonus.
    for _ in range(2):
        otp = client.post("/api/start_login", json={"mobile": mobile}).get_json()["dev_otp"]
        assert (
            client.post("/api/verify_otp", json={"mobile": mobile, "otp": otp}).status_code
            == 200
        )

    assert client.get("/api/coins", headers=headers).get_json()["coins"] == 50
    with app.app_context():
        assert CoinAward.query.filter_by(user_id=user_id).count() == 1


def test_statement_pdf_prints_balances_that_reconcile(client, app):
    """Opening plus credits minus debits equals the closing balance — and the
    figures are the ledger's, printed on the page for a reader to check.

    The statement is built with compression off so the test can read the text it
    actually emitted. Asserting only that a PDF came back would pass even if the
    panel printed nothing at all.
    """
    from reportlab import rl_config

    from wallet.blueprints.accounts import _statement_rows
    from wallet.models import Wallet

    payer = fresh_payer(client, "9000000961", "Statement Payer", topup_rupees=1000)
    headers = payer["headers"]
    user_id = payer["user_id"]
    payee = onboard(client, "9000000962", "Statement Payee")
    for amount in (11, 22, 33):
        assert (
            client.post(
                "/api/transfer",
                json={"receiver_id": payee["user_id"], "amount": amount, "pin": PIN},
                headers=headers,
            ).status_code
            == 200
        )

    with app.app_context():
        rows, _ = _statement_rows(user_id, None, None)
        credits = sum(row.amount_paise for row in rows if row.sender_id != user_id)
        debits = sum(row.amount_paise for row in rows if row.sender_id == user_id)
        closing = Wallet.query.filter_by(user_id=user_id).first().balance_paise
        # The top-up is a credit, the three payments are debits, so the panel has
        # real movement to report in both columns.
        assert credits >= 100000
        assert debits == (11 + 22 + 33) * 100

    opening = closing - (credits - debits)
    assert opening + credits - debits == closing

    previous = rl_config.pageCompression
    rl_config.pageCompression = 0
    try:
        response = client.get("/api/statements.pdf", headers=headers)
    finally:
        rl_config.pageCompression = previous

    assert response.status_code == 200
    body = response.data
    assert body.startswith(b"%PDF")

    # The panel a bank statement carries, and the sum it rests on.
    for label in (
        b"Opening balance",
        b"Total credits",
        b"Total debits",
        b"Net change",
        b"Closing balance",
        b"equals the closing balance",
    ):
        assert label in body

    # Every figure printed is the ledger's own, to the paise.
    for paise in (opening, credits, debits, closing):
        assert f"{paise / 100:,.2f}".encode() in body

    # Month banners, so a long statement is readable a month at a time.
    assert b"September 2026" in body or b"October 2026" in body
    assert b"Debits" in body


def test_the_limit_day_starts_at_midnight_in_ist(app):
    """A cap that resets at 05:30 local time would look arbitrary, so the window
    is anchored to IST midnight rather than to UTC."""
    with app.app_context():
        start, end = day_window(datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc))
        # 12:00 UTC is 17:30 IST on 1 October, so the day began at 18:30 UTC on
        # 30 September and resets 24 hours later.
        assert start == datetime(2026, 9, 30, 18, 30, tzinfo=timezone.utc)
        assert end == datetime(2026, 10, 1, 18, 30, tzinfo=timezone.utc)
        assert end - start == timedelta(days=1)

        # Just after IST midnight the window has already rolled over.
        late_start, _ = day_window(datetime(2026, 10, 1, 18, 31, tzinfo=timezone.utc))
        assert late_start == datetime(2026, 10, 1, 18, 30, tzinfo=timezone.utc)


def test_a_wrong_pin_is_counted_per_ist_day(client, app, demo_auth):
    """Five wrong attempts a day, and midnight in India starts the count over.

    The counter used to be permanent: three mistyped PINs on Monday were still
    three on Friday, and the only way back was to run out of attempts and wait
    out the lockout. The count now belongs to an IST calendar day, so it is
    written down rather than inferred — a count with no date cannot tell you
    whether it was this morning or last week.
    """
    headers = demo_auth["headers"]
    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwault"}, headers=headers
    ).get_json()["user_id"]

    def wrong() -> dict:
        return client.post(
            "/api/transfer",
            json={"receiver_id": receiver, "amount": 10, "pin": "9999"},
            headers=headers,
        ).get_json()

    assert "4 attempt(s) left" in wrong()["message"]
    assert "3 attempt(s) left" in wrong()["message"]

    # The same count, carried over from yesterday: the day it belongs to is not
    # today, so today starts from zero.
    with app.app_context():
        user = db.session.get(User, demo_auth["user_id"])
        user.pin_attempts = 3
        user.pin_attempts_date = ist_date() - timedelta(days=1)
        db.session.commit()

    assert "4 attempt(s) left" in wrong()["message"]

    with app.app_context():
        user = db.session.get(User, demo_auth["user_id"])
        assert user.pin_attempts == 1
        assert user.pin_attempts_date == ist_date()


def test_a_forgotten_pin_is_replaced_with_the_registered_number(client):
    """The full recovery: code to the number, then a new PIN, and no sign-in.

    The old PIN must stop authenticating the moment the new one is written —
    otherwise "reset" would mean "add a second PIN", which is the opposite of
    what someone who fears their PIN leaked is asking for.
    """
    mobile = "9000000005"
    headers = login_as(client, mobile)["headers"]
    assert client.post("/api/verify_pin", json={"pin": PIN}, headers=headers).status_code == 200

    started = client.post("/api/forgot_pin", json={"mobile": mobile})
    assert started.status_code == 200
    otp = started.get_json()["dev_otp"]

    verified = client.post("/api/verify_reset_otp", json={"mobile": mobile, "otp": otp})
    assert verified.status_code == 200
    token = verified.get_json()["reset_token"]

    # A reset token proves the phone, not the wallet: it is not a Bearer token.
    assert (
        client.get("/api/coins", headers={"Authorization": f"Bearer {token}"}).status_code
        == 401
    )

    reset = client.post("/api/reset_pin", json={"reset_token": token, "pin": "4321"})
    assert reset.status_code == 200

    fresh = login_as(client, mobile)["headers"]
    stale = client.post("/api/verify_pin", json={"pin": PIN}, headers=fresh)
    assert stale.status_code == 403
    assert "Incorrect PIN" in stale.get_json()["message"]
    assert client.post("/api/verify_pin", json={"pin": "4321"}, headers=fresh).status_code == 200

    # And the reset is a security event the owner can see.
    notes = client.get("/api/notifications", headers=fresh).get_json()["notifications"]
    assert any("PIN reset" in note["title"] for note in notes)


def test_a_session_token_cannot_be_used_to_reset_a_pin(client, demo_auth):
    """Two kinds of token, told apart by the claim that says which is which."""
    refused = client.post(
        "/api/reset_pin",
        json={"reset_token": demo_auth["headers"]["Authorization"].split(" ", 1)[1], "pin": "4321"},
    )
    assert refused.status_code == 401
    # Same answer for a token that never existed, and for an empty one.
    assert client.post("/api/reset_pin", json={"pin": "4321"}).status_code == 401


def test_forgot_pin_does_not_say_whether_a_number_is_registered(client):
    """The answer is the same sentence either way, and nothing is sent twice.

    A screen that says "no wallet with that number" is a screen that tells a
    stranger which numbers bank here. The only difference is the code, and the
    demo hands that back for the numbers that have an account — which is the
    same bargain the sign-in flow already makes.
    """
    unknown = client.post("/api/forgot_pin", json={"mobile": "9111111111"})
    assert unknown.status_code == 200
    body = unknown.get_json()
    assert "dev_otp" not in body

    known = client.post("/api/forgot_pin", json={"mobile": "9000000001"})
    assert known.status_code == 200
    assert known.get_json()["message"] == body["message"]
    assert len(known.get_json()["dev_otp"]) == 6

    # A wrong code is refused without saying anything about registration.
    assert (
        client.post(
            "/api/verify_reset_otp", json={"mobile": "9111111111", "otp": "000000"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/verify_reset_otp", json={"mobile": "9000000001", "otp": "000000"}
        ).status_code
        == 400
    )


def test_signing_in_again_does_not_repeat_the_first_login_note(client):
    """One welcome, in the life of the account, and nothing on later sign-ins."""
    mobile = "9000000009"
    headers = login_as(client, mobile)["headers"]  # creates the account
    for _ in range(3):
        headers = login_as(client, mobile)["headers"]

    notes = client.get("/api/notifications", headers=headers).get_json()["notifications"]
    titles = [note["title"] for note in notes]
    assert sum(1 for title in titles if "welcome" in title.lower()) == 1
    assert not any("sign-in" in title.lower() for title in titles)


def test_the_statement_image_installs_a_font_the_rupee_sign_needs():
    """₹ in a downloaded statement depends on a face the image actually ships.

    reportlab's built-in Helvetica has no ₹ glyph, so a statement printed
    without a Unicode face says "INR" on every line. That is what a slim Python
    image looks like, which is why the Dockerfile installs one — and this is the
    test that keeps it installed.
    """
    from wallet import statement

    root = pathlib.Path(__file__).resolve().parents[1]
    dockerfile = (root / "Dockerfile").read_text(encoding="utf-8")
    assert "fonts-dejavu-core" in dockerfile

    # And the statement must look where that package installs to. (`as_posix`
    # so the assertion is about the container's paths, not this host's
    # separator — the same list is checked on Windows.)
    assert any(
        regular.as_posix().startswith("/usr/share/fonts/")
        for regular, _ in statement._FONT_CANDIDATES
    )


def test_the_statement_falls_back_to_inr_rather_than_failing(app, monkeypatch):
    """No Unicode face is a degraded statement, never a broken download."""
    from wallet import statement

    monkeypatch.setattr(statement, "_FONT_CANDIDATES", [])
    statement._fonts.cache_clear()
    try:
        fonts = statement._fonts()
        assert fonts.body == "Helvetica"
        assert fonts.currency == "INR "
    finally:
        statement._fonts.cache_clear()


def test_the_statement_prints_the_rupee_sign_when_the_host_has_a_face(app):
    """On a machine with any of the candidate faces, the money is ₹.

    Skipped rather than failed where the host has none: this is a fact about the
    environment, and the environment that matters (the container) is covered by
    the Dockerfile test above.
    """
    from wallet import statement

    available = [
        (regular, bold)
        for regular, bold in statement._FONT_CANDIDATES
        if regular.is_file() and bold.is_file()
    ]
    if not available:
        skip("no Unicode face on this host — see the Dockerfile test")

    statement._fonts.cache_clear()
    try:
        fonts = statement._fonts()
    finally:
        statement._fonts.cache_clear()
    assert fonts.currency == "₹"
