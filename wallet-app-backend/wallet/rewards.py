"""Offers that actually pay.

The strip on the home screen used to be decoration: tapping a card apologised
that rewards were not live. This module makes the promise real. An offer is a
target, a payout and an expiry date; progress is counted from the ledger rather
than kept in a counter, so it can't drift from what actually happened; and the
payout lands in the coin balance, through the one function that writes coin
awards (`coins.grant`).

**Offers pay in coins, not cashback.** They used to credit rupees straight into
the balance, which meant two reward currencies on one screen — a cashback strip
that quietly moved your money, and a coins chip that was a separate game of its
own. There is now one reward currency. Because a coin redeems at ₹1, an offer
worth ₹25 pays 25 coins and is worth exactly what it always was; the difference
is that the payout is visible where every other payout is, and the coin balance
is the only number a user has to watch.

The catalogue lives here, in code, and not in the database: an offer is a promise
with terms, and terms belong somewhere reviewable.
"""

from datetime import datetime, timedelta

from . import coins
from .events import notify
from .extensions import db
from .models import CoinAward, Notification, Reward, Transaction
from .money import paise_to_rupees
from .timeutils import as_utc, utcnow

# The offers shown to every account. `metric` names the ledger fact that counts
# towards the target, and `min_paise` is the size an event has to reach to
# qualify (a ₹1 top-up should not unlock a 25-coin payout).
OFFERS = (
    {
        "code": "first_topup",
        "title": "25 coins",
        "headline": "On your first top-up",
        "detail": (
            "Add ₹100 or more to your wallet for the first time and 25 coins land "
            "in your coin balance. One per account."
        ),
        "reward_coins": 25,
        "target": 1,
        "metric": "topup",
        "min_paise": 10000,
        "unit": "top-up",
        "valid_days": 30,
    },
    {
        "code": "three_payments",
        "title": "50 coins",
        "headline": "On your next 3 payments",
        "detail": (
            "Send money to anyone three times — any amount, any payee — and 50 coins "
            "are credited as soon as the third payment settles."
        ),
        "reward_coins": 50,
        "target": 3,
        "metric": "transfer_out",
        "min_paise": 0,
        "unit": "payment",
        "valid_days": 30,
    },
    {
        "code": "first_money_in",
        "title": "10 coins",
        "headline": "When someone pays you",
        "detail": (
            "The first time another WAULT account sends you money, 10 coins are "
            "credited on top. Ask for it with a money request, or share your QR."
        ),
        "reward_coins": 10,
        "target": 1,
        "metric": "transfer_in",
        "min_paise": 0,
        "unit": "incoming payment",
        "valid_days": 60,
    },
)

OFFERS_BY_CODE = {offer["code"]: offer for offer in OFFERS}

# The order the card strip renders in: active first, then what paid out, then
# what lapsed.
_STATUS_ORDER = {Reward.ACTIVE: 0, Reward.CREDITED: 1, Reward.EXPIRED: 2}


def _count(user_id: int, metric: str, since: datetime, min_paise: int = 0) -> int:
    """How many qualifying ledger events this user has since `since`."""
    query = Transaction.query.filter(
        Transaction.status == "success",
        Transaction.timestamp >= since,
    )
    if metric == "topup":
        query = query.filter(
            Transaction.type == "topup", Transaction.receiver_id == user_id
        )
    elif metric == "transfer_out":
        query = query.filter(
            Transaction.type == "transfer", Transaction.sender_id == user_id
        )
    elif metric == "transfer_in":
        query = query.filter(
            Transaction.type == "transfer", Transaction.receiver_id == user_id
        )
    else:  # pragma: no cover - a typo in the catalogue, not user input
        raise ValueError(f"Unknown reward metric: {metric}")

    if min_paise:
        query = query.filter(Transaction.amount_paise >= min_paise)
    return query.count()


def progress(reward: Reward) -> int:
    """Qualifying events so far, capped at the target.

    Counted from `started_at`, so an offer taken up today never claims credit for
    payments made last week. Every payable ledger type is a `transfer` or a
    `topup`, and a coin payout is neither, so an offer can never count its own
    payout towards its own target.
    """
    offer = OFFERS_BY_CODE.get(reward.code)
    if offer is None:
        return 0
    done = _count(reward.user_id, offer["metric"], as_utc(reward.started_at), offer["min_paise"])
    return min(done, offer["target"])


