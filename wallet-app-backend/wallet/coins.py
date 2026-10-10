"""Coins: the small, always-on reward that pays you back for paying.

Every successful payment draws coins — somewhere between 1 and 50 — and a coin
is worth ₹1 the moment it is redeemed. Ten coins is the floor rather than the
step: clearing it redeems the whole balance straight into the wallet, so 11
coins pay ₹11 and 37 pay ₹37 with nothing left rounding behind. The redemption
goes through `credit_wallet`, so the money is a real ledger row with a real
balance behind it rather than a counter kept on the side.

A payment is not the only thing that pays coins. Every offer in
`wallet/rewards.py` pays in coins rather than in cash, and a new account is
handed a 50-coin welcome bonus the moment its first code is verified. All three
land in the same award log, each tagged with a `reason`, so the coin balance has
exactly one source and the sheet can say where a payout came from.

**The draw is not uniform, and it is not the client's.** Most payments pay out
1–5 coins; 6 and above get progressively rarer as they get larger, so a big
award is a genuine surprise rather than the average. The weights are below, and
the only thing that decides which one a payment lands on is `secrets` inside
this module: the API never accepts a number of coins from a request body, and
the amount is written to `coin_awards` before anything else looks at it.

**Awards are stored, not derived.** They used to be counted off the ledger —
every third transfer minted a coin — which worked only because the payout was a
fixed rule. A random payout has no such shortcut: the ledger says a payment
happened, not how much it paid, so the amount is recorded the moment the
transfer settles. `coin_awards.transaction_id` is unique, so a retried or
duplicated settle announces a payment once and once only, and the balance is
`sum(claimed awards) − sum(redemptions)` — two tables rather than a running
total that could drift from them.

**A draw counts when it is claimed, not when it is decided.** The amount is
drawn and written down the instant the payment settles, but the balance sums
only the awards that carry a `claimed_at` — and that is stamped by one thing:
the POST that scratches the card. So the number in the balance is always a
number the user has been shown, "you have N coins" and "your card paid N"
cannot disagree, and a payment's receipt can no longer announce a prize whose
card is still under its cover. It also makes the claim the only write that
moves the balance, which is what lets it be idempotent: a card is claimed by a
conditional UPDATE (`… WHERE scratched_at IS NULL`), so a refresh, a double
tap or two requests racing each other lift one cover and count one prize.

Every function here leaves the commit to its caller, as everywhere else money
moves.
"""

import secrets
from datetime import datetime

from sqlalchemy import func

from .events import notify
from .extensions import db
from .ledger import credit_wallet
from .models import CoinAward, CoinRedemption, Notification, Transaction, User
from .money import paise_to_rupees
from .timeutils import as_utc, utcnow

#: What one coin is worth when it is redeemed. Also the rate an offer pays at:
#: an offer worth ₹25 is worth 25 coins, so the two can never disagree.
COIN_VALUE_PAISE = 100
#: The fewest coins that can be redeemed — a floor to clear, not a step to count
#: in. Clearing it redeems the whole balance: 11 coins pay ₹11, 37 pay ₹37.
#: Rounding a balance down to tens used to hold the remainder back, which read as
#: the wallet keeping money the user had already earned.
REDEEM_MIN_COINS = 10
#: The range a single payment's award is drawn from.
AWARD_MIN_COINS = 1
AWARD_MAX_COINS = 50
#: The welcome bonus every account is handed once, on its first verified sign-in.
SIGNUP_BONUS_COINS = 50

#: Human labels for the reasons that are not offers. An offer's own title lives
#: in the catalogue, so it is mapped when the offer is described.
_REASON_LABELS = {
    CoinAward.REASON_PAYMENT: "Payment rewarded",
    CoinAward.REASON_SIGNUP: "Welcome bonus",
}


def award_label(reason: str) -> str:
    """One line for the coins sheet: where this payout came from."""
    return _REASON_LABELS.get(
        reason, "Offer reward" if reason.startswith(CoinAward.OFFER_PREFIX) else "Reward"
    )


def card_caption(reason: str) -> str:
    """What won a card, in one line — for the cards that are not payments.

    A payment's card names the payment instead (the client has the payee and the
    amount for that). This is the reason's own line: the welcome bonus, or the
    offer that paid it — the offer's headline rather than its amount, because
    the card already shows the coins.
    """
    if reason == CoinAward.REASON_SIGNUP:
        return "Welcome bonus"
    if reason.startswith(CoinAward.OFFER_PREFIX):
        code = reason[len(CoinAward.OFFER_PREFIX) :]
        # Imported here rather than at the top of the file: `rewards` imports
        # this module to pay its offers, so the catalogue can only be read
        # lazily, once both modules are loaded.
        from .rewards import OFFERS_BY_CODE

        offer = OFFERS_BY_CODE.get(code)
        return offer["headline"] if offer else "Offer reward"
    return award_label(reason)


