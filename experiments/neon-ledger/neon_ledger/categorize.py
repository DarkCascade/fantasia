"""Merchant clean-up, rule-based categories, and transfer/income/refund tagging.

Adds these columns to the canonical frame from ingest.normalize():

    merchant   str   description with store numbers, dates, processor
                     prefixes ("SQ *", "TST*", "POS DEBIT") stripped
    category   str   the file's category if it had one, else a rule match
    kind       str   income | expense | refund | transfer
    flow       float money that counts toward spending (positive = spent);
                     refunds are negative here so they net against the
                     category they came back to. 0 for income & transfers.
    inflow     float money that counts as income (0 otherwise)
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

# (category, pattern). First match wins, so order matters: specific before
# generic ("UBER EATS" is dining before "UBER" is transport).
RULES: list[tuple[str, str]] = [
    ("Transfer", r"\b(online (banking )?transfer|transfer (to|from)|xfer|trnsfr|internal transfer|payment\s*-?\s*thank you|autopay payment|credit card (payment|pymt|pmt)|card (payment|pmt)|crd pmt|e-?payment|cardmember serv|sweep)\b"),
    ("Fees & Interest", r"\b(overdraft|od fee|nsf|insufficient funds|late (fee|charge)|interest charge|finance charge|service (fee|charge)|monthly (maintenance )?fee|atm fee|foreign (transaction|txn) fee|returned item|annual fee|minimum balance fee)\b"),
    ("Income", r"\b(payroll|direct dep(osit)?|dir dep|salary|paycheck|adp|gusto|paychex|employer|wages|bonus|dividend|interest paid|interest earned|tax refund|irs treas|ssa treas|reimbursement)\b"),
    ("Housing", r"\b(rent(?!-a)|mortgage|hoa|property (mgmt|management)|apartments?|landlord|leasing|realty)\b"),
    ("Utilities", r"\b(electric|energy|power (co|company)|water (dept|utility)|sewer|pg&e|con ?ed|duke energy|comcast|xfinity|spectrum|verizon|at&t|t-mobile|tmobile|internet|utility|utilities|gas (co|company)|waste management)\b"),
    ("Insurance", r"\b(insurance|geico|state farm|allstate|progressive|lemonade|liberty mutual|usaa ins|metlife|aflac)\b"),
    ("Dining", r"\b(uber ?eats|noodle|taberna|trattoria|cantina|bar|doordash|grubhub|postmates|seamless|restaurant|cafe|caf[eé]|coffee|starbucks|dunkin|peet'?s|mcdonald'?s|chipotle|pizza|grill|taqueria|taco|burger|sushi|ramen|diner|bistro|kitchen|eatery|bakery|brewing|brewery|tavern|pub|chick-fil-a|panera|subway|wendy'?s|kfc|domino'?s|shake shack|sweetgreen|bar and grill|deli)\b"),
    ("Groceries", r"\b(grocery|groceries|supermarket|safeway|kroger|trader joe'?s|whole foods|aldi|costco|publix|wegmans|h-?e-?b|sprouts|food lion|giant eagle|stop & shop|albertsons|ralphs|vons|meijer|instacart|market basket|fresh market)\b"),
    ("Transport", r"\b(uber|lyft|shell|chevron|exxon|mobil|texaco|sunoco|valero|marathon petro|gas station|fuel|parking|toll|e-?zpass|fastrak|transit|metro|mta|bart|amtrak|citibike|lime|bird rides)\b"),
    ("Auto", r"\b(auto ?zone|jiffy lube|car wash|dmv|mechanic|auto (repair|parts|service)|tire|midas|pep boys|o'?reilly|car payment|toyota financial|honda financial|ally auto)\b"),
    ("Subscriptions", r"\b(amazon prime|prime video|netflix|spotify|hulu|disney ?(\+|plus)|hbo|max\.com|youtube (premium|tv)|apple\.com/bill|icloud|patreon|audible|adobe|dropbox|microsoft 365|office 365|xbox|playstation|nintendo|chatgpt|openai|github|nytimes|new york times|substack|paramount|peacock|crunchyroll|duolingo|headspace|calm\.com|siriusxm|kindle unltd|google (one|storage)|onlyfans|twitch)\b"),
    ("Health & Fitness", r"\b(pharmacy|cvs|walgreens|rite aid|doctor|dental|dentist|clinic|hospital|medical|optometr|vision|urgent care|labcorp|quest diag|therapy|gym|fitness|planet fitness|equinox|peloton|crossfit|yoga|orangetheory)\b"),
    ("Travel", r"\b(airline|airlines|airways|delta air|united air|american air|southwest|jetblue|alaska air|spirit air|frontier air|hotel|marriott|hilton|hyatt|airbnb|vrbo|expedia|booking\.com|hotels\.com|kayak|priceline|hertz|avis|enterprise rent)\b"),
    ("Entertainment", r"\b(movie|cinema|amc|regal|theat(er|re)|ticketmaster|stubhub|eventbrite|steam(games)?|concert|bowling|museum|golf|arcade|epic games|bandcamp|fandango)\b"),
    ("Personal Care", r"\b(salon|barber|spa|sephora|ulta|nail|massage|cosmetic)\b"),
    ("Pets", r"\b(petco|petsmart|chewy|vet(erinary)?|animal hospital|pet supplies)\b"),
    ("Education", r"\b(tuition|udemy|coursera|masterclass|school|university|college|textbook|bookstore|student loan|navient|nelnet|sallie mae)\b"),
    ("Kids", r"\b(daycare|child ?care|babysit|toys ?r ?us|carter'?s|kindercare)\b"),
    ("Gifts & Charity", r"\b(donation|donate|charity|red cross|gofundme|unicef|salvation army|church|tithe|1-800-flowers|edible arrangements)\b"),
    ("Taxes", r"\b(irs|tax payment|franchise tax|dept of revenue|property tax|state tax)\b"),
    ("Cash & ATM", r"\b(atm|cash withdrawal|withdrawal at|cash advance)\b"),
    ("P2P Transfers", r"\b(venmo|zelle|paypal|cash ?app|square cash|apple cash)\b"),
    ("Shopping", r"\b(amazon|amzn|target|best ?buy|ebay|etsy|walmart|wal-mart|ikea|home ?depot|lowe'?s|macy'?s|nordstrom|old navy|gap|zara|h&m|shein|temu|wayfair|kohl'?s|tj ?maxx|marshalls|ross stores|apple store|dollar (tree|general)|michaels|joann|bed bath)\b"),
]
_COMPILED = [(cat, re.compile(p, re.I)) for cat, p in RULES]

# Categories whose money-in is real income; everything else money-in that
# isn't a transfer is a refund against the category it's filed under.
INCOME_CATEGORIES = {"income", "paycheck", "salary", "wages", "interest", "dividends", "bonus", "reimbursement", "tax refund", "other income", "deposit", "deposits"}
TRANSFER_CATEGORIES = {"transfer", "transfers", "credit card payment", "payment", "payments", "internal transfer", "savings transfer"}

# Spending you choose vs spending that chooses you - used by lifestyle-creep
# and weekend-drift detection. Anything not listed is treated as neutral.
DISCRETIONARY = {"Dining", "Shopping", "Entertainment", "Travel", "Personal Care", "Subscriptions", "Gifts & Charity", "P2P Transfers", "Cash & ATM"}
ESSENTIAL = {"Housing", "Utilities", "Groceries", "Insurance", "Health & Fitness", "Transport", "Auto", "Education", "Kids", "Taxes", "Pets"}

_PREFIX = re.compile(
    r"^(pos( debit| purchase)?|debit( card)?( purchase)?|purchase( authorized on \d\d/\d\d)?|checkcard \d*|recurring (payment|debit)|"
    r"ach (debit|credit)|card \d{4}|visa|mc|sq ?\*|tst ?\*|sp ?\*|pp ?\*|paypal ?\*|py ?\*|dd ?\*|in ?\*|bt ?\*|ic ?\*)\s*",
    re.I,
)
_ALIASES = [
    (re.compile(r"\b(amzn|amazon)\b.*prime|prime video", re.I), "Amazon Prime"),
    (re.compile(r"\b(amzn|amazon)", re.I), "Amazon"),
    (re.compile(r"apple\.com/bill|itunes", re.I), "Apple Services"),
    (re.compile(r"wal-?mart|wm supercenter", re.I), "Walmart"),
    (re.compile(r"uber\s*eats", re.I), "Uber Eats"),
    (re.compile(r"\buber\b", re.I), "Uber"),
    (re.compile(r"\blyft\b", re.I), "Lyft"),
    (re.compile(r"starbucks", re.I), "Starbucks"),
    (re.compile(r"doordash", re.I), "DoorDash"),
    (re.compile(r"netflix", re.I), "Netflix"),
    (re.compile(r"spotify", re.I), "Spotify"),
    (re.compile(r"venmo", re.I), "Venmo"),
    (re.compile(r"t-?mobile", re.I), "T-Mobile"),
    (re.compile(r"\bat&t\b", re.I), "AT&T"),
    (re.compile(r"verizon", re.I), "Verizon"),
    (re.compile(r"interest charge|finance charge|purchase interest", re.I), "Card Interest"),
    (re.compile(r"overdraft|\bnsf\b", re.I), "Overdraft Fee"),
    (re.compile(r"zelle", re.I), "Zelle"),
    (re.compile(r"cash ?app|square cash", re.I), "Cash App"),
    (re.compile(r"trader joe", re.I), "Trader Joe's"),
    (re.compile(r"whole ?foods|wfm", re.I), "Whole Foods"),
    (re.compile(r"costco", re.I), "Costco"),
    (re.compile(r"\btarget\b", re.I), "Target"),
]


_P2P_PAYEE = re.compile(r"^(zelle|venmo|paypal|cash ?app)( (payment|transfer|pmt))? (to|from) (.+)$", re.I)


def clean_merchant(desc: str) -> str:
    s = str(desc).strip()
    if not s:
        return "(blank)"
    p2p = _P2P_PAYEE.match(s)
    if p2p:  # "ZELLE PAYMENT TO OAKRIDGE APARTMENTS" -> the payee, not "Zelle"
        s = p2p.group(5)
    for rx, name in _ALIASES:
        if rx.search(s):
            return name
    s = _PREFIX.sub("", s)
    s = _PREFIX.sub("", s)  # "POS DEBIT SQ *FOO" has two prefixes
    s = re.sub(r"\b\d{1,2}/\d{1,2}(/\d{2,4})?\b", " ", s)       # dates
    s = re.sub(r"#\s*\w+", " ", s)                                # store #1234
    s = re.sub(r"\b[x*]{2,}\d*\b", " ", s, flags=re.I)            # masked card xxxx1234
    s = re.sub(r"\b\w*\d{3,}\w*\b", " ", s)                       # ref numbers / tokens with digits
    s = re.sub(r"\b(www\.|https?://)", "", s, flags=re.I)
    s = re.sub(r"\.com\b", "", s, flags=re.I)
    s = re.sub(r"[^A-Za-z&' ]+", " ", s)
    s = re.sub(r"\b([A-Z]{2})$", "", s.strip())                   # trailing state code
    words = [w for w in s.split() if len(w) > 1 or w == "&"]
    if not words:
        return str(desc).strip()[:24].title()
    return " ".join(words[:3]).title()


def rule_category(desc: str) -> str:
    for cat, rx in _COMPILED:
        if rx.search(desc):
            return cat
    return ""


def enrich(df: pd.DataFrame, *, override_categories: bool = False) -> pd.DataFrame:
    """Add merchant / category / kind / flow / inflow columns."""
    if df.empty:
        out = df.copy()
        for c, v in (("merchant", ""), ("kind", ""), ("flow", 0.0), ("inflow", 0.0)):
            out[c] = v
        return out
    out = df.copy()
    desc = out["description"].astype(str)
    out["merchant"] = desc.map(clean_merchant)
    ruled = desc.map(rule_category)

    file_cat = out["category"].astype(str).str.strip()
    use_rules = override_categories | file_cat.eq("") | file_cat.str.lower().isin({"nan", "none", "uncategorized", "uncategorised", "misc", "other", "general"})
    cat = file_cat.where(~use_rules, ruled)
    # Rules found nothing and the file had a real category - keep the file's.
    cat = cat.where(cat.ne(""), file_cat.where(~file_cat.str.lower().isin({"", "nan", "none"}), "Uncategorized"))
    cat = cat.where(cat.ne(""), "Uncategorized")
    out["category"] = cat

    out["_rule"] = ruled
    return _derive(out)


def _derive(out: pd.DataFrame) -> pd.DataFrame:
    """kind / flow / inflow from category + sign. Re-run after any recategorisation."""
    cat = out["category"].astype(str)
    ruled = out["_rule"] if "_rule" in out.columns else pd.Series("", index=out.index)
    lower_cat = cat.str.lower()
    is_transfer = ruled.eq("Transfer") | lower_cat.isin(TRANSFER_CATEGORIES) | lower_cat.str.contains(r"\btransfer\b", regex=True)
    # P2P apps are how real money leaves - never silently drop them as transfers.
    is_transfer &= ~lower_cat.eq("p2p transfers")
    # A category the user set explicitly beats the transfer rule.
    if "_user" in out.columns:
        is_transfer = np.where(out["_user"], lower_cat.isin(TRANSFER_CATEGORIES) | lower_cat.eq("transfer"), is_transfer)
    amt = out["amount"]
    looks_income = lower_cat.isin(INCOME_CATEGORIES) | ruled.eq("Income") | lower_cat.str.contains("income|payroll|salary", regex=True)

    kind = np.where(is_transfer, "transfer",
           np.where(amt < 0, "expense",
           np.where(looks_income | lower_cat.eq("uncategorized") | lower_cat.eq("p2p transfers"), "income", "refund")))
    out["kind"] = kind
    # A positive row with no category and no refund signal is income-ish; make it say so.
    out.loc[(out["kind"] == "income") & (out["category"] == "Uncategorized"), "category"] = "Income"

    out["flow"] = np.where(out["kind"].isin(["expense", "refund"]), -amt, 0.0)
    out["inflow"] = np.where(out["kind"].eq("income"), amt, 0.0)
    out["is_discretionary"] = out["category"].isin(DISCRETIONARY)
    return out


def apply_user_rules(tx: pd.DataFrame, rules: pd.DataFrame | None) -> pd.DataFrame:
    """User overrides: rows whose description or merchant contains `pattern`
    (case-insensitive; a pattern wrapped in /slashes/ is a regex) get `category`.
    Later rules win. Kinds are re-derived so 'Transfer' / 'Income' behave."""
    if rules is None or rules.empty or tx.empty:
        return tx
    out = tx.copy()
    out["_user"] = False
    text = out["description"].astype(str) + " | " + out["merchant"].astype(str)
    for pat, cat in zip(rules["pattern"].astype(str), rules["category"].astype(str)):
        pat, cat = pat.strip(), cat.strip()
        if not pat or not cat:
            continue
        if len(pat) > 2 and pat.startswith("/") and pat.endswith("/"):
            try:
                hit = text.str.contains(pat[1:-1], case=False, regex=True)
            except re.error:
                continue
        else:
            hit = text.str.contains(pat, case=False, regex=False)
        out.loc[hit, "category"] = cat
        out.loc[hit, "_user"] = True
    return _derive(out).drop(columns="_user")
