"""The voice grammar's table of cases, and the endpoint in front of it.

Everything the microphone produces is text, so the interesting behaviour is a
function of a string, which is exactly what can be pinned down here. The speech
itself belongs to the browser and is not exercised; what is tested is every
decision the app makes *after* it has some words.
"""

from pytest import mark

from wallet import voice
from wallet.money import rupees_in_words

PIN = "1234"


def onboard(client, mobile, name):
    """Walk a new mobile through OTP -> name -> PIN and return its session."""
    otp = client.post("/api/start_login", json={"mobile": mobile}).get_json()["dev_otp"]
    payload = client.post(
        "/api/verify_otp", json={"mobile": mobile, "otp": otp}
    ).get_json()
    headers = {"Authorization": f"Bearer {payload['token']}"}
    client.post("/api/set_name", json={"name": name}, headers=headers)
    client.post("/api/set_pin", json={"pin": PIN}, headers=headers)
    return {"headers": headers, "user_id": payload["user_id"]}


def interpret(client, headers, transcript):
    response = client.post(
        "/api/voice/interpret", json={"transcript": transcript}, headers=headers
    )
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def save_contact(client, headers, identifier, nickname=None):
    response = client.post(
        "/api/contacts",
        json={"identifier": identifier, "nickname": nickname},
        headers=headers,
    )
    assert response.status_code in (200, 201), response.get_json()


@mark.parametrize(
    "amount,words",
    [
        (0, "zero"),
        (7, "seven"),
        (15, "fifteen"),
        (250, "two hundred fifty"),
        (1500, "one thousand five hundred"),
        (100000, "one lakh"),
        (123456, "one lakh twenty three thousand four hundred fifty six"),
        (1000000, "ten lakh"),
    ],
)
def test_amount_in_words(amount, words):
    assert rupees_in_words(amount) == words


@mark.parametrize(
    "said,target,amount",
    [
        # The three shapes the feature promises.
        ("pay Rohan 250", "rohan", 250),
        ("pay 500 to rohan", "rohan", 500),
        ("pay rohan", "rohan", None),
        # Sums said as words, in the Indian way, and with a separator.
        ("pay rohan five hundred", "rohan", 500),
        ("transfer two fifty to rohan", "rohan", 250),
        ("pay rohan one thousand five hundred", "rohan", 1500),
        ("pay 2,500 to rohan", "rohan", 2500),
        # A number spelled out digit by digit is a number, not a sum.
        ("pay nine zero zero zero zero zero zero zero zero four 250", "9000000004", 250),
        # A handle said as words, including the suffix a recogniser splits.
        ("pay rohan at ok vault", "rohan@okwault", None),
        ("pay rohan at okwault 99", "rohan@okwault", 99),
        # Punctuation, capitals and a wake word all come off.
        ("Pay Rohan 250.", "rohan", 250),
        ("Hey Wault, pay Rohan 250", "rohan", 250),
    ],
)
def test_parse_command(app, said, target, amount):
    with app.app_context():
        assert voice.parse_command(said)[:2] == (target, amount)


@mark.parametrize(
    "said",
    ["pay", "pay 500", "   ", "ok wault"],
)
def test_parse_command_asks_who(app, said):
    with app.app_context():
        assert voice.parse_command(said)[2] is not None


@mark.parametrize(
    "said,target,amount",
    [
        # Nobody is called "Rohan 250 Please".
        ("pay Rohan 250 please", "rohan", 250),
        ("pay Rohan please", "rohan", None),
        ("send 250 to Rohan please", "rohan", 250),
        ("pay Rohan 250, thanks", "rohan", 250),
        ("pay Rohan 250 thank you", "rohan", 250),
    ],
)
def test_courtesy_words_come_off_the_end(app, said, target, amount):
    with app.app_context():
        assert voice.parse_command(said)[:2] == (target, amount)


@mark.parametrize("said", ["pay Rohan 2.5", "pay Rohan 250.75"])
def test_a_fractional_amount_is_refused_rather_than_rounded(app, said):
    with app.app_context():
        target, amount, problem = voice.parse_command(said)
    # Refused outright: ₹2 on the card when ₹2.50 was said is a different sum.
    assert (target, amount) == (None, None)
    assert problem is not None
    assert "whole" in problem


@mark.parametrize("said", ["pay rohan 250.00", "pay 2,500 to rohan"])
def test_a_whole_decimal_or_a_separator_still_reads_as_its_sum(app, said):
    with app.app_context():
        _, amount, problem = voice.parse_command(said)
    assert problem is None
    assert amount in (250, 2500)


def test_a_zero_payment_is_refused_before_the_confirm_step(client, demo_auth):
    body = interpret(client, demo_auth["headers"], "pay 9000000006 0")
    assert body["payee"] is None
    assert body["understood"] is False
    assert "more than ₹0" in body["message"]


def test_voice_needs_a_session(client):
    response = client.post("/api/voice/interpret", json={"transcript": "pay rohan 250"})
    assert response.status_code == 401


