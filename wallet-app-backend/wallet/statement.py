"""The branded PDF statement.

A downloaded statement should still look like WAULT. This module draws it
in the same "Ink & Seal" language the app uses — an ink band carrying the seal
mark, warm paper, hairline ledger rules, money set in bold numerals — and prints
the same facts the Transactions screen shows, so the file is readable without the
app.

The faces: reportlab's built-in Helvetica has no ₹ glyph, so the builder looks
for a Unicode font — a licensed face dropped into `wallet/assets/fonts/` first,
then the system's (the Docker image installs `fonts-dejavu-core` for exactly
this). When none is found the statement falls back to Helvetica with "INR" in
place of the rupee sign, and says so in the log, because a statement printed in
INR is a visible symptom rather than a quiet degradation.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Mapping, NamedTuple, Sequence
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from .money import paise_to_rupees
from .timeutils import format_date, format_datetime, format_time, to_ist

log = logging.getLogger(__name__)

# The same tokens index.css ships, so a printed statement and the screen agree.
# Warm cream, not white: the sheet is the brightest paper in the family, and the
# summary panel sits a step deeper in it, exactly as slips sit on the page.
PAPER = colors.HexColor("#f9efc0")
PAPER_DEEP = colors.HexColor("#ebd894")
PAPER_LINE = colors.HexColor("#cdb98f")
INK = colors.HexColor("#191916")
INK_SOFT = colors.HexColor("#4e4e49")
INK_MUTED = colors.HexColor("#6f6f68")
INK_FAINT = colors.HexColor("#9a9a90")
CREDIT = colors.HexColor("#177245")
# ink-300: the faint light ink used inside the ink band and for notes.
INK_HINT = colors.HexColor("#c0b9a5")

PENDING = colors.HexColor("#a3630f")

INK_FAINT_HEX = "#9a9a90"

_PAGE_WIDTH, _PAGE_HEIGHT = A4
_MARGIN = 36
_BAND_HEIGHT = 64
_TOP_MARGIN = _BAND_HEIGHT + 38
_BOTTOM_MARGIN = 56

_FONT_DIR = Path(__file__).with_name("assets") / "fonts"
_FONT_CANDIDATES: list[tuple[Path, Path]] = [
    # A deployment can drop a licensed font here to be fully branded.
    (_FONT_DIR / "DejaVuSans.ttf", _FONT_DIR / "DejaVuSans-Bold.ttf"),
    # Windows (development machines).
    (Path("C:/Windows/Fonts/segoeui.ttf"), Path("C:/Windows/Fonts/seguisb.ttf")),
    # Debian / Ubuntu (the container image).
    (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ),
    (
        Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
    ),
    # macOS.
    (
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ),
]


class _Fonts(NamedTuple):
    body: str
    bold: str
    mono: str
    #: "₹" when the face has the glyph, otherwise "INR " — the amount prefix.
    currency: str


@lru_cache(maxsize=1)
def _fonts() -> _Fonts:
    """Register the first usable Unicode face, once per process."""
    for regular, bold in _FONT_CANDIDATES:
        if not (regular.is_file() and bold.is_file()):
            continue
        try:
            if "WAULTSans" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("WAULTSans", str(regular)))
                pdfmetrics.registerFont(TTFont("WAULTSans-Bold", str(bold)))
        except Exception:  # A broken font file must not break the download.
            continue
        glyphs = getattr(pdfmetrics.getFont("WAULTSans").face, "charToGlyph", {})
        if ord("₹") in glyphs:
            log.info("Statement font %s carries the rupee sign", regular)
            return _Fonts("WAULTSans", "WAULTSans-Bold", "Courier", "₹")
        log.warning(
            "Statement font %s has no ₹ glyph — amounts will print as INR", regular
        )
        return _Fonts("WAULTSans", "WAULTSans-Bold", "Courier", "INR ")
    # Worth a warning rather than a silent fallback: "INR" on every line of a
    # downloaded statement is the visible symptom, and this is the cause.
    log.warning(
        "No Unicode font found for statements — amounts will print as INR. "
        "Install fonts-dejavu-core (the Docker image does) or drop a TTF into %s",
        _FONT_DIR,
    )
    return _Fonts("Helvetica", "Helvetica-Bold", "Courier", "INR ")


def _money(paise: int, currency: str) -> str:
    return f"{currency}{paise_to_rupees(paise):,.2f}"


def _day_label(when: datetime) -> str:
    """DD-MM-YYYY, in IST — the one date format the app and the statement share."""
    return format_date(when)


def _month_label(when: datetime) -> str:
    """The month banner, on the user's calendar rather than the server's."""
    return to_ist(when).strftime("%B %Y")


def _styles(fonts: _Fonts) -> dict[str, ParagraphStyle]:
    return {
        "label": ParagraphStyle(
            "label", fontName=fonts.body, fontSize=8, leading=11, textColor=INK_MUTED
        ),
        "value": ParagraphStyle(
            "value", fontName=fonts.bold, fontSize=9.5, leading=13, textColor=INK
        ),
        "head": ParagraphStyle(
            "head", fontName=fonts.bold, fontSize=8, leading=10, textColor=PAPER
        ),
        "headRight": ParagraphStyle(
            "headRight",
            fontName=fonts.bold,
            fontSize=8,
            leading=10,
            textColor=PAPER,
            alignment=TA_RIGHT,
        ),
        "body": ParagraphStyle(
            "body", fontName=fonts.body, fontSize=8.5, leading=11, textColor=INK_SOFT
        ),
        "date": ParagraphStyle(
            "date", fontName=fonts.body, fontSize=8.5, leading=11, textColor=INK
        ),
        "dateTime": ParagraphStyle(
            "dateTime", fontName=fonts.body, fontSize=7.5, leading=10, textColor=INK_FAINT
        ),
        "reference": ParagraphStyle(
            "reference", fontName=fonts.mono, fontSize=7.5, leading=10, textColor=INK_SOFT
        ),
        "amount": ParagraphStyle(
            "amount",
            fontName=fonts.bold,
            fontSize=9,
            leading=12,
            textColor=INK,
            alignment=TA_RIGHT,
        ),
        "credit": ParagraphStyle(
            "credit",
            fontName=fonts.bold,
            fontSize=9,
            leading=12,
            textColor=CREDIT,
            alignment=TA_RIGHT,
        ),
        "statLabel": ParagraphStyle(
            "statLabel", fontName=fonts.body, fontSize=8, leading=11, textColor=INK_SOFT
        ),
        "statValue": ParagraphStyle(
            "statValue", fontName=fonts.bold, fontSize=14, leading=17, textColor=INK
        ),
        "statCredit": ParagraphStyle(
            "statCredit", fontName=fonts.bold, fontSize=14, leading=17, textColor=CREDIT
        ),
        "note": ParagraphStyle(
            "note", fontName=fonts.body, fontSize=7.5, leading=11, textColor=INK_MUTED
        ),
        "month": ParagraphStyle(
            "month", fontName=fonts.bold, fontSize=9, leading=12, textColor=INK
        ),
        "monthRight": ParagraphStyle(
            "monthRight",
            fontName=fonts.body,
            fontSize=8,
            leading=12,
            textColor=INK_SOFT,
            alignment=TA_RIGHT,
        ),
        "empty": ParagraphStyle(
            "empty", fontName=fonts.bold, fontSize=11, leading=15, textColor=INK
        ),
    }


# The brand's own app-icon tile, the same file the web app serves from
# `public/brand/`. Kept in the package rather than reached for across the repo,
# because a deployment ships the backend and not the frontend's source tree.
_BRAND_MARK = Path(__file__).with_name("assets") / "brand" / "wault-icon.png"


def _draw_brand_mark(canvas, x: float, y: float, size: float) -> None:
    """Stamp the WAULT mark, bottom-left corner at (x, y).

    The supplied artwork itself, not a redrawing of it. This letterhead used to
    replay the app's vector geometry in four strokes and two rounded rectangles,
    which meant the statement carried a *version* of the logo for as long as it
    took the two to drift — and the drift is what a brand audit finds. One PNG,
    used by the app, the QR code and this page.

    The mark is square and carries its own transparent corners, so `size` is both
    its width and its height. If the file is somehow absent the band simply
    prints without it: a letterhead missing its mark is a bad statement, but a
    crash while someone is downloading one is worse.
    """
    try:
        canvas.drawImage(
            ImageReader(str(_BRAND_MARK)),
            x,
            y,
            width=size,
            height=size,
            mask="auto",
        )
    except Exception:  # pragma: no cover - a missing asset must not break a download
        log.warning("Brand mark not drawn: %s is unreadable", _BRAND_MARK)


def _draw_page(canvas, doc, *, period_label: str, generated_label: str) -> None:
    """Warm page, ink band with the seal, hairline footer. Runs before content."""
    fonts = _fonts()
    canvas.saveState()

    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, _PAGE_WIDTH, _PAGE_HEIGHT, stroke=0, fill=1)

    band_top = _PAGE_HEIGHT - _BAND_HEIGHT
    canvas.setFillColor(INK)
    canvas.rect(0, band_top, _PAGE_WIDTH, _BAND_HEIGHT, stroke=0, fill=1)

    mark_size = 26
    _draw_brand_mark(canvas, _MARGIN, band_top + 19, mark_size)

    text_left = _MARGIN + mark_size + 9
    canvas.setFillColor(PAPER)
    canvas.setFont(fonts.bold, 15)
    canvas.drawString(text_left, band_top + 32, "WAULT")

    canvas.setFont(fonts.body, 8.5)
    canvas.setFillColor(INK_HINT)
    canvas.drawString(text_left, band_top + 21, "Transaction statement")

    canvas.setFillColor(PAPER)
    canvas.setFont(fonts.bold, 10)
    canvas.drawRightString(_PAGE_WIDTH - _MARGIN, band_top + 32, period_label)
    canvas.setFillColor(INK_HINT)
    canvas.setFont(fonts.body, 8.5)
    canvas.drawRightString(
        _PAGE_WIDTH - _MARGIN, band_top + 21, f"Generated {generated_label}"
    )

    # Footer: a rule, the provenance, the page number.
    canvas.setStrokeColor(PAPER_LINE)
    canvas.setLineWidth(0.6)
    canvas.line(_MARGIN, 42, _PAGE_WIDTH - _MARGIN, 42)
    canvas.setFillColor(INK_MUTED)
    canvas.setFont(fonts.body, 7.5)
    canvas.drawString(_MARGIN, 32, "Built from the WAULT ledger — the same rows the app shows, in IST.")
    canvas.setFont(fonts.mono, 7.5)
    canvas.setFillColor(INK_SOFT)
    canvas.drawRightString(_PAGE_WIDTH - _MARGIN, 32, f"Page {doc.page}")

    canvas.restoreState()


def _meta_table(
    styles: Mapping[str, ParagraphStyle],
    *,
    holder_name: str,
    holder_vpa: str,
    period_label: str,
    entries: int,
) -> Table:
    def label(text: str) -> Paragraph:
        return Paragraph(text, styles["label"])

    def value(text: str) -> Paragraph:
        return Paragraph(escape(text), styles["value"])

    table = Table(
        [
            [label("Account holder"), value(holder_name), label("Period"), value(period_label)],
            [label("UPI ID"), value(holder_vpa or "—"), label("Entries"), value(str(entries))],
        ],
        colWidths=[82, 156, 52, 233],
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("LINEABOVE", (0, 0), (-1, 0), 0.8, INK),
                ("LINEBELOW", (0, -1), (-1, -1), 0.5, PAPER_LINE),
            ]
        )
    )
    return table


def _summary_table(
    styles: Mapping[str, ParagraphStyle],
    *,
    money_in: int,
    money_out: int,
    opening_paise: int,
    closing_paise: int,
    currency: str,
    entries: int,
) -> Table:
    """The account summary, in the shape a bank statement uses.

    Opening balance, total credits, total debits, net change and closing balance
    — the five figures that let a reader check the arithmetic instead of trusting
    it. Three columns by two rows keeps each number large enough to read at a
    glance, which a five-across row does not.

    Every figure is worked out by the caller from the same rows the table
    below prints, so the panel can only ever agree with the ledger.
    """
    net = money_in - money_out

    def label(text: str) -> Paragraph:
        return Paragraph(text, styles["statLabel"])

    def value(paise: int) -> Paragraph:
        return Paragraph(_money(paise, currency), styles["statValue"])

    table = Table(
        [
            [label("Opening balance"), label("Total credits"), label("Total debits")],
            [value(opening_paise), value(money_in), value(money_out)],
            [label("Net change"), label("Closing balance"), label("Entries")],
            [
                Paragraph(
                    f"{'+' if net > 0 else '-' if net < 0 else ''}"
                    f"{_money(abs(net), currency)}",
                    styles["statCredit"] if net > 0 else styles["statValue"],
                ),
                value(closing_paise),
                Paragraph(str(entries), styles["statValue"]),
            ],
        ],
        colWidths=[175, 175, 173],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PAPER_DEEP),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, 0), 11),
                ("BOTTOMPADDING", (0, 0), (-1, 1), 1),
                ("TOPPADDING", (0, 2), (-1, 2), 9),
                ("BOTTOMPADDING", (0, 2), (-1, 3), 1),
                ("BOTTOMPADDING", (0, 3), (-1, 3), 12),
                # A hairline between the two blocks, the way the entries are ruled.
                ("LINEABOVE", (0, 2), (-1, 2), 0.5, PAPER_LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    return table


def _month_groups(rows: Sequence, viewer_id: int) -> list[dict]:
    """Split the ledger by calendar month, with each month's own totals.

    A statement covering one month is what people are used to, and a long
    statement is easier to read a month at a time — so the entries are grouped
    and each group is subtotalled. The order is the order they arrive in, which
    the caller has already sorted oldest-first.
    """
    groups: list[dict] = []
    for row in rows:
        label = _month_label(row.timestamp)
        if not groups or groups[-1]["label"] != label:
            groups.append({"label": label, "rows": [], "credits": 0, "debits": 0})
        group = groups[-1]
        if row.sender_id == viewer_id:
            group["debits"] += row.amount_paise
        else:
            group["credits"] += row.amount_paise
        group["rows"].append(row)
    return groups


def _ledger_table(
    styles: Mapping[str, ParagraphStyle],
    groups: Sequence[dict],
    *,
    viewer_id: int,
    counterparties: Mapping[int, object],
    currency: str,
    type_labels: Mapping[str, str],
    self_labels: Mapping[str, str],
) -> Table:
    """Every entry, grouped by month, each month introduced by its own totals.

    The month banner is what makes a long statement navigable: it answers "what
    did this month do?" without the reader adding up rows by hand. Its figures
    are summed from the same rows printed beneath it.
    """
    head = [
        Paragraph("Date", styles["head"]),
        Paragraph("Details", styles["head"]),
        Paragraph("Reference", styles["head"]),
        Paragraph("Status", styles["head"]),
        Paragraph(f"Amount ({currency.strip()})", styles["headRight"]),
    ]

    data: list[list] = [head]
    banners: list[int] = []

    for group in groups:
        banners.append(len(data))
        # The totals sit in column 2, not column 4: a SPAN takes its content
        # from the *first* cell it covers, so a right-aligned figure in the last
        # column would simply be dropped.
        data.append(
            [
                Paragraph(f"<b>{group['label']}</b>", styles["month"]),
                "",
                Paragraph(
                    f"Credits {_money(group['credits'], currency)}"
                    f"&nbsp;&nbsp;&nbsp;Debits {_money(group['debits'], currency)}",
                    styles["monthRight"],
                ),
                "",
                "",
            ]
        )

        for row in group["rows"]:
            outgoing = row.sender_id == viewer_id
            counterparty = counterparties.get(
                row.receiver_id if outgoing else row.sender_id
            )
            name = (
                counterparty.name
                if counterparty is not None
                else self_labels.get(row.type, "WAULT")
            )
            entry_type = type_labels.get(row.type, "Payment")

            when = to_ist(row.timestamp)
            status_style = styles["body"]
            if row.status == "failed":
                status_style = ParagraphStyle(
                    "failed", parent=styles["body"], textColor=SEAL
                )
            elif row.status == "pending":
                status_style = ParagraphStyle(
                    "pending", parent=styles["body"], textColor=PENDING
                )

            details = f"<b>{escape(name or 'WAULT')}</b><br/>{entry_type}"
            if row.note:
                details += (
                    f"<br/><font color='{INK_FAINT_HEX}'><i>{escape(row.note)}</i></font>"
                )

            amount = _money(row.amount_paise, currency)
            amount_text = f"+{amount}" if not outgoing else f"-{amount}"
            amount_style = styles["amount"] if outgoing else styles["credit"]

            data.append(
                [
                    Paragraph(
                        f"{format_date(when)}<br/>"
                        f"<font color='{INK_FAINT_HEX}'>{format_time(when)}</font>",
                        styles["date"],
                    ),
                    Paragraph(details, styles["body"]),
                    Paragraph(escape(row.reference), styles["reference"]),
                    Paragraph(row.status.capitalize(), status_style),
                    Paragraph(amount_text, amount_style),
                ]
            )

    rules = [
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, PAPER_LINE),
    ]
    for index in banners:
        # The month name gets the left half of the row, its totals the right half.
        rules += [
            ("SPAN", (0, index), (1, index)),
            ("SPAN", (2, index), (-1, index)),
            ("BACKGROUND", (0, index), (-1, index), PAPER_DEEP),
            ("LINEABOVE", (0, index), (-1, index), 0.7, INK),
            ("TOPPADDING", (0, index), (-1, index), 8),
            ("BOTTOMPADDING", (0, index), (-1, index), 8),
        ]

    table = Table(data, colWidths=[62, 176, 116, 56, 113], repeatRows=1)
    table.setStyle(TableStyle(rules))
    return table


def build_statement_pdf(
    *,
    holder_name: str,
    holder_vpa: str,
    viewer_id: int,
    rows: Sequence,
    counterparties: Mapping[int, object],
    period_label: str,
    generated_at: datetime,
    type_labels: Mapping[str, str],
    self_labels: Mapping[str, str],
    wallet_balance_paise: int,
    movement_after_paise: int = 0,
) -> bytes:
    """Render one statement to PDF bytes.

    `rows` are ledger rows ordered oldest-first; each must expose `reference`,
    `type`, `status`, `amount_paise`, `timestamp`, `note`, `sender_id` and
    `receiver_id`. Money is formatted from the statement owner's point of view:
    credits carry a "+", debits a "-", and the credits are the green ones.

    The balances are derived, not guessed. `wallet_balance_paise` is the live
    balance the app shows, and `movement_after_paise` is the signed total of
    everything that happened *after* this period — so the closing balance is the
    wallet as it stood at the end of the window, and the opening balance is that
    minus the period's own movement. The two are therefore always consistent
    with each other and with the entries printed between them, whatever window
    the user asked for.
    """
    fonts = _fonts()
    styles = _styles(fonts)
    currency = fonts.currency

    # Stamped in IST: the reader's clock, not the server's.
    generated_label = f"{format_datetime(generated_at)} IST"

    buffer = io.BytesIO()
    doc = BaseDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=_MARGIN,
        rightMargin=_MARGIN,
        topMargin=_TOP_MARGIN,
        bottomMargin=_BOTTOM_MARGIN,
        title=f"WAULT transaction statement — {period_label}",
        author="WAULT",
        subject=f"WAULT transaction statement for {holder_name}",
    )
    frame = Frame(
        _MARGIN,
        _BOTTOM_MARGIN,
        _PAGE_WIDTH - 2 * _MARGIN,
        _PAGE_HEIGHT - _TOP_MARGIN - _BOTTOM_MARGIN,
        id="statement",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    doc.addPageTemplates(
        [
            PageTemplate(
                id="page",
                frames=[frame],
                onPage=lambda canvas, document: _draw_page(
                    canvas, document, period_label=period_label, generated_label=generated_label
                ),
            )
        ]
    )

    money_in = sum(row.amount_paise for row in rows if row.sender_id != viewer_id)
    money_out = sum(row.amount_paise for row in rows if row.sender_id == viewer_id)
    net = money_in - money_out
    closing = wallet_balance_paise - movement_after_paise
    opening = closing - net

    story: list = [
        _meta_table(
            styles,
            holder_name=holder_name,
            holder_vpa=holder_vpa,
            period_label=period_label,
            entries=len(rows),
        ),
        Spacer(1, 14),
        _summary_table(
            styles,
            money_in=money_in,
            money_out=money_out,
            opening_paise=opening,
            closing_paise=closing,
            currency=currency,
            entries=len(rows),
        ),
        Spacer(1, 7),
        # The panel is checkable by hand, so print the sum it rests on. "Net
        # change" on its own invites the wrong reading — that it is the balance
        # left in the wallet — and a reader with a calculator has no way to
        # settle the argument.
        Paragraph(
            f"Opening balance {_money(opening, currency)} plus total credits "
            f"{_money(money_in, currency)} minus total debits "
            f"{_money(money_out, currency)} equals the closing balance of "
            f"{_money(closing, currency)}. Amounts are shown from the account "
            "holder's point of view, and the closing balance is the wallet at "
            "the end of this period.",
            styles["note"],
        ),
        Spacer(1, 18),
    ]

    if rows:
        story.append(
            _ledger_table(
                styles,
                _month_groups(rows, viewer_id),
                viewer_id=viewer_id,
                counterparties=counterparties,
                currency=currency,
                type_labels=type_labels,
                self_labels=self_labels,
            )
        )
    else:
        story.append(Paragraph("No transactions in this period.", styles["empty"]))
        story.append(Spacer(1, 6))
        story.append(
            Paragraph(
                "Choose a wider range — or make a payment — and download the statement again.",
                styles["note"],
            )
        )

    story.append(Spacer(1, 14))
    story.append(
        Paragraph(
            "Each month is subtotalled from the entries printed under it. Money in is "
            "credited, money out is debited, and the month totals add up to the account "
            "summary above. Balances and limits are enforced on the server, and this "
            "statement is generated from the same ledger the app reads.",
            styles["note"],
        )
    )

    doc.build(story)
    return buffer.getvalue()
