#!/usr/bin/env bash
# Full balance sweeps: 10,000 games per configuration for each ruleset version,
# plus the 10,000-games-per-player-count playtime run used by the length charts.
set -e
cd "$(dirname "$0")"
for v in "$@"; do
  python3 -m glimmer.run all --version "$v" --games 10000
  python3 -m glimmer.run lengths --version "$v" --games 10000
  python3 -m glimmer.run abilities --version "$v" --games 10000
done