def test_voice_rejects_an_empty_transcript(client, demo_auth):
    response = client.post(
        "/api/voice/interpret", json={"transcript": "   "}, headers=demo_auth["headers"]
    )
    assert response.status_code == 400


def test_voice_rejects_a_transcript_that_is_not_text(client, demo_auth):
    response = client.post(
        "/api/voice/interpret", json={"transcript": 42}, headers=demo_auth["headers"]
    )
    assert response.status_code == 400


def test_voice_resolves_a_saved_nickname(client, demo_auth):
    onboard(client, "9000000011", "Aarav Sharma")
    save_contact(client, demo_auth["headers"], "9000000011", nickname="mom")

    body = interpret(client, demo_auth["headers"], "pay mom 250")

    assert body["understood"] is True
    assert body["payee"]["name"] == "Aarav Sharma"
    assert body["payee"]["nickname"] == "mom"
    assert body["amount"] == 250
    assert body["amount_in_words"] == "two hundred fifty"
    assert body["matches"] == []


def test_voice_resolves_a_mobile_said_digit_by_digit(client, demo_auth):
    onboard(client, "9000000012", "Rohan Verma")

    body = interpret(
        client,
        demo_auth["headers"],
        "pay nine zero zero zero zero zero zero zero one two",
    )

    assert body["understood"] is True
    assert body["payee"]["mobile"] == "9000000012"
    assert body["amount"] is None


def test_voice_snaps_a_spoken_handle_to_the_prefix(client, demo_auth):
    onboard(client, "9000000013", "Neha Iyer")

    body = interpret(
        client,
        demo_auth["headers"],
        "pay nine zero zero zero zero zero zero zero one three at ok vault",
    )

    assert body["understood"] is True
    assert body["payee"]["vpa"] == "9000000013@okwault"


def test_voice_asks_between_two_people_with_one_name(client, demo_auth):
    onboard(client, "9000000014", "Sameer Rao")
    onboard(client, "9000000015", "Sameer Shah")
    save_contact(client, demo_auth["headers"], "9000000014")
    save_contact(client, demo_auth["headers"], "9000000015")

    body = interpret(client, demo_auth["headers"], "pay sameer 100")

    assert body["understood"] is False
    assert body["payee"] is None
    assert len(body["matches"]) == 2
    assert "which one" in body["message"].lower()
    # The sum is still read, so choosing a person does not mean saying it twice.
    assert body["amount"] == 100


def test_voice_reports_an_unknown_name(client, demo_auth):
    body = interpret(client, demo_auth["headers"], "pay zzz 100")

    assert body["understood"] is False
    assert body["payee"] is None
    assert body["matches"] == []
    assert "Zzz" in body["message"]


def test_voice_quotes_a_heard_name_the_way_it_is_written(client, demo_auth):
    # Recognisers return lowercase, so the reply must not read like an echo.
    body = interpret(client, demo_auth["headers"], "pay ramesh 100")

    assert "“Ramesh”" in body["message"]


def test_voice_refuses_your_own_account(client, demo_auth):
    body = interpret(client, demo_auth["headers"], "pay 9000000001 100")

    assert body["understood"] is False
    assert "own account" in body["message"]


def test_voice_refuses_a_sum_over_the_transfer_ceiling(client, demo_auth):
    onboard(client, "9000000016", "Kabir Menon")

    body = interpret(client, demo_auth["headers"], "pay 9000000016 nine lakh")

    assert body["understood"] is False
    assert body["amount"] == 900000
    assert "at most" in body["message"]


def test_voice_only_matches_people_the_user_knows(client, demo_auth):
    """A name nobody has saved or paid is not somebody the wallet can find."""
    onboard(client, "9000000017", "Ishaan Kapoor")

    body = interpret(client, demo_auth["headers"], "pay ishaan 100")

    assert body["understood"] is False
    assert body["matches"] == []

    save_contact(client, demo_auth["headers"], "9000000017")
    body = interpret(client, demo_auth["headers"], "pay ishaan 100")
    assert body["understood"] is True
    assert body["payee"]["mobile"] == "9000000017"


def test_voice_never_moves_money(client, demo_auth):
    """The answer is an intent: no balance changes and no ledger row appears."""
    onboard(client, "9000000018", "Tara Bose")
    before = client.get(
        f"/api/get_balance/{demo_auth['user_id']}", headers=demo_auth["headers"]
    ).get_json()["balance"]
    count_before = len(
        client.get(
            f"/api/transactions/{demo_auth['user_id']}", headers=demo_auth["headers"]
        ).get_json()
    )

    interpret(client, demo_auth["headers"], "pay 9000000018 250")

    after = client.get(
        f"/api/get_balance/{demo_auth['user_id']}", headers=demo_auth["headers"]
    ).get_json()["balance"]
    count_after = len(
        client.get(
            f"/api/transactions/{demo_auth['user_id']}", headers=demo_auth["headers"]
        ).get_json()
    )
    assert (before, count_before) == (after, count_after)
