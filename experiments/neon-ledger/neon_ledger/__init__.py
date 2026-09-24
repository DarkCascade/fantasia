"""NEON//LEDGER - a local-only personal cash-flow analysis console.

Everything in this package runs in-process on your own machine. Nothing here
opens a network connection: CSVs are parsed from bytes you hand it, results
live in memory, and the only thing ever written to disk is a budget file you
explicitly ask it to save.
"""

__version__ = "1.0.0"
