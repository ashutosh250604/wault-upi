"""Turning a spoken payment instruction into a payee and an amount.

The microphone is the browser's job. What arrives here is a transcript, and a
transcript is text nobody can be trusted to have said cleanly: "pay mom two
fifty", "pay nine zero zero zero zero zero zero zero zero four 500", "pay rohan
at ok vault". This module is the whole grammar, in one deterministic function,
so the behaviour is a table of pytest cases rather than a prompt.

Two rules shape it:

  - **It never guesses a payee.** Names are matched only against this user's own
    contacts and the people they have already paid, and a name that fits two of
    them comes back as a list to choose from. Resolving names against the global
    user table would pay a stranger who shares a first name, and would turn the
    endpoint into a way to discover who holds an account here.
  - **It never moves money.** The answer is an intent. The PIN is still the only
    thing that authorises a debit, on the screen that has always asked for it.

Nothing in here reads the request or writes a row, so the endpoint in
`blueprints/voice.py` stays a thin wrapper over a pure function.
"""

import re
import time
from difflib import get_close_matches

from flask import current_app
from sqlalchemy import or_

from .directory import classify_identifier, find_payee
from .extensions import db
from .models import Contact, Transaction, User
from .money import rupees_in_words

# The verbs that can open an instruction. Anything else is passed over rather
# than refused: people say "rohan 250" too, and the resolver below is scoped to
# the caller's own people, so a stray word cannot reach a stranger.
_VERBS = {"pay", "send", "transfer", "give", "bhej", "bhejo"}

# What a speaker says before the instruction itself. Stripped for the transcript
# the resolver reads; the raw words are still shown back to the user.
_WAKE = (
    ("hey", "wault"),
    ("ok", "wault"),
    ("okay", "wault"),
    ("wault",),
    ("hey",),
    ("ok",),
    ("okay",),
)

# Courtesy words people put after a request. "pay rohan 250 please" is one
# instruction, not a person called "Rohan 250 Please", the resolver reads the
# name, and a trailing courtesy would otherwise become part of it.
_FILLER = {"please", "pls", "thanks", "thank"}

_DIGIT_WORDS = {
    "zero": 0,
    "oh": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
}

_TEENS = {
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
}

_TENS = {
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
}

_SCALES = {
    "hundred": 100,
    "thousand": 1000,
    "lakh": 100_000,
    "lakhs": 100_000,
    "lac": 100_000,
    "crore": 10_000_000,
}

# How many interpretations one account may ask for in a minute. It is a guard
# against a script using the endpoint to grind through handles, not a product
# limit; the count is per process, which is enough for a demo deploy.
_RATE_LIMIT = 40
_RATE_WINDOW = 60.0
_calls: dict[int, list[float]] = {}


def throttled(user_id: int) -> bool:
    """True when this user has spent their interpretations for the minute."""
    now = time.monotonic()
    history = [stamp for stamp in _calls.get(user_id, []) if now - stamp < _RATE_WINDOW]
    history.append(now)
    _calls[user_id] = history
    return len(history) > _RATE_LIMIT


def _tokenise(raw) -> list[str]:
    """The words a speaker used, with the punctuation a recogniser adds removed.

    Recognisers punctuate and capitalise. Both are stripped, `at the rate` is
    folded into `at` (which `_join_handle` turns into the `@` a handle needs),
    and a thousands separator is taken out from *inside* a number, "2,500" is
    one sum, and splitting it would read as two.
    """
    text = str(raw or "").strip().lower()
    text = text.replace("₹", " ")
    text = re.sub(r"\b(?:rs\.?|inr|rupees?|rupaye|only)\b", " ", text)
    # A trailing zero fraction ("250.00") is just 250. A real fraction is
    # refused in `parse_command` before it ever gets here, because silently
    # paying ₹2 for "two point five" is the payer's instruction rewritten.
    text = re.sub(r"(\d+)\.\d+", r"\1", text)
    text = re.sub(r"(?<=\d),(?=\d)", "", text)
    text = re.sub(r"\bat\s+the\s+rate(?:\s+of)?\b", "at", text)
    text = re.sub(r"[^a-z0-9@]+", " ", text)
    return text.split()


