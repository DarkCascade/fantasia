# Chibi Crawl level art (Meshy)

Scenery props for `src/chibi-crawl.js`, generated with Meshy text-to-3D
(`meshy-6-lite`, preview then texture refine, ~15 credits each) and baked
into `src/chibi-crawl/props.json` (~230 KB, loaded at boot; if it fails to
load the game falls back to its old primitive props).

Pipeline: `generate.py <name> "<prompt>"` (needs the Meshy API reachable and
`assets.meshy.ai` allowed) -> `bake.py <dir of glbs> src/chibi-crawl/props.json`
(see its docstring for deps). The bake welds vertices (Meshy output is
unwelded triangle soup; decimating it unwelded tears holes), strips the ground
slab Meshy adds under flowers/rock/fence/grass, decimates to a few hundred to
~1k tris, bakes the texture to vertex colour and marks tintable vertices
(foliage / petals / mushroom cap) so the game can recolour them per biome.
`props-viewer.html` (serve the repo root, open it under `/experiments/chibi-level-art/`)
lines the props up; `?tint=autumn|frost|blossom`, `?side=double`.

**Grass clumps (`grass_a/b/c`)** use a different route: a concept image
(`meshy text-to-image`, `nano-banana-2-lite`, `--remove-background true`, same
style suffix as the prompts below) fed to `meshy image-to-3d --model-type
smart-topology --ai-model meshy-t2.5 --target-polycount 3000 --should-texture
true --texture-resolution 2k` (CLI v0.4.3; 18 credits each). Smart topology
delivered ~2.9k tris (vs ~1.2M for the standard model) with no ground slab, so
the bake only has to take it the rest of the way down to 110-243 tris, since
the game scatters up to ~390 of them per chunk. Note smart topology can't be textured
through text-to-3d refine (t2/t2.5 aren't accepted there), hence the image route.
Re-bake just those with `python3 -I bake.py <dir> src/chibi-crawl/props.json grass_a grass_b grass_c`
(named props merge into the existing JSON; the other props' GLBs aren't kept).
The game merges each chunk's clumps into one mesh (`Scenery.buildGrass`).

Not Meshy: the ground texture (needs to tile seamlessly), road, arena decals
(kept as primitives). The pond is a procedural bowl with a water shader (see `makeWaterMat` in `src/chibi-crawl.js`).

| Prop | Meshy task id (refine) | Prompt |
|---|---|---|
| tree | `01a13a81-6813-7660-a623-c2f0cca25759` | a round fluffy leafy tree with a short thick brown trunk and a big bright green puffy canopy, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane |
| pine | `01a13a81-4e17-77d0-a8c4-89b1e412ac04` | a layered pine tree with three stacked rounded green conifer tiers and a short brown trunk, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane |
| bush | `01a13a81-4f56-738e-87e1-74e51d2cb29d` | a small round leafy green bush with a few tiny berries, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane |
| flowers | `01a13a81-5081-71d3-ad8d-2b5ae9033aae` | a small patch of cute daisy-like flowers with pink white and yellow blossoms on green stems and a few leaves, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane |
| rock | `01a13a81-66e5-74e5-b51b-96de35676415` | a smooth rounded grey-lavender boulder with a smaller rock beside it, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane |
| mushroom | `01a13a81-6a94-76cb-8495-d3c4edf35dcd` | a cute red toadstool mushroom with white spots and a cream stem, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane |
| fence | `01a13a81-36bd-74d4-bb5f-e87813a404d6` | a short rustic wooden picket fence section with two posts and two horizontal rails, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane |
| pond | `01a13a81-4e41-7137-a9db-b2f57f43b0fa` | a small round pond of blue water with a sandy rim, a green lily pad and a white lotus flower, very flat low profile, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane — **unused (flat disc; vertex colour can't hold it)** |
| grass | `01a13a7e-334d-72af-a764-dd337fa37225` | a small cute stylized grass tuft clump with a few blades, hand-painted cartoon game asset, single prop, no ground plane |
| grass_a | `01a13c3a-454f-741e-99a1-0e72a926135d` (image-to-3d) | a small round tuft of short stubby bright green grass blades, dense compact clump — concept image `01a13c39-b386-70a8-8f63-932e1b3fda1e` |
| grass_b | `01a13c3a-4a62-760f-a2d9-16df991a52f7` (image-to-3d) | a tall wispy clump of long thin arching green grass blades fanning outward, a few blades curling — concept image `01a13c39-b6bf-7000-933e-aa79653807a4` |
| grass_c | `01a13c3a-50aa-7179-aa5f-cb4d7c3844eb` (image-to-3d) | a fat lush clump of broad leafy green grass blades in varied lengths with a couple of tiny white clover flowers — concept image `01a13c39-b9f8-701f-b2a9-312f71cf536f` |
| grass2 | `01a13a81-84b2-72ac-8039-ee96058f7790` | a tall wispy tuft of long green grass blades with a couple of tiny wildflowers, cute chibi stylized hand-painted cartoon game asset, soft pastel colors, rounded shapes, single prop, no ground plane — **unused (olive, wispy)** |
