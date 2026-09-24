"""CSV ingestion: sniff, map, normalise.

Bank exports disagree about almost everything - delimiter, header row,
whether spending is negative, whether debits and credits share a column,
how dates are written. This module turns any of them into one canonical
frame:

    date         datetime64   (day resolution)
    description  str          raw text from the bank
    amount       float        signed: negative = money OUT, positive = money IN
    category     str          from the file if it had one, else ""
    account      str          from the file, else the file name
    balance      float        running balance if the file had one, else NaN
    source       str          file the row came from

Categorisation and transfer detection happen later (categorize.py) so the
column mapping can be inspected and overridden before any of that runs.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

# Header names we recognise, in priority order. Matching is done on a
# normalised header (lower-case, punctuation collapsed to spaces).
DATE_NAMES = [
    "transaction date", "trans date", "date", "posted date", "posting date",
    "post date", "booking date", "value date", "effective date", "settlement date",
]
DESC_NAMES = [
    "description", "merchant", "payee", "name", "merchant name", "details",
    "transaction description", "memo", "narrative", "reference", "counterparty",
]
AMOUNT_NAMES = ["amount", "transaction amount", "amt", "value", "amount usd", "net amount"]
DEBIT_NAMES = ["debit", "debits", "withdrawal", "withdrawals", "money out", "paid out", "debit amount", "outflow", "spent"]
CREDIT_NAMES = ["credit", "credits", "deposit", "deposits", "money in", "paid in", "credit amount", "inflow", "received"]
CATEGORY_NAMES = ["category", "categories", "category name", "spending category", "budget category", "master category"]
ACCOUNT_NAMES = ["account", "account name", "account number", "card", "card number", "card member", "source account"]
BALANCE_NAMES = ["balance", "running balance", "available balance", "ledger balance", "running bal"]
TYPE_NAMES = ["type", "transaction type", "debit credit", "dr cr", "cr dr", "credit debit indicator", "direction"]

DEBIT_WORDS = {"debit", "dr", "d", "withdrawal", "out", "sale", "purchase", "charge", "outflow"}
CREDIT_WORDS = {"credit", "cr", "c", "deposit", "in", "return", "refund", "inflow"}


@dataclass
class ColumnMap:
    """Which source column feeds each canonical field (None = absent)."""

    date: str | None = None
    description: str | None = None
    amount: str | None = None
    debit: str | None = None
    credit: str | None = None
    category: str | None = None
    account: str | None = None
    balance: str | None = None
    type_col: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class IngestReport:
    """What happened to one file on the way in - shown in the UI's diagnostics."""

    source: str
    rows_read: int = 0
    rows_kept: int = 0
    rows_bad_date: int = 0
    rows_bad_amount: int = 0
    header_row: int = 0
    delimiter: str = ","
    mapping: dict = field(default_factory=dict)
    sign_flipped: bool = False
    sign_reason: str = ""
    european_decimals: bool = False
    notes: list[str] = field(default_factory=list)


def _norm_header(h: str) -> str:
    h = str(h).replace("﻿", "").strip().lower()
    h = re.sub(r"[^a-z0-9]+", " ", h)
    return h.strip()


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            text = data.decode(enc)
        except UnicodeDecodeError:
            continue
        # utf-16 will "succeed" on plenty of 8-bit input; reject obvious garbage.
        if enc == "utf-16" and "\x00" not in data[:200].decode("latin-1"):
            continue
        return text
    return data.decode("latin-1", errors="replace")


def _sniff_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        counts = {d: sample.count(d) for d in (",", ";", "\t", "|")}
        return max(counts, key=counts.get)


def _find_header_row(lines: list[str], delim: str) -> int:
    """Banks love a preamble ("Account: ****1234", "Statement period ...").

    The header is the first line within the first 40 that has at least two
    fields and mentions something date-like AND something amount-like.
    """
    date_keys = ("date",)
    money_keys = ("amount", "debit", "credit", "withdrawal", "deposit", "value", "money", "amt", "paid")
    for i, line in enumerate(lines[:40]):
        cells = [_norm_header(c) for c in next(csv.reader([line], delimiter=delim), [])]
        if len(cells) < 2:
            continue
        joined = " | ".join(cells)
        if any(k in joined for k in date_keys) and any(k in joined for k in money_keys):
            return i
    return 0


