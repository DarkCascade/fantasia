import pandas as pd
import pytest

from neon_ledger import categorize, ingest
from neon_ledger.pipeline import FileSpec, load


def _norm(text: str, name: str = "t.csv", **kw) -> tuple[pd.DataFrame, ingest.IngestReport]:
    raw, rep = ingest.read_csv_bytes(text.encode(), name)
    return ingest.normalize(raw, ingest.guess_columns(raw), rep, **kw), rep


@pytest.mark.parametrize("txt,val", [
    ("$1,234.56", 1234.56), ("(12.00)", -12.0), ("12.00-", -12.0), ("45.10 CR", 45.10), ("45.10 DR", -45.10),
    ("-7", -7.0), ("€ 3.50", 3.5), ("", None),
])
def test_parse_amount(txt, val):
    out, _ = ingest.parse_amount(pd.Series([txt]), european=False)
    if val is None:
        assert pd.isna(out.iloc[0])
    else:
        assert out.iloc[0] == pytest.approx(val)


def test_european_decimals_and_semicolons():
    df, rep = _norm("Datum;Omschrijving;Bedrag\n01-02-2025;Albert Heijn;-1.234,56\n02-02-2025;Salaris;2.500,00\n03-02-2025;Koffie;-3,20\n")
    assert rep.delimiter == ";"
    assert rep.european_decimals
    assert df["amount"].tolist() == pytest.approx([-1234.56, 2500.0, -3.2])


def test_european_split_columns_with_blanks():
    txt = ("Date;Payee;Withdrawal;Deposit\n01/02/2025;RENT;1.450,00;\n02/02/2025;LIDL;12,34;\n"
           "03/02/2025;SHELL;40,00;\n15/02/2025;PAYROLL;;2.100,00\n")
    df, rep = _norm(txt)
    assert rep.european_decimals
    assert df["amount"].tolist() == pytest.approx([-1450.0, -12.34, -40.0, 2100.0])
    assert df["date"].iloc[-1] == pd.Timestamp("2025-02-15")


def test_preamble_is_skipped():
    df, rep = _norm("Account: 1234\nStatement period: Jan\n\nDate,Description,Amount\n2025-01-02,Coffee,-4.50\n2025-01-03,Pay,100\n")
    assert rep.header_row == 3
    assert len(df) == 2


def test_split_debit_credit_columns():
    df, rep = _norm("Date,Description,Debit,Credit\n2025-01-02,Coffee,4.50,\n2025-01-03,Payroll,,2000.00\n")
    assert df["amount"].tolist() == pytest.approx([-4.5, 2000.0])
    assert not rep.sign_flipped


def test_unsigned_amount_with_type_column():
    df, _ = _norm("Date,Description,Amount,Type\n2025-01-02,Coffee,4.50,DEBIT\n2025-01-03,Payroll,2000.00,CREDIT\n2025-01-04,Gas,30,DEBIT\n")
    assert df["amount"].tolist() == pytest.approx([-4.5, 2000.0, -30.0])


def test_card_export_positive_purchases_is_flipped():
    rows = "\n".join(f"2025-01-{d:02d},STORE {d},{10 + d}.00" for d in range(1, 20))
    df, rep = _norm("Date,Description,Amount\n" + rows + "\n2025-01-25,PAYMENT THANK YOU,-200.00\n")
    assert rep.sign_flipped
    assert (df["amount"].iloc[:-1] < 0).all()
    assert df["amount"].iloc[-1] == 200.0


def test_manual_sign_override_wins():
    rows = "\n".join(f"2025-01-{d:02d},STORE,{d}.00" for d in range(1, 10))
    df, rep = _norm("Date,Description,Amount\n" + rows, flip_sign=False)
    assert not rep.sign_flipped and (df["amount"] > 0).all()


def test_dayfirst():
    df, _ = _norm("Date,Description,Amount\n03/04/2025,x,-1\n", dayfirst=True)
    assert df["date"].iloc[0] == pd.Timestamp("2025-04-03")


def test_dayfirst_autodetect():
    df, rep = _norm("Date,Description,Amount\n01/02/2025,x,-1\n13/02/2025,y,-2\n")
    assert df["date"].tolist() == [pd.Timestamp("2025-02-01"), pd.Timestamp("2025-02-13")]
    df, _ = _norm("Date,Description,Amount\n01/02/2025,x,-1\n02/13/2025,y,-2\n")
    assert df["date"].tolist() == [pd.Timestamp("2025-01-02"), pd.Timestamp("2025-02-13")]


