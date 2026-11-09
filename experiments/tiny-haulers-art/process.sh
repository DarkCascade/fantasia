#!/bin/sh
# Step 3: shrink Meshy GLBs for the web.
# Usage: GT=/path/to/gltf-transform sh process.sh RAW_DIR OUT_DIR
# (gltf-transform: `npm install @gltf-transform/cli@4 sharp` somewhere outside the repo)
# 512px WebP base colour (256px for trees, which are instanced by the hundred),
# quantized vertex attributes (KHR_mesh_quantization, which GLTFLoader reads natively).
set -e
RAW="$1"; OUT="$2"; GT="${GT:-gltf-transform}"
mkdir -p "$OUT"
for f in "$RAW"/*.glb; do
  n=$(basename "$f" .glb)
  size=512
  case "$n" in maple|palm) size=256 ;; esac
  "$GT" resize "$f" /tmp/th_$n.a.glb --width $size --height $size >/dev/null
  "$GT" webp /tmp/th_$n.a.glb /tmp/th_$n.b.glb --quality 86 >/dev/null
  "$GT" quantize /tmp/th_$n.b.glb "$OUT/$n.glb" >/dev/null
  rm -f /tmp/th_$n.a.glb /tmp/th_$n.b.glb
  echo "$n $(wc -c < "$OUT/$n.glb") bytes"
done
