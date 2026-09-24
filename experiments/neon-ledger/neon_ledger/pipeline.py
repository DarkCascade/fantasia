"""One call from raw CSV bytes to everything the UI needs.

Kept separate from app.py so the whole analysis can be run and tested
without Streamlit (see tests/ and `python -m neon_ledger.pipeline FILE...`).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from . import analytics as A
from . import categorize, detectors, ingest


@dataclass
class FileSpec:
    name: str
    data: bytes
    mapping: dict | None = None      # ColumnMap overrides (field -> column or None)
    flip_sign: bool | None = None    # None = auto
    dayfirst: bool | None = None     # None = detect from the data


@dataclass
class Loaded:
    tx: pd.DataFrame
    reports: list[ingest.IngestReport]
    columns: dict[str, list[str]]           # file -> its raw column names
    guessed: dict[str, ingest.ColumnMap]    # file -> auto mapping
    removed_dupes: int = 0
    errors: list[str] = field(default_factory=list)


def load(files: list[FileSpec], *, dedupe: bool = True, recategorize: bool = False) -> Loaded:
    frames, reports, cols, guessed, errors = [], [], {}, {}, []
    for f in files:
        try:
            raw, rep = ingest.read_csv_bytes(f.data, f.name)
            cols[f.name] = list(raw.columns)
            g = ingest.guess_columns(raw)
            guessed[f.name] = g
            cmap = ingest.ColumnMap(**{**g.as_dict(), **(f.mapping or {})})
            frames.append(ingest.normalize(raw, cmap, rep, flip_sign=f.flip_sign, dayfirst=f.dayfirst))
            reports.append(rep)
        except Exception as exc:
            errors.append(f"{f.name}: {exc}")
    if frames:
        tx = pd.concat(frames, ignore_index=True)
    else:
        tx = pd.DataFrame(columns=["date", "description", "amount", "category", "account", "balance", "source"])
    removed = 0
    if dedupe:
        tx, removed = ingest.dedupe(tx)
    tx = categorize.enrich(tx, override_categories=recategorize)
    return Loaded(tx=tx, reports=reports, columns=cols, guessed=guessed, removed_dupes=removed, errors=errors)


@dataclass
class Analysis:
    L: A.Ledger
    ctx: detectors.Context
    findings: list[detectors.Finding]
    threat: tuple[int, str]


def analyze(tx: pd.DataFrame, budgets: pd.DataFrame | None, starting_balance: float | None, low_balance: float) -> Analysis:
    L = A.build_ledger(tx)
    ctx = detectors.build_context(L, budgets, starting_balance, low_balance)
    findings = detectors.run_all(ctx)
    return Analysis(L=L, ctx=ctx, findings=findings, threat=detectors.threat_level(findings))


if __name__ == "__main__":  # quick terminal report
    import sys
    from pathlib import Path

    paths = [Path(p) for p in sys.argv[1:]] or sorted((Path(__file__).parent.parent / "sample_data").glob("*_export.csv"))
    loaded = load([FileSpec(p.name, p.read_bytes()) for p in paths])
    for e in loaded.errors:
        print("ERROR", e)
    bud_path = paths[0].parent / "budgets.csv"
    budgets = ingest.load_budgets(bud_path.read_bytes()) if bud_path.exists() else None
    an = analyze(loaded.tx, budgets, None, 500.0)
    print(f"{len(loaded.tx)} transactions, {an.L.start:%Y-%m-%d} .. {an.L.end:%Y-%m-%d}; threat {an.threat}")
    for f in an.findings:
        print(f"[{f.severity:8}] {f.module:9} {f.title}")
        print(f"           {f.detail}")
    for e in an.ctx.errors:
        print("DETECTOR ERROR", e)