def test_dedupe_only_across_files():
    a = "Date,Description,Amount\n2025-01-02,Coffee,-4.50\n2025-01-02,Coffee,-4.50\n"
    b = "Date,Description,Amount\n2025-01-02,Coffee,-4.50\n2025-01-05,Lunch,-12.00\n"
    loaded = load([FileSpec("a.csv", a.encode()), FileSpec("b.csv", b.encode())])
    # Same account name is needed for a cross-file match; default account is the file stem, so force one.
    assert loaded.removed_dupes == 0
    a2 = "Date,Description,Amount,Account\n2025-01-02,Coffee,-4.50,Chk\n2025-01-02,Coffee,-4.50,Chk\n"
    b2 = "Date,Description,Amount,Account\n2025-01-02,Coffee,-4.50,Chk\n2025-01-05,Lunch,-12.00,Chk\n"
    loaded = load([FileSpec("a.csv", a2.encode()), FileSpec("b.csv", b2.encode())])
    assert loaded.removed_dupes == 1  # the in-file double coffee survives
    assert (loaded.tx["description"] == "Coffee").sum() == 2


def test_budget_file():
    b = ingest.load_budgets(b"Category,Monthly Budget\nDining,$350\nRent,2000\n")
    assert b.set_index("category")["monthly_budget"].to_dict() == {"Dining": 350.0, "Rent": 2000.0}


# ------------------------------------------------------------------ categorize

@pytest.mark.parametrize("desc,merchant", [
    ("SQ *BLUE BOTTLE COFFEE", "Blue Bottle Coffee"),
    ("AMZN MKTP US*2K4LZ91", "Amazon"),
    ("STARBUCKS STORE 08812", "Starbucks"),
    ("ZELLE PAYMENT TO OAKRIDGE APARTMENTS LLC", "Oakridge Apartments Llc"),
    ("POS DEBIT TST* THE HOLLOW DINER 12/03", "The Hollow Diner"),
])
def test_clean_merchant(desc, merchant):
    assert categorize.clean_merchant(desc) == merchant


def _tx(rows):
    df = pd.DataFrame(rows, columns=["date", "description", "amount"])
    df["date"] = pd.to_datetime(df["date"])
    for c, v in (("category", ""), ("account", "a"), ("balance", float("nan")), ("source", "s")):
        df[c] = v
    return categorize.enrich(df)


def test_kinds():
    t = _tx([
        ("2025-01-01", "ACME PAYROLL DIR DEP", 2000.0),
        ("2025-01-02", "ONLINE TRANSFER TO SAVINGS", -300.0),
        ("2025-01-03", "VENMO PAYMENT 123", -40.0),
        ("2025-01-04", "AMAZON.COM REFUND", 25.0),
        ("2025-01-05", "T-MOBILE AUTOPAY", -85.0),
        ("2025-01-06", "AUTOPAY PAYMENT - THANK YOU", 500.0),
    ]).set_index("description")
    assert t.loc["ACME PAYROLL DIR DEP", "kind"] == "income"
    assert t.loc["ONLINE TRANSFER TO SAVINGS", "kind"] == "transfer"
    assert t.loc["VENMO PAYMENT 123", "kind"] == "expense"          # P2P is real spending, never a silent transfer
    assert t.loc["AMAZON.COM REFUND", "kind"] == "refund"
    assert t.loc["AMAZON.COM REFUND", "flow"] == -25.0              # nets against Shopping
    assert t.loc["T-MOBILE AUTOPAY", "category"] == "Utilities"     # 'autopay' alone is not a transfer
    assert t.loc["AUTOPAY PAYMENT - THANK YOU", "kind"] == "transfer"


def test_user_rules_override_and_rederive():
    t = _tx([("2025-01-01", "SOME LANDLORD LLC", -1500.0), ("2025-01-02", "MOVE TO BROKERAGE", -200.0)])
    rules = pd.DataFrame({"pattern": ["landlord", "/brokerage$/"], "category": ["Housing", "Transfer"]})
    out = categorize.apply_user_rules(t, rules).set_index("description")
    assert out.loc["SOME LANDLORD LLC", "category"] == "Housing"
    assert out.loc["MOVE TO BROKERAGE", "kind"] == "transfer"
    assert out.loc["MOVE TO BROKERAGE", "flow"] == 0.0
