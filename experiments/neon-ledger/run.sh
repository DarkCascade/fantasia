#!/usr/bin/env bash
# NEON//LEDGER launcher (macOS / Linux). Creates a private virtualenv on first run.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo ">> first run: building .venv"
  python3 -m venv .venv
fi
if ! .venv/bin/python -c "import streamlit, plotly, pandas" 2>/dev/null; then
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r requirements.txt
fi
# config.toml already pins 127.0.0.1 + telemetry off; repeated here so the
# guarantee holds even if someone edits the config file.
exec .venv/bin/python -m streamlit run app.py \
  --server.address 127.0.0.1 \
  --browser.gatherUsageStats false \
  "$@"
