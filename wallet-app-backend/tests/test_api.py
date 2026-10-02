from datetime import datetime, timedelta, timezone

from pytest import mark

from wallet.config import _database_uri
from wallet.limits import day_window


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


def test_health(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ok"
    # The test app runs on SQLite; a Postgres deploy must report "postgresql"/"psycopg2".
    assert body["db"] == "sqlite"
    assert body["driver"] == "pysqlite"


def test_demo_login_returns_token_and_balance(client):
    response = client.post("/api/demo_login")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["token"]
    assert payload["vpa"] == "9000000001@okwalletpay"
    assert payload["balance"] == 5000.0


def test_protected_endpoints_require_token(client):
    assert client.get("/api/get_balance/1").status_code == 401
    assert client.get("/api/transactions/1").status_code == 401
    assert client.post("/api/transfer", json={"receiver_id": 2, "amount": 10}).status_code == 401
    assert client.post("/api/vpas/resolve", json={"vpa": "9000000002@okwalletpay"}).status_code == 401


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
        "/api/vpas/resolve", json={"vpa": "9000000002@okwalletpay"}, headers=headers
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
    # ₹1000 is the first qualifying top-up, so the welcome offer pays ₹25 inside
    # the same commit as the top-up itself.
    assert topup.get_json()["new_balance"] == 6025.0
    assert topup.get_json()["rewards"] == [
        {"code": "first_topup", "title": "₹25 cashback", "amount": 25.0}
    ]

    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwalletpay"}, headers=headers
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
    assert balance["balance"] == 5924.75


def test_transfer_rejects_self_and_insufficient_funds(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwalletpay"}, headers=headers
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
    assert named.get_json()["vpa"] == "9876543210@okwalletpay"

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
        "/api/vpas/resolve", json={"vpa": "9876543210@okwalletpay"}, headers=headers
    )
    assert self_resolve.status_code == 400


def test_transfer_requires_a_pin_that_the_server_verifies(client, demo_auth):
    headers = demo_auth["headers"]
    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@okwalletpay"}, headers=headers
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
        "/api/vpas/resolve", json={"vpa": "9000000002@okwalletpay"}, headers=headers
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
    # 5000 + 300 received, plus the ₹10 "when someone pays you" cashback that
    # arriving money unlocks for Aarav (Meera only paid, so hers stays closed).
    assert (
        client.get(f"/api/get_balance/{aarav['user_id']}", headers=aarav["headers"]).get_json()[
            "balance"
        ]
        == 5310.0
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
    # ₹500 clears the ₹100 first-top-up threshold, so the ₹25 cashback rides along.
    assert okay.get_json()["new_balance"] == 5525.0
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
    assert "walletpay-statement" in response.headers["Content-Disposition"]

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
    again = client.post("/api/contacts", json={"identifier": "9000000088@okwalletpay"}, headers=headers)
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


def test_the_inbox_logs_both_sides_of_a_payment(client, demo_auth):
    aarav = demo_auth
    meera = login_as(client, "9000000002")
    payee = client.post(
        "/api/vpas/resolve",
        json={"vpa": "9000000002@okwalletpay"},
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
    sent = inbox["notifications"][0]
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

    # The stranger's inbox holds only their own security notes — signing in, then
    # setting a PIN — and none of Aarav's ledger activity leaks across.
    stranger_inbox = client.get("/api/notifications", headers=stranger["headers"]).get_json()
    assert {row["kind"] for row in stranger_inbox["notifications"]} == {"security"}
    assert all(row["id"] != aarav_note for row in stranger_inbox["notifications"])

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


def test_rewards_pay_out_once_the_qualifying_payment_settles(client, demo_auth):
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
    # 5000 + the ₹50 that didn't qualify + this ₹100 + the ₹25 it unlocked.
    assert qualifying.get_json()["new_balance"] == 5175.0
    assert qualifying.get_json()["rewards"][0]["amount"] == 25.0

    after = {item["code"]: item for item in client.get("/api/rewards", headers=headers).get_json()}
    assert after["first_topup"]["status"] == "credited"
    assert after["first_topup"]["credited_at"]

    # A cashback is real money: it is a ledger row like any other.
    ledger = client.get(f"/api/transactions/{user_id}", headers=headers).get_json()
    assert ledger[0]["type"] == "cashback"
    assert ledger[0]["amount"] == 25.0
    assert ledger[0]["sender"] is None

    # And it cannot be paid twice — a credited offer is skipped, not re-earned.
    client.post(
        "/api/topup", json={"user_id": user_id, "amount": 100, "pin": PIN}, headers=headers
    )
    assert (
        client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()["balance"]
        == 5275.0
    )


def test_the_third_payment_credits_fifty_and_a_refusal_credits_nothing(client, demo_auth):
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
    # 5000 + 1000 top-up + 25 welcome cashback - 60 paid + 50 payments cashback.
    assert answers[2]["rewards"] == [
        {"code": "three_payments", "title": "₹50 cashback", "amount": 50.0}
    ]
    assert (
        client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()["balance"]
        == 6015.0
    )


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
        == 45025.0
    )
    # A refused payment is not a notification-worthy event: nothing happened.
    inbox = client.get("/api/notifications", headers=headers).get_json()
    assert all(row["kind"] != "money_sent" or row["amount"] != 40001.0 for row in inbox["notifications"])


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