class CoinError(Exception):
    """A redemption the wallet will not make, with the reason and HTTP status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _award_weights() -> list[int]:
    """The shape of the draw, as one weight per value from 1 to 50.

    Two pieces, because that is what the artwork's luck should feel like:

      - **1–5 coins.** A flat `HEAD_WEIGHT` each, which between them accounts
        for roughly 70% of every award. This is what a payment usually pays.
      - **6–50 coins.** Each step up the ladder is `TAIL_DECAY` of the one
        below, so 6 is common-ish, 12 is uncommon, 25 is rare and 50 is a story
        you tell someone. The weight is floored at 1 rather than allowed to
        round to zero, because "possible but unlikely" and "impossible" are not
        the same thing — 50 has to be reachable.
    """
    weights = [200] * 5
    weight = 100.0
    for _ in range(AWARD_MIN_COINS + 5, AWARD_MAX_COINS + 1):
        weights.append(max(1, round(weight)))
        weight *= 0.8
    return weights


_AWARD_WEIGHTS = _award_weights()


def award_weights() -> list[tuple[int, int]]:
    """`(coins, weight)` for every possible award — the odds, made inspectable."""
    return [(index + AWARD_MIN_COINS, weight) for index, weight in enumerate(_AWARD_WEIGHTS)]


def _draw_award() -> int:
    """One award, drawn on the server from a cryptographic source.

    `secrets` rather than `random`: the outcome decides money, and this is the
    same generator the OTPs come from.
    """
    remaining = secrets.randbelow(sum(_AWARD_WEIGHTS))
    for index, weight in enumerate(_AWARD_WEIGHTS):
        if remaining < weight:
            return index + AWARD_MIN_COINS
        remaining -= weight
    return AWARD_MIN_COINS  # unreachable; the weights always cover the draw


def _qualifying_payment(user_id: int, txn_id: int) -> bool:
    """True when this transaction is a payment by this user that earned coins.

    Money actually sent to someone else: a transfer that succeeded. A top-up, a
    request being paid *to* the user, or a failed transfer all draw nothing.
    """
    return (
        Transaction.query.filter(
            Transaction.id == txn_id,
            Transaction.type == "transfer",
            Transaction.sender_id == user_id,
            Transaction.status == "success",
        ).count()
        > 0
    )


def coins_earned(user_id: int) -> int:
    """Lifetime coins this user has been told about, summed from the award log.

    Claimed awards only. An unclaimed draw is decided and stored but nobody has
    been shown it, so it is not money yet — see the module docstring.
    """
    total = (
        db.session.query(func.coalesce(func.sum(CoinAward.coins), 0))
        .filter(CoinAward.user_id == user_id, CoinAward.claimed_at.isnot(None))
        .scalar()
    )
    return int(total or 0)


def cards_awaiting(user_id: int) -> int:
    """How many cards are still under their cover.

    Deliberately a count and not a total: what an unopened card is worth is the
    one thing the wallet is not allowed to say before it is scratched, so the
    home screen can say "2 cards to open" without a number that ruins the reveal.
    """
    return CoinAward.query.filter(
        CoinAward.user_id == user_id, CoinAward.scratched_at.is_(None)
    ).count()


def coins_redeemed(user_id: int) -> int:
    """Coins already spent, from the redemption log."""
    total = (
        db.session.query(func.coalesce(func.sum(CoinRedemption.coins), 0))
        .filter(CoinRedemption.user_id == user_id)
        .scalar()
    )
    return int(total or 0)


def coin_balance(user_id: int) -> int:
    """Coins in hand: what has been earned minus what has been spent."""
    return coins_earned(user_id) - coins_redeemed(user_id)


def grant(
    user_id: int,
    coins: int,
    reason: str = CoinAward.REASON_PAYMENT,
    when: datetime | None = None,
    transaction_id: int | None = None,
) -> int:
    """Write down an award. The caller owns the commit.

    Every coin that ever reaches a balance goes through here, so the award log
    has one writer and the balance stays a sum of rows rather than a total that
    somebody remembered to update. The row arrives **unclaimed** — the amount is
    decided and recorded, and `claim_card` is what makes it spendable — so
    writing an award here can never move a balance on its own. Idempotency is
    the caller's to guarantee — `award_for_payment` has `transaction_id` for it
    and `grant_signup_bonus` checks the reason.
    """
    db.session.add(
        CoinAward(
            user_id=user_id,
            coins=coins,
            reason=reason,
            transaction_id=transaction_id,
            created_at=when or utcnow(),
        )
    )
    return coins


def award_for_payment(user_id: int, txn_id: int, when: datetime | None = None) -> int:
    """Draw and record the coins a payment earned, exactly once.

    Returns the amount awarded, or 0 if this payment has already been paid out
    or is not the kind of transaction that earns coins. The uniqueness of
    `coin_awards.transaction_id` is the guard, checked here first and enforced by
    the database as well, so a double settle cannot mint a second award.
    """
    existing = CoinAward.query.filter_by(transaction_id=txn_id).first()
    if existing is not None:
        return 0
    if not _qualifying_payment(user_id, txn_id):
        return 0

    return grant(user_id, _draw_award(), CoinAward.REASON_PAYMENT, when, txn_id)


def grant_signup_bonus(user_id: int, when: datetime | None = None) -> int:
    """Hand a new account its welcome card, once and only once.

    Returns the bonus the first time and 0 on every later call, so it is safe to
    run on every sign-in: the code that creates an account and the code that
    reminds an existing one look identical from here. There is no transaction
    behind a welcome bonus — nothing moved — so `reason` is the guard rather
    than `transaction_id`. The caller owns the commit, so the card lands in the
    same transaction as the sign-in that revealed the account.

    The note in the inbox names the card and not the amount: the 50 coins are
    counted when the card is scratched, like every other prize.
    """
    existing = CoinAward.query.filter_by(
        user_id=user_id, reason=CoinAward.REASON_SIGNUP
    ).first()
    if existing is not None:
        return 0

    moment = when or utcnow()
    grant(user_id, SIGNUP_BONUS_COINS, CoinAward.REASON_SIGNUP, moment)
    notify(
        user_id,
        Notification.SCRATCH_CARD,
        "A welcome scratch card is waiting",
        "Open your scratch cards and scratch yours to reveal your welcome "
        "reward. Every coin is worth ₹1, and "
        f"{REDEEM_MIN_COINS} coins redeem into your wallet whenever you want them.",
        when=moment,
    )
    return SIGNUP_BONUS_COINS


def _payee_name(txn_id: int) -> str | None:
    """Who a payment went to, for the note that names them."""
    txn = db.session.get(Transaction, txn_id)
    if txn is None or not txn.receiver_id:
        return None
    payee = db.session.get(User, txn.receiver_id)
    return payee.name if payee else None


def announce_payment(user_id: int, txn_id: int, when: datetime | None = None) -> CoinAward | None:
    """Draw a card for a payment and tell the payer it is waiting.

    Returns the card (queued, not yet committed) or None when the payment drew
    nothing. The amount is deliberately not returned and not announced: it is a
    number the card holds until it is scratched, and a notification that names
    it would hand the prize over before the cover came off.

    Queues the inbox row; the caller still owns the commit, so the draw and the
    note land in the same transaction as the payment that earned them.
    """
    if not award_for_payment(user_id, txn_id, when):
        return None

    card = card_for_transaction(user_id, txn_id)
    moment = when or utcnow()
    payee = _payee_name(txn_id)
    notify(
        user_id,
        Notification.SCRATCH_CARD,
        "A scratch card is waiting",
        f"Your payment to {payee or 'someone'} left a card under its cover — "
        f"scratch it to reveal your reward.",
        when=moment,
    )
    return card


def redeem(user_id: int, coins: int | None = None, when: datetime | None = None) -> tuple[int, Transaction]:
    """Turn coins into wallet credit, all of them, at ₹1 each.

    A redemption takes the whole balance. The only gate is
    `REDEEM_MIN_COINS`: below it there is nothing to do, and at or above it the
    balance pays out in full — 11 coins pay ₹11 and leave nothing behind, which
    is what "1 coin = ₹1" has to mean to be true.

    `coins` remains accepted for callers that name an amount, but the only
    amount the wallet will take is the balance itself; naming a different one is
    a refusal rather than a partial payout. Omitting it redeems everything. The
    credit, the redemption row and the notification are all queued here; the
    caller commits.
    """
    moment = when or utcnow()
    available = coin_balance(user_id)

    def shortfall() -> CoinError:
        """Say why the payout can't happen, in coins — never "choose an amount"."""
        if available <= 0:
            return CoinError(
                f"You need {REDEEM_MIN_COINS} coins to redeem. Payments earn "
                f"{AWARD_MIN_COINS}–{AWARD_MAX_COINS} coins each."
            )
        return CoinError(
            f"You have {available} {('coin' if available == 1 else 'coins')} — "
            f"{REDEEM_MIN_COINS} are needed to redeem."
        )

    if available < REDEEM_MIN_COINS:
        raise shortfall()

    if coins is None:
        coins = available
    else:
        try:
            coins = int(coins)
        except (TypeError, ValueError):
            raise CoinError("Invalid number of coins") from None

        if coins <= 0:
            raise CoinError("Choose how many coins to redeem")
        if coins != available:
            raise CoinError(
                f"You have {available} {('coin' if available == 1 else 'coins')} — "
                f"a redemption takes all of them, and pays "
                f"₹{available * COIN_VALUE_PAISE // 100}."
            )

    paise = coins * COIN_VALUE_PAISE
    txn = credit_wallet(
        user_id,
        paise,
        txn_type="coins",
        note=f"{coins} coins redeemed",
        when=moment,
    )
    db.session.add(
        CoinRedemption(
            user_id=user_id,
            coins=coins,
            amount_paise=paise,
            transaction_id=txn.id,
            created_at=moment,
        )
    )
    notify(
        user_id,
        Notification.REWARD,
        f"₹{paise_to_rupees(paise):,.0f} added from coins",
        f"{coins} coins redeemed into your balance.",
        transaction=txn,
        when=moment,
    )
    return coins, txn