def _strip_wake(tokens: list[str]) -> list[str]:
    for phrase in _WAKE:
        if tuple(tokens[: len(phrase)]) == phrase:
            return tokens[len(phrase) :]
    return tokens


def _strip_filler(tokens: list[str]) -> list[str]:
    """Drop the courtesy words people put after a request."""
    while tokens:
        if tokens[-1] in _FILLER:
            tokens.pop()
        elif len(tokens) >= 2 and tokens[-2] == "thank" and tokens[-1] == "you":
            del tokens[-2:]
        else:
            break
    return tokens


def _collapse_spoken_digits(tokens: list[str]) -> list[str]:
    """Join a number spoken digit by digit: "nine zero … four" -> "90000004".

    Only runs of six or more are joined, because below that the words are a sum
    ("five hundred") or the way people say 250 ("two fifty") rather than a
    number being spelled out.
    """
    out: list[str] = []
    run: list[str] = []

    def flush() -> None:
        if not run:
            return
        if len(run) >= 6:
            out.append("".join(str(_DIGIT_WORDS[word]) for word in run))
        else:
            out.extend(run)
        run.clear()

    for token in tokens:
        if token in _DIGIT_WORDS:
            run.append(token)
            continue
        flush()
        out.append(token)
    flush()
    return out


def _join_handle(tokens: list[str]) -> list[str]:
    """Fold "… at okvault" into the handle the wallet actually mints.

    A recogniser hears `@okwault` as two words and often as `okvault`, so the
    spoken tail is joined back up and snapped to the configured suffix when it is
    one letter away. Anything further off is left as it was heard and fails as an
    unknown handle, rather than being guessed into somebody's account.
    """
    if "at" not in tokens:
        return tokens
    index = tokens.index("at")
    head, tail = tokens[:index], tokens[index + 1 :]
    if not head or not tail:
        return tokens

    handle = "".join(tail)
    suffix = current_app.config.get("VPA_SUFFIX") or ""
    if suffix and get_close_matches(handle, [suffix], n=1, cutoff=0.78):
        handle = suffix
    return head[:-1] + [f"{head[-1]}@{handle}"]


def _is_amount_token(token: str) -> bool:
    """Whether this word can be part of a sum rather than part of a name."""
    if token in _DIGIT_WORDS or token in _TEENS or token in _TENS:
        return True
    if token in _SCALES or token == "and":
        return True
    # Ten digits or more is a mobile number, never an amount.
    return token.isdigit() and len(token) <= 9


def _amount_from_tokens(tokens: list[str]) -> int | None:
    """The rupees a run of words means, or None when it means nothing."""
    if not tokens:
        return None

    # "two fifty" is how 250 is said in India, and it is not arithmetic.
    if len(tokens) == 2 and tokens[0] in _DIGIT_WORDS and tokens[1] in _TENS:
        first = _DIGIT_WORDS[tokens[0]]
        second = _TENS[tokens[1]]
        if 1 <= first <= 9:
            return first * 100 + second

    total = 0
    current = 0
    seen = False
    for token in tokens:
        if token in _DIGIT_WORDS:
            current += _DIGIT_WORDS[token]
            seen = True
        elif token in _TEENS:
            current += _TEENS[token]
            seen = True
        elif token in _TENS:
            current += _TENS[token]
            seen = True
        elif token.isdigit() and len(token) <= 9:
            current += int(token)
            seen = True
        elif token == "and":
            continue
        elif token in _SCALES:
            scale = _SCALES[token]
            if scale == 100:
                current = (current or 1) * 100
            else:
                total += (current or 1) * scale
                current = 0
            seen = True
        else:
            return None
    return total + current if seen else None