def read_csv_bytes(data: bytes, source: str = "upload.csv") -> tuple[pd.DataFrame, IngestReport]:
    """Parse raw CSV bytes into a DataFrame of strings (no typing yet)."""
    report = IngestReport(source=source)
    text = _decode(data)
    lines = text.splitlines()
    sample = "\n".join(lines[:60])
    delim = _sniff_delimiter(sample)
    header = _find_header_row(lines, delim)
    report.delimiter = delim
    report.header_row = header
    if header:
        report.notes.append(f"Skipped {header} preamble line(s) above the header.")
    df = pd.read_csv(
        io.StringIO("\n".join(lines[header:])),
        sep=delim,
        dtype=str,
        keep_default_na=False,
        skip_blank_lines=True,
        engine="python",
        on_bad_lines="skip",
    )
    # Drop fully empty columns (trailing delimiters produce "Unnamed: 7").
    df = df.loc[:, [c for c in df.columns if not (str(c).startswith("Unnamed") and (df[c].astype(str).str.strip() == "").all())]]
    df.columns = [str(c).replace("﻿", "").strip() for c in df.columns]
    report.rows_read = len(df)
    return df, report


def _pick(headers: dict[str, str], names: list[str], exclude: set[str]) -> str | None:
    # exact normalised match first, then "contains" match
    for n in names:
        for norm, orig in headers.items():
            if orig not in exclude and norm == n:
                return orig
    for n in names:
        for norm, orig in headers.items():
            if orig not in exclude and re.search(rf"\b{re.escape(n)}\b", norm):
                return orig
    return None


def guess_columns(df: pd.DataFrame) -> ColumnMap:
    headers = {_norm_header(c): c for c in df.columns}
    used: set[str] = set()
    m = ColumnMap()

    def take(names):
        col = _pick(headers, names, used)
        if col is not None:
            used.add(col)
        return col

    m.date = take(DATE_NAMES)
    m.debit = take(DEBIT_NAMES)
    m.credit = take(CREDIT_NAMES)
    m.amount = take(AMOUNT_NAMES)
    m.balance = take(BALANCE_NAMES)
    m.category = take(CATEGORY_NAMES)
    m.description = take(DESC_NAMES)
    m.account = take(ACCOUNT_NAMES)
    m.type_col = take(TYPE_NAMES)

    # If there's an amount column, a lone debit/credit column is usually a
    # type flag rather than a second money column - check it holds numbers.
    for attr in ("debit", "credit"):
        col = getattr(m, attr)
        if col is not None and _numeric_share(df[col]) < 0.3:
            setattr(m, attr, None)
            if m.type_col is None and df[col].str.strip().str.lower().isin(DEBIT_WORDS | CREDIT_WORDS).mean() > 0.5:
                m.type_col = col

    if m.amount is None and m.debit is None and m.credit is None:
        # Last resort: the most numeric-looking column that isn't the balance.
        best, best_share = None, 0.0
        for c in df.columns:
            if c in used:
                continue
            share = _numeric_share(df[c])
            if share > best_share:
                best, best_share = c, share
        if best_share > 0.8:
            m.amount = best

    if m.description is None:
        # Longest average text column that isn't already used.
        cands = [c for c in df.columns if c not in used and _numeric_share(df[c]) < 0.5]
        if cands:
            m.description = max(cands, key=lambda c: df[c].astype(str).str.len().mean())

    if m.date is None:
        for c in df.columns:
            if c in used:
                continue
            parsed = pd.to_datetime(df[c].head(50), errors="coerce", format="mixed")
            if parsed.notna().mean() > 0.8:
                m.date = c
                break
    return m


_NUM_RE = re.compile(r"^\(?[-+]?\s*[$€£¥]?\s*[-+]?\d[\d,.\s']*\)?\s*(-|cr|dr)?$", re.I)


def _numeric_share(s: pd.Series) -> float:
    v = s.astype(str).str.strip()
    v = v[v != ""]
    if v.empty:
        return 0.0
    return float(v.str.match(_NUM_RE).mean())


def _is_european(s: pd.Series) -> bool:
    v = s.astype(str).str.strip()
    v = v[v != ""]  # a Deposit column is mostly blank - judge the values that exist
    if v.empty:
        return False
    euro = v.str.contains(r"\d,\d{2}(?:\s*(?:cr|dr|-))?$", case=False, regex=True) & ~v.str.contains(r"\.\d{2}(?:\s*(?:cr|dr|-))?$", case=False, regex=True)
    return bool(euro.mean() > 0.5)


