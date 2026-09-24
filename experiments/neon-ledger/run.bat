@echo off
REM NEON//LEDGER launcher (Windows). Creates a private virtualenv on first run.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo ^>^> first run: building .venv
  py -3 -m venv .venv || python -m venv .venv
)
.venv\Scripts\python -c "import streamlit, plotly, pandas" 2>nul || (
  .venv\Scripts\python -m pip install --upgrade pip
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python -m streamlit run app.py --server.address 127.0.0.1 --browser.gatherUsageStats false %*