def parse_command(raw) -> tuple[str | None, int | None, str | None]:
    """Read one instruction into `(payee_text, rupees, problem)`.

    Understands the shapes a person actually says: "pay Rohan 250", "pay 500 to
    Rohan", "pay Rohan", "pay 9000000004 five hundred". Anything else comes back
    as a problem with a sentence the caller can show as it is.
    """
    # A spoken decimal is refused rather than rounded: "two point five"
    # becoming ₹2 is the payer's own instruction quietly changed, and that is
    # not a rounding a wallet is allowed to make on somebody else's behalf.
    fractional = re.search(r"\d+\.(\d+)", str(raw or ""))
    if fractional and fractional.group(1).strip("0"):
        return None, None, "Voice payments are in whole rupees. Say a whole amount, like 250."

    tokens = _strip_wake(_tokenise(raw))

    if tokens and tokens[0] in _VERBS:
        tokens = tokens[1:]

    tokens = _strip_filler(tokens)

    if not tokens:
        return None, None, "Say who you want to pay, like “pay Rohan 250”."

    # Spoken digits are joined first: ten number words are one mobile number,
    # and reading them as a sum before this would never resolve anybody.
    tokens = _collapse_spoken_digits(tokens)

    if all(_is_amount_token(token) for token in tokens):
        return None, None, "Say who you want to pay, like “pay Rohan 250”."

    # "pay 500 to rohan" names the sum first.
    if "to" in tokens:
        index = tokens.index("to")
        target = _join_handle(tokens[index + 1 :])
        amount = _amount_from_tokens(tokens[:index])
        if amount is not None and target:
            return " ".join(target), amount, None

    # Otherwise the sum is the run of number words at the end, and the payee is
    # everything before it. The sum comes off before the handle is joined, so a
    # trailing "99" cannot be absorbed into "rohan at okwault".
    cut = len(tokens)
    while cut > 0 and _is_amount_token(tokens[cut - 1]):
        cut -= 1

    target = tokens
    amount = None
    if 0 < cut < len(tokens):
        parsed = _amount_from_tokens(tokens[cut:])
        if parsed is not None:
            target, amount = tokens[:cut], parsed

    target = _join_handle(target)
    if not target:
        return None, None, "Say who you want to pay, like “pay Rohan 250”."
    return " ".join(target), amount, None


def _person(payee: User, contact: Contact | None) -> dict:
    """One row, in the shape every people list in the app already uses."""
    return {
        "user_id": payee.id,
        "name": payee.name,
        "nickname": contact.nickname if contact else None,
        "vpa": payee.vpa,
        "mobile": payee.mobile,
        "is_saved": contact is not None,
    }


def _recent_payee_ids(user_id: int, limit: int = 200) -> list[int]:
    """People this user has transferred with, most recent first."""
    rows = (
        Transaction.query.filter(Transaction.type == "transfer")
        .filter(or_(Transaction.sender_id == user_id, Transaction.receiver_id == user_id))
        .order_by(Transaction.timestamp.desc(), Transaction.id.desc())
        .limit(limit)
        .all()
    )
    ordered: list[int] = []
    for txn in rows:
        other = txn.receiver_id if txn.sender_id == user_id else txn.sender_id
        if other and other != user_id and other not in ordered:
            ordered.append(other)
    return ordered


def candidates(user_id: int) -> list[dict]:
    """Everyone this user may pay by name: contacts first, then recent payees.

    Deliberately not the user table. A payee a person has never saved and never
    paid is not somebody they can summon by first name.
    """
    people: list[dict] = []
    seen: set[int] = set()

    contacts = Contact.query.filter_by(owner_id=user_id).all()
    contacts.sort(key=lambda contact: (not contact.is_favourite, contact.id))
    for contact in contacts:
        payee = contact.payee
        if payee is None or payee.id == user_id or not payee.name:
            continue
        people.append(_person(payee, contact))
        seen.add(payee.id)

    for payee_id in _recent_payee_ids(user_id):
        if payee_id in seen:
            continue
        payee = db.session.get(User, payee_id)
        if payee is None or not payee.name:
            continue
        contact = Contact.query.filter_by(owner_id=user_id, payee_id=payee_id).first()
        people.append(_person(payee, contact))
        seen.add(payee.id)

    return people


def _words(text) -> list[str]:
    return [word for word in re.split(r"[^a-z0-9]+", str(text or "").lower()) if word]