def parse_amount(s: pd.Series, european: bool | None = None) -> tuple[pd.Series, bool]:
    """'$1,234.56', '(12.00)', '12.00-', '45.10 CR', '1.234,56' -> float."""
    txt = s.astype(str).str.strip()
    if european is None:
        european = _is_european(txt)
    upper = txt.str.upper()
    neg = (
        (txt.str.startswith("(") & txt.str.endswith(")"))
        | txt.str.endswith("-")
        | upper.str.endswith("DR")
        | txt.str.replace(r"[\s$€£¥(]", "", regex=True).str.startswith("-")
    )
    cleaned = txt.str.replace(r"(?i)(cr|dr)$", "", regex=True)
    if european:
        cleaned = cleaned.str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
    else:
        cleaned = cleaned.str.replace(",", "", regex=False)
    cleaned = cleaned.str.replace(r"[^0-9.]", "", regex=True)
    val = pd.to_numeric(cleaned.replace("", np.nan), errors="coerce").abs()
    val = val.where(~neg, -val)
    return val.astype(float), european


def detect_dayfirst(s: pd.Series) -> bool:
    """31/12/2025 can only be day-first; 12/31/2025 only month-first. Look for
    either kind of proof in the column; with none (all days <= 12), assume
    month-first, the US bank default."""
    parts = s.astype(str).str.strip().str.extract(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}")
    parts = parts.dropna().astype(int)
    if parts.empty:
        return False
    first_big = bool((parts[0] > 12).any())
    second_big = bool((parts[1] > 12).any())
    return first_big and not second_big


def parse_dates(s: pd.Series, dayfirst: bool | None = None) -> pd.Series:
    txt = s.astype(str).str.strip()
    if dayfirst is None:
        dayfirst = detect_dayfirst(txt)
    out = pd.to_datetime(txt, errors="coerce", dayfirst=dayfirst, format="mixed")
    try:
        out = out.dt.tz_localize(None)
    except (TypeError, AttributeError):
        pass
    return out.dt.normalize()


def decide_sign_flip(amount: pd.Series, has_split_columns: bool, has_type: bool) -> tuple[bool, str]:
    """Should positive numbers be read as spending?

    Checking-account exports: most rows are purchases and are negative.
    Many credit-card exports (Amex, some Citi) print purchases as positive
    and payments as negative. If a file is dominated by positive numbers it is
    almost certainly the latter.
    """
    if has_split_columns:
        return False, "Separate debit/credit columns - sign taken from the column."
    if has_type:
        return False, "Direction taken from the transaction-type column."
    a = amount.dropna()
    if a.empty:
        return False, "No amounts."
    pos = float((a > 0).mean())
    if pos > 0.65:
        return True, f"{pos:.0%} of amounts are positive - reading this as a card export where purchases are positive."
    return False, f"{1 - pos:.0%} of amounts are negative - reading negative as money out."


