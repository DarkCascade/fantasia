#!/usr/bin/env bash
# Rebuild every deliverable from source, then verify the package.
#   ./build.sh            prompts, rules.md, all PDFs, CHANGELOG.md, then verify.py
#   ./build.sh --no-sim   same, but skip verify.py's simulation re-runs
# The balance sweeps themselves are separate (about an hour per version): sim/run_sweeps.sh
set -euo pipefail
cd "$(dirname "$0")"
python3 minis/minis.py
cd print
for f in rules_md designers_notes rulebook card_reference board player_aids components miniatures_guide; do
  python3 "$f.py"
done
cd ..
python3 verify.py "$@"