def _score(query: list[str], person: dict) -> int:
    """How well one spoken name fits one person, 0 when it does not.

    Nicknames lead because that is what people say out loud ("pay Mom"), then the
    name itself, then a prefix ("pay Roh"), which is the one loose match allowed,
    and it only ever ranks people the user already knows.
    """
    nickname = _words(person.get("nickname"))
    name = _words(person.get("name"))

    if nickname and nickname == query:
        return 100
    if name and name == query:
        return 95
    if nickname and set(query) <= set(nickname):
        return 90
    if name and set(query) <= set(name):
        return 85

    for words in (nickname, name):
        if words and all(
            len(word) >= 2 and any(candidate.startswith(word) for candidate in words)
            for word in query
        ):
            return 70
    return 0


def by_name(user_id: int, target: str) -> tuple[dict | None, list[dict]]:
    """Resolve a spoken name to one person, or to the people it could mean."""
    query = _words(target)
    if not query:
        return None, []

    scored = [(person, _score(query, person)) for person in candidates(user_id)]
    scored = [(person, score) for person, score in scored if score > 0]
    if not scored:
        return None, []

    scored.sort(key=lambda item: (-item[1], item[0].get("name") or ""))
    best = scored[0][1]
    top = [person for person, score in scored if score == best]
    if len(top) == 1:
        return top[0], []
    return None, top[:5]


def _reply(
    transcript: str,
    *,
    understood: bool = False,
    target: str | None = None,
    amount: int | None = None,
    payee: dict | None = None,
    matches: list[dict] | None = None,
    message: str = "",
) -> dict:
    return {
        "understood": understood,
        "transcript": transcript,
        "target": target,
        "amount": float(amount) if amount is not None else None,
        "amount_in_words": rupees_in_words(amount) if amount is not None else "",
        "payee": payee,
        "matches": matches or [],
        "message": message,
    }


def _spoken(raw) -> str:
    """What was heard, tidied for display but not rewritten."""
    return re.sub(r"\s+", " ", str(raw or "")).strip()


def _named(raw: str) -> str:
    """A spoken name, quoted the way a person would write it.

    Recognisers hand back lowercase, so echoing the transcript verbatim reads
    as a machine repeating itself: "No one called “ramesh”".
    """
    return " ".join(word[:1].upper() + word[1:] for word in raw.split())


def interpret(transcript, user_id: int) -> dict:
    """The whole answer: who, how much, and what to say if it cannot tell."""
    heard = _spoken(transcript)
    target, amount, problem = parse_command(transcript)

    if problem:
        return _reply(heard, message=problem)

    ceiling = current_app.config["MAX_TRANSFER_RUPEES"]
    if amount is not None and ceiling and amount > ceiling:
        return _reply(
            heard,
            target=target,
            amount=amount,
            message=f"One payment can be at most ₹{ceiling:,}.",
        )

    # ₹0 is what a misheard amount sounds like, and the confirm card must not
    # offer a payment the ledger is going to refuse.
    if amount == 0:
        return _reply(
            heard,
            target=target,
            amount=amount,
            message="A payment has to be more than ₹0. Say the amount again.",
        )

    # A handle or a number is looked up directly; a name only among people this
    # user already knows.
    vpa, mobile = classify_identifier(target)
    if vpa or mobile:
        payee = find_payee(vpa=vpa, mobile=mobile)
        if payee is None:
            return _reply(
                heard,
                target=target,
                amount=amount,
                message=f"No wallet is registered for {target}.",
            )
        if payee.id == user_id:
            return _reply(heard, target=target, amount=amount, message="That's your own account.")
        if not payee.name:
            return _reply(
                heard,
                target=target,
                amount=amount,
                message="That account hasn't finished setting up.",
            )
        contact = Contact.query.filter_by(owner_id=user_id, payee_id=payee.id).first()
        person = _person(payee, contact)
    else:
        person, matches = by_name(user_id, target)
        if matches:
            return _reply(
                heard,
                target=target,
                amount=amount,
                matches=matches,
                message=f"{len(matches)} people match “{_named(target)}”. Which one?",
            )
        if person is None:
            return _reply(
                heard,
                target=target,
                amount=amount,
                message=(
                    f"No one called “{_named(target)}” is in your contacts or recent payees."
                ),
            )

    label = person["nickname"] or person["name"]
    message = f"Paying {label} ₹{amount:,}" if amount is not None else f"Paying {label}"
    return _reply(
        heard,
        understood=True,
        target=target,
        amount=amount,
        payee=person,
        message=message,
    )