def normalize(
    raw: pd.DataFrame,
    cmap: ColumnMap,
    report: IngestReport,
    *,
    flip_sign: bool | None = None,
    dayfirst: bool | None = None,
) -> pd.DataFrame:
    """Apply a ColumnMap to a raw string frame -> canonical frame."""
    out = pd.DataFrame(index=raw.index)
    if cmap.date is None:
        raise ValueError(f"{report.source}: could not find a date column - pick one in the column mapping.")
    if dayfirst is None:
        dayfirst = detect_dayfirst(raw[cmap.date])
        if dayfirst:
            report.notes.append("Dates read as day-first (found days above 12 in the first position).")
    out["date"] = parse_dates(raw[cmap.date], dayfirst=dayfirst)

    split = cmap.debit is not None or cmap.credit is not None
    if split and cmap.amount is None:
        # Decide the decimal convention once, from both money columns together.
        both = pd.concat([raw[c] for c in (cmap.debit, cmap.credit) if c])
        eu = _is_european(both)
        debit = parse_amount(raw[cmap.debit], european=eu)[0] if cmap.debit else pd.Series(np.nan, index=raw.index)
        credit = parse_amount(raw[cmap.credit], european=eu)[0] if cmap.credit else pd.Series(np.nan, index=raw.index)
        report.european_decimals = eu
        amount = credit.abs().fillna(0) - debit.abs().fillna(0)
        amount[debit.isna() & credit.isna()] = np.nan
    elif cmap.amount is not None:
        amount, report.european_decimals = parse_amount(raw[cmap.amount])
    else:
        raise ValueError(f"{report.source}: could not find an amount (or debit/credit) column.")

    has_type = False
    if cmap.type_col is not None and not split:
        t = raw[cmap.type_col].astype(str).str.strip().str.lower()
        is_debit = t.isin(DEBIT_WORDS) | t.str.contains("debit|withdraw|purchase", regex=True)
        is_credit = t.isin(CREDIT_WORDS) | t.str.contains("credit|deposit|refund", regex=True)
        # Only trust the type column when the amounts are unsigned.
        if (amount.dropna() >= 0).mean() > 0.95 and (is_debit | is_credit).mean() > 0.8:
            has_type = True
            amount = amount.abs().where(~is_debit, -amount.abs())

    auto_flip, reason = decide_sign_flip(amount, split and cmap.amount is None, has_type)
    flip = auto_flip if flip_sign is None else flip_sign
    if flip_sign is not None:
        reason = "Manual override: " + ("positive = spending." if flip_sign else "negative = spending.")
    if flip:
        amount = -amount
    report.sign_flipped = bool(flip)
    report.sign_reason = reason
    out["amount"] = amount

    out["description"] = (raw[cmap.description].astype(str).str.strip() if cmap.description else "")
    out["category"] = (raw[cmap.category].astype(str).str.strip() if cmap.category else "")
    out["account"] = (raw[cmap.account].astype(str).str.strip() if cmap.account else report.source.rsplit(".", 1)[0])
    stem = report.source.rsplit(".", 1)[0]
    out.loc[out["account"] == "", "account"] = stem
    # "Account #: -31009" on its own says nothing - tie it to the file it came from.
    numeric_acct = out["account"].str.fullmatch(r"[-\d\s*xX#.]+")
    out.loc[numeric_acct, "account"] = stem + " (" + out.loc[numeric_acct, "account"].str.strip(" -*#") + ")"
    if cmap.balance:
        out["balance"], _ = parse_amount(raw[cmap.balance], european=report.european_decimals)
    else:
        out["balance"] = np.nan
    out["source"] = report.source

    report.rows_bad_date = int(out["date"].isna().sum())
    report.rows_bad_amount = int(out["amount"].isna().sum())
    out = out.dropna(subset=["date", "amount"])
    out = out[out["amount"] != 0]
    report.rows_kept = len(out)
    report.mapping = cmap.as_dict()
    if report.rows_bad_date:
        report.notes.append(f"{report.rows_bad_date} row(s) dropped: unreadable date.")
    if report.rows_bad_amount:
        report.notes.append(f"{report.rows_bad_amount} row(s) dropped: unreadable amount.")
    return out.reset_index(drop=True)


def dedupe(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Remove rows that appear in more than one uploaded FILE.

    Overlapping statement exports are the usual cause. Identical rows inside
    a single file are left alone - two $4.50 coffees on the same day are real,
    and the duplicate-charge detector is the right place to question them.
    """
    if df.empty or df["source"].nunique() < 2:
        return df, 0
    key = ["date", "amount", "description", "account"]
    df = df.copy()
    df["_n"] = df.groupby(key + ["source"]).cumcount()
    before = len(df)
    df = df.drop_duplicates(subset=key + ["_n"], keep="first").drop(columns="_n")
    return df.reset_index(drop=True), before - len(df)


def load_budgets(data: bytes) -> pd.DataFrame:
    """Budget CSV: a category column and a monthly amount column."""
    raw, _ = read_csv_bytes(data, "budgets.csv")
    headers = {_norm_header(c): c for c in raw.columns}
    cat = _pick(headers, ["category", "name", "budget category", "item"], set())
    amt = _pick(headers, ["monthly budget", "budget", "monthly", "amount", "limit", "target"], {cat} if cat else set())
    if cat is None or amt is None:
        if len(raw.columns) >= 2:
            cat, amt = raw.columns[0], raw.columns[1]
        else:
            raise ValueError("Budget file needs a category column and an amount column.")
    val, _ = parse_amount(raw[amt])
    out = pd.DataFrame({"category": raw[cat].astype(str).str.strip(), "monthly_budget": val.abs()})
    return out.dropna().query("category != ''").drop_duplicates("category", keep="last").reset_index(drop=True)
