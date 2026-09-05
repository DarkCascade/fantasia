#!/usr/bin/env bash
# Meshy text-to-3d fetch: create task -> poll -> download result.
# Usage: ./generate.sh "a low-poly wooden crate" out/crate
#
# Requires MESHY_API_KEY in the environment. Never hardcode the key here.
set -euo pipefail

PROMPT="${1:?usage: generate.sh <prompt> <output-basename>}"
OUT_BASE="${2:?usage: generate.sh <prompt> <output-basename>}"
API="https://api.meshy.ai/openapi/v2/text-to-3d"

if [[ -z "${MESHY_API_KEY:-}" ]]; then
  echo "MESHY_API_KEY is not set" >&2
  exit 1
fi

echo "Creating preview task for: $PROMPT"
TASK_ID=$(curl -sS -X POST "$API" \
  -H "Authorization: Bearer $MESHY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"mode\":\"preview\",\"prompt\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$PROMPT"),\"art_style\":\"realistic\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"])')

echo "Task ID: $TASK_ID"

STATUS=""
while [[ "$STATUS" != "SUCCEEDED" ]]; do
  sleep 5
  RESP=$(curl -sS "$API/$TASK_ID" -H "Authorization: Bearer $MESHY_API_KEY")
  STATUS=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  echo "Status: $STATUS"
  if [[ "$STATUS" == "FAILED" ]]; then
    echo "$RESP" >&2
    exit 1
  fi
done

GLB_URL=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["model_urls"]["glb"])')
mkdir -p "$(dirname "$OUT_BASE")"
curl -sS -o "${OUT_BASE}.glb" "$GLB_URL"
echo "Saved ${OUT_BASE}.glb"