# --------------------------------------------------------------------------- #
# Scratch cards
#
# A draw is handed over under a cover, and the cover is the claim: the coins
# start counting when the card is scratched, not when the payment settles. So
# the card is the payout's only door — the collection is where a prize is
# collected, and an unopened card is not merely undisplayed, it is
# unspendable. The collection shows them all in one place, newest first, with
# the unopened ones' amounts absent from the payload entirely.
#
# Old rows are the exception and are handled in the migration: coins awarded
# before claiming existed were already spendable, so those rows are stamped
# claimed — a card that was never opened stays covered, and scratching it
# reveals an amount that was counted the first time.
# --------------------------------------------------------------------------- #


def card_for_transaction(user_id: int, txn_id: int) -> CoinAward | None:
    """The card a payment drew, so its receipt can hand the same card over."""
    return CoinAward.query.filter_by(user_id=user_id, transaction_id=txn_id).first()


def _card_payload(card: CoinAward, txn: Transaction | None, name: str | None) -> dict:
    """One card as the screen draws it.

    An unclaimed card's `coins` is null, and that is the point: the amount is
    the card's whole secret, so it travels only once the card has been claimed.
    Anything else — an amount on the wire that the screen declines to draw —
    would still be readable from a response, a screenshot or a cover that failed
    to paint, which is exactly what a card under a cover must not allow.

    Claiming is what fills it in, and the claim's own response carries the
    number, so the reveal is one round trip rather than a card that has to be
    re-fetched to find out what it paid.
    """
    # `as_utc` at the edge, like every other timestamp the API hands out: SQLite
    # returns a naive datetime for a UTC column, and a naive string on the wire
    # is read as the browser's own zone — which put a card won at 11:40 pm IST
    # on the screen at 6:10 pm.
    return {
        "id": card.id,
        "at": as_utc(card.created_at).isoformat(),
        # Where it came from, and what won it: a payment's card is named by its
        # payee and amount, everything else by its reason's own line.
        "reason": card.reason,
        "caption": card_caption(card.reason),
        "coins": card.coins if card.scratched_at is not None else None,
        "scratched": card.scratched_at is not None,
        "scratched_at": as_utc(card.scratched_at).isoformat() if card.scratched_at else None,
        "reference": txn.reference if txn else None,
        "paid_to": name,
        "amount": paise_to_rupees(txn.amount_paise) if txn else None,
        "note": txn.note if txn else None,
    }


