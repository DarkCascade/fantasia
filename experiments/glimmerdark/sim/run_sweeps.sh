#!/usr/bin/env bash
# Full balance sweeps: 10,000 games per configuration for each ruleset version.
set -e
cd "$(dirname "$0")"
for v in "$@"; do
  python3 -m glimmer.run all --version "$v" --games 10000
done
