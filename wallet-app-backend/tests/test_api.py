from wallet.config import _database_uri


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
    assert payload["vpa"] == "9000000001@demoupi"
    assert payload["balance"] == 5000.0


def test_protected_endpoints_require_token(client):
    assert client.get("/api/get_balance/1").status_code == 401
    assert client.get("/api/transactions/1").status_code == 401
    assert client.post("/api/transfer", json={"receiver_id": 2, "amount": 10}).status_code == 401
    assert client.post("/api/vpas/resolve", json={"vpa": "9000000002@demoupi"}).status_code == 401


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
        "/api/vpas/resolve", json={"vpa": "9000000002@demoupi"}, headers=headers
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
        "/api/topup", json={"user_id": user_id, "amount": 1000}, headers=headers
    )
    assert topup.status_code == 200
    assert topup.get_json()["new_balance"] == 6000.0

    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@demoupi"}, headers=headers
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

    balance = client.get(f"/api/get_balance/{user_id}", headers=headers).get_json()
    assert balance["balance"] == 5899.75


def test_transfer_rejects_self_and_insufficient_funds(client, demo_auth):
    headers = demo_auth["headers"]
    user_id = demo_auth["user_id"]
    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@demoupi"}, headers=headers
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
    assert named.get_json()["vpa"] == "9876543210@demoupi"

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
        "/api/vpas/resolve", json={"vpa": "9876543210@demoupi"}, headers=headers
    )
    assert self_resolve.status_code == 400


def test_transfer_requires_a_pin_that_the_server_verifies(client, demo_auth):
    headers = demo_auth["headers"]
    receiver = client.post(
        "/api/vpas/resolve", json={"vpa": "9000000002@demoupi"}, headers=headers
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
        "/api/vpas/resolve", json={"vpa": "9000000002@demoupi"}, headers=headers
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
    assert (
        client.get(f"/api/get_balance/{aarav['user_id']}", headers=aarav["headers"]).get_json()[
            "balance"
        ]
        == 5300.0
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
    again = client.post("/api/contacts", json={"identifier": "9000000088@demoupi"}, headers=headers)
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
