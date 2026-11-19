# Aurora Barrage art (Meshy text-to-image)

The only pictures in the game: the player ship, three enemy ships, the boss and the scrolling nebula
(`src/aurora-barrage/*.webp`, ~290 KB total). Everything else (lasers, enemy bullets, XP orbs, engine
flame, rings, sparks, star parallax layers, HUD) is drawn in code in `src/aurora-barrage.js`.

A top-down 2D shooter wants sprites, not meshes, so this uses Meshy's **text-to-image** (model
`nano-banana-2`, ~6 credits each, 36 total) rather than image-to-3D. Sprites ask for `remove_background`
(returns a transparent PNG); the background does not.

## Pipeline

1. `python3 -I gen.py [name ...]`: submits the tasks via the REST API (`POST /openapi/v1/text-to-image`,
   `remove_background: true` for ships, `aspect_ratio` 1:1 / 9:16), polls, saves `raw/<name>.png`.
   In the cloud sandbox the proxy authenticates `api.meshy.ai`, so no key is handled; note the `meshy` CLI
   itself sends its own bearer header, which the proxy does not replace, so the CLI failed with "Invalid API key"
   there and the script calls the API directly. Elsewhere add an `Authorization: Bearer ...` header to `curl()`.
2. `python3 -I bake.py` (`pip install pillow numpy`): trims each ship to its alpha bounding box (dropping the
   faint matte haze under the player's engines), resizes to ~2x its in-game width and writes WebP; for the
   background it **erases the lone ringed planet** (it would otherwise appear twice) and then **loops the
   image vertically** by crossfading it with itself shifted half a tile (`sin^2` weight), so the two stacked
   copies in the scene scroll with no visible seam. 576x1024, shown at 540x960.

Ships were prompted nose-up (player) / nose-down (enemies) and came back that way; no flipping needed.
Style suffix shared by every ship: *polished stylized sci-fi arcade game sprite, top-down orthographic view,
symmetrical, crisp clean hard-surface detail, rich saturated colour, glowing emissive parts, isolated on plain
white background, no text, no shadow, no ground.* The per-ship prompts are in `gen.py`.

| Asset | Task id | Baked size | Shown at (px wide) |
|---|---|---|---|
| player (silver / cyan fighter) | `01a1f25d-aea5-73c0-af29-cc630c41db08` | 192 | 92 |
| scout (red dart drone) | `01a1f25e-8304-75e9-abf0-bcac78aa3963` | 160 | 84 |
| gunship (purple, twin cannons) | `01a1f25e-84b4-73da-92c4-7b0b1b77951e` | 224 | 116 |
| bomber (gold / teal armoured cruiser) | `01a1f25e-87bf-71fc-b577-77ad147d3250` | 288 | 140 |
| boss (crimson dreadnought) | `01a1f25e-8958-765d-9df6-360552e44324` | 640 | 330 |
| bg (indigo nebula, 9:16) | `01a1f25e-8af5-71bf-a309-6bc0f50d6e9b` | 576x1024 | 540x960 |

`raw/` (the 1024 px originals) is git-ignored; re-run `gen.py` to regenerate, or fetch by task id while it lasts
(Meshy keeps tasks for a few days).
