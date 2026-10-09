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
`sum(awards) − sum(redemptions)` — two tables rather than a running total that
could drift from them.

Every function here leaves the commit to its caller, as everywhere else money
moves.
"""

import secrets
from datetime import datetime

from sqlalchemy import func

from .events import notify
from .extensions import db
from .ledger import credit_wallet
from .models import CoinAward, CoinRedemption, Notification, Transaction
from .money import paise_to_rupees
from .timeutils import utcnow

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
    """Lifetime coins, summed from the award log."""
    total = (
        db.session.query(func.coalesce(func.sum(CoinAward.coins), 0))
        .filter(CoinAward.user_id == user_id)
        .scalar()
    )
    return int(total or 0)


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
    somebody remembered to update. Idempotency is the caller's to guarantee —
    `award_for_payment` has `transaction_id` for it and `grant_signup_bonus`
    checks the reason.
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
    """Hand a new account its welcome coins, once and only once.

    Returns the bonus the first time and 0 on every later call, so it is safe to
    run on every sign-in: the code that creates an account and the code that
    reminds an existing one look identical from here. There is no transaction
    behind a welcome bonus — nothing moved — so `reason` is the guard rather
    than `transaction_id`. The caller owns the commit, so the coins land in the
    same transaction as the sign-in that revealed the account.
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
        Notification.REWARD,
        f"{SIGNUP_BONUS_COINS} coin welcome bonus",
        f"Welcome to WAULT. {SIGNUP_BONUS_COINS} coins are in your balance — "
        f"worth ₹{SIGNUP_BONUS_COINS * COIN_VALUE_PAISE // 100}. "
        f"Every coin is worth ₹1, and {REDEEM_MIN_COINS} coins redeem into your "
        f"wallet whenever you want them.",
        when=moment,
    )
    return SIGNUP_BONUS_COINS


def announce_payment(user_id: int, txn_id: int, when: datetime | None = None) -> int:
    """Pay out and tell the payer. Returns the coins awarded.

    Queues the inbox row; the caller still owns the commit, so the award and the
    note land in the same transaction as the payment that earned them.
    """
    earned = award_for_payment(user_id, txn_id, when)
    if not earned:
        return 0

    moment = when or utcnow()
    total = coin_balance(user_id) + earned
    notify(
        user_id,
        Notification.REWARD,
        f"{earned} {'coin' if earned == 1 else 'coins'} earned",
        f"That payment paid out {earned}. You have {total} "
        f"{'coin' if total == 1 else 'coins'} — worth ₹{total * COIN_VALUE_PAISE // 100}. "
        f"Redeem from {REDEEM_MIN_COINS} coins.",
        when=moment,
    )
    return earned


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


def snapshot(user_id: int, history: int = 5) -> dict:
    """Everything the coin chip and the coins sheet render.

    Deliberately small. The sheet shows a balance, what it is worth, whether it
    can be spent yet and what earned it — the same facts the wallet would put on
    a receipt, and nothing that needs a paragraph to explain.
    """
    earned = coins_earned(user_id)
    spent = coins_redeemed(user_id)
    balance = earned - spent
    payout = balance if balance >= REDEEM_MIN_COINS else 0

    recent = (
        CoinAward.query.filter(CoinAward.user_id == user_id)
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
                "at": row.created_at.isoformat(),
            }
            for row in recent
        ],
    }