def _card_payloads(cards: list[CoinAward]) -> list[dict]:
    """Payloads for a set of cards, with their payments read in two queries."""
    if not cards:
        return []

    txn_ids = [card.transaction_id for card in cards if card.transaction_id]
    transactions = {
        txn.id: txn
        for txn in Transaction.query.filter(Transaction.id.in_(txn_ids)).all()
    } if txn_ids else {}

    payee_ids = {txn.receiver_id for txn in transactions.values() if txn.receiver_id}
    names = {
        row.id: row.name
        for row in (User.query.filter(User.id.in_(payee_ids)).all() if payee_ids else [])
    }

    payloads = []
    for card in cards:
        txn = transactions.get(card.transaction_id)
        payloads.append(
            _card_payload(card, txn, names.get(txn.receiver_id) if txn else None)
        )
    return payloads


def card_collection(user_id: int, limit: int = 100) -> dict:
    """Every scratch card this user holds, newest first.

    Every coin award is a card: the draw a payment makes, each offer's payout,
    and the welcome bonus. They are one collection because they are one
    balance, and every one of them is a payout the user has not been told yet.
    """
    rows = (
        CoinAward.query.filter(CoinAward.user_id == user_id)
        .order_by(CoinAward.created_at.desc(), CoinAward.id.desc())
        .limit(limit)
        .all()
    )
    payloads = _card_payloads(rows)
    return {
        "cards": payloads,
        "total": len(payloads),
        "unscratched": sum(1 for card in payloads if not card["scratched"]),
    }