def ensure_rewards(user_id: int, now: datetime | None = None) -> list[Reward]:
    """Give this user a row per offer, and lapse the ones that timed out.

    Idempotent, and safe to call on every read, because the unique constraint on
    (user_id, code) makes a duplicate insert impossible rather than merely
    unlikely.
    """
    moment = now or utcnow()
    existing = {reward.code: reward for reward in Reward.query.filter_by(user_id=user_id)}

    for offer in OFFERS:
        if offer["code"] in existing:
            continue
        reward = Reward(
            user_id=user_id,
            code=offer["code"],
            status=Reward.ACTIVE,
            started_at=moment,
            expires_at=moment + timedelta(days=offer["valid_days"]),
        )
        db.session.add(reward)
        existing[offer["code"]] = reward
    db.session.flush()

    for reward in existing.values():
        expires_at = as_utc(reward.expires_at)
        if reward.status == Reward.ACTIVE and expires_at and expires_at < moment:
            reward.status = Reward.EXPIRED
            reward.updated_at = moment

    return [existing[offer["code"]] for offer in OFFERS if offer["code"] in existing]


def settle_due(user_id: int, now: datetime | None = None) -> list[Reward]:
    """Pay out every offer this user has just completed.

    Called from the payment paths while the money's own transaction is still
    open, so the coins land in the same commit as the payment that earned them —
    there is no window where a payment succeeded and its reward silently did not.
    Idempotent: a credited row is skipped, so replaying a payment can't pay twice.

    `now` should be the instant of the event being settled (`txn.timestamp`),
    not the wall clock. An account's offers are activated on first sight, which
    for a brand-new user happens inside the very first payment or top-up — and
    activation at `utcnow()` would stamp `started_at` *after* the transaction
    that triggered it, so the event would be disqualified from its own offer and
    a new account's first top-up would silently earn nothing. Passing the
    event's own timestamp makes the offer start at the event it is about.

    The caller owns the commit, as everywhere else money moves.
    """
    moment = now or utcnow()
    credited: list[Reward] = []

    for reward in ensure_rewards(user_id, moment):
        if reward.status != Reward.ACTIVE:
            continue
        offer = OFFERS_BY_CODE.get(reward.code)
        if offer is None or progress(reward) < offer["target"]:
            continue

        # The award carries the offer's own code, so a coin in the balance can
        # always be traced back to the promise that paid it.
        coins.grant(
            user_id,
            offer["reward_coins"],
            f"{CoinAward.OFFER_PREFIX}{offer['code']}",
            moment,
        )
        reward.status = Reward.CREDITED
        reward.credited_at = moment
        reward.updated_at = moment
        notify(
            user_id,
            Notification.REWARD,
            f"{offer['title']} earned",
            f"{offer['headline']} · added to your coin balance",
            when=moment,
        )
        credited.append(reward)

    return credited


def describe(reward: Reward, now: datetime | None = None) -> dict | None:
    """One offer as the client renders it, or None for a retired offer code."""
    offer = OFFERS_BY_CODE.get(reward.code)
    if offer is None:
        return None

    moment = now or utcnow()
    done = progress(reward)
    return {
        "code": reward.code,
        "title": offer["title"],
        "headline": offer["headline"],
        "detail": offer["detail"],
        # The payout, as coins and as what those coins are worth. Both are sent
        # because the card leads with the coins and the receipt may want the
        # money — and because a coin's redemption rate is not the client's to
        # assume.
        "coins": offer["reward_coins"],
        "reward": paise_to_rupees(offer["reward_coins"] * coins.COIN_VALUE_PAISE),
        "target": offer["target"],
        "progress": done,
        "unit": offer["unit"],
        "status": reward.status,
        "started_at": as_utc(reward.started_at).isoformat() if reward.started_at else None,
        "expires_at": as_utc(reward.expires_at).isoformat() if reward.expires_at else None,
        "credited_at": as_utc(reward.credited_at).isoformat()
        if reward.credited_at
        else None,
        # True once the target is met but before the next payment settles it —
        # which is what lets the card say "you've earned it" honestly.
        "earned": reward.status == Reward.ACTIVE and done >= offer["target"],
    }


def list_for(reward_rows: list[Reward], now: datetime | None = None) -> list[dict]:
    """Describe a user's rewards, best-looking first."""
    moment = now or utcnow()
    described = [
        payload
        for payload in (describe(reward, moment) for reward in reward_rows)
        if payload is not None
    ]
    described.sort(
        key=lambda item: (
            _STATUS_ORDER.get(item["status"], 3),
            -item["progress"] / max(item["target"], 1),
        )
    )
    return described


def credited_summary(rewards: list[Reward]) -> list[dict]:
    """Tiny payload for the payment response: what the payment just unlocked."""
    summary = []
    for reward in rewards:
        offer = OFFERS_BY_CODE.get(reward.code)
        if offer is None:
            continue
        summary.append(
            {
                "code": reward.code,
                "title": offer["title"],
                "coins": offer["reward_coins"],
                "amount": paise_to_rupees(offer["reward_coins"] * coins.COIN_VALUE_PAISE),
            }
        )
    return summary