def claim_card(
    user_id: int, card_id: int, when: datetime | None = None
) -> tuple[CoinAward, int]:
    """Scratch one card: lift the cover, and let its coins count. Returns
    `(card, credited)` — the coins this call added to the balance, 0 if the card
    had already been claimed. The caller owns the commit.

    Refuses a card that is not this user's exactly like one that does not exist,
    so the collection cannot be probed for which ids are real.

    **Exactly one caller can claim a card, and the database decides which.** The
    cover comes off with a conditional `UPDATE … WHERE scratched_at IS NULL`,
    and the row count is the answer: the request that changed the row is the one
    that counts the coins, and a second tap, a refresh or two requests in
    flight at once all see 0 rows changed and credit nothing. Doing it as a
    read-then-write instead is what would credit twice — both requests read an
    unclaimed card, and both write.

    `claimed_at` is stamped only if this card has never been counted, which is
    what makes a pre-claim award (already in the balance — see the migration)
    reveal without paying out a second time.
    """
    card = db.session.get(CoinAward, card_id)
    if card is None or card.user_id != user_id:
        raise CoinError("Scratch card not found", 404)

    moment = when or utcnow()
    lift = CoinAward.query.filter(
        CoinAward.id == card_id,
        CoinAward.user_id == user_id,
        CoinAward.scratched_at.is_(None),
    ).update({"scratched_at": moment}, synchronize_session=False)

    credited = 0
    if lift:
        counted = CoinAward.query.filter(
            CoinAward.id == card_id,
            CoinAward.claimed_at.is_(None),
        ).update({"claimed_at": moment}, synchronize_session=False)
        if counted:
            credited = card.coins

    # The UPDATEs ran in the session's transaction, so the instance is stale.
    db.session.refresh(card)
    return card, credited


def card_view(user_id: int, card: CoinAward) -> dict:
    """One card's payload, for the response to scratching it."""
    return _card_payloads([card])[0]


def snapshot(user_id: int, history: int = 5) -> dict:
    """Everything the coin chip and the coins sheet render.

    Deliberately small. The sheet shows a balance, what it is worth, whether it
    can be spent yet and what earned it — the same facts the wallet would put on
    a receipt, and nothing that needs a paragraph to explain.

    Everything here is *claimed* coins. An unopened card contributes a count
    (`cards_waiting`) and not a single rupee: this is the list a user reads, and
    a prize it named would be a prize handed over before the cover came off.
    """
    earned = coins_earned(user_id)
    spent = coins_redeemed(user_id)
    balance = earned - spent
    payout = balance if balance >= REDEEM_MIN_COINS else 0

    recent = (
        CoinAward.query.filter(
            CoinAward.user_id == user_id, CoinAward.claimed_at.isnot(None)
        )
        .order_by(CoinAward.created_at.desc(), CoinAward.id.desc())
        .limit(history)
        .all()
    )

    return {
        "coins": balance,
        "value": paise_to_rupees(balance * COIN_VALUE_PAISE),
        "earned": earned,
        "redeemed": spent,
        "coin_value": paise_to_rupees(COIN_VALUE_PAISE),
        "min_redeem": REDEEM_MIN_COINS,
        # How many scratch cards are still under a cover, so the sheet can send
        # the user to them without saying what any of them is worth.
        "cards_waiting": cards_awaiting(user_id),
        # The payout on offer — the whole balance — and what it is worth. 0 below
        # the minimum, which is what the sheet's disabled button reads from.
        "redeemable": payout,
        "redeemable_value": paise_to_rupees(payout * COIN_VALUE_PAISE),
        # What the last few awards paid out and where they came from, newest
        # first. The label is the server's, so "where did these coins come
        # from" has one answer rather than one per screen.
        "awards": [
            {
                "coins": row.coins,
                "reason": row.reason,
                "label": award_label(row.reason),
                "at": as_utc(row.created_at).isoformat(),
            }
            for row in recent
        ],
    }
