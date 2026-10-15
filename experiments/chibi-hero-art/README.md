# Chibi Crawl hero art (Meshy, rigged)

The Knight, Mage and Cleric are Meshy-generated, auto-rigged characters (`src/chibi-crawl/heroes/*.glb`,
~500 KB each, 10.3k tris, one 512px base-colour JPEG). The weapons (sword, shield, staffs) stay
primitives so the attack / glow animation code is unchanged. Loaded by `loadHeroArt()` in
`src/chibi-crawl.js`; any failure, or `?heroes=0`, falls back to the primitive heroes.

## Pipeline (CLI v0.4.3, ~50 credits for all three)

1. **Concept** (`meshy text-to-image create --ai-model nano-banana-2 --pose-mode t-pose
   --remove-background true`, 6 credits each). Shared suffix: *cute chibi hand-painted storybook game
   character, big head, small body, soft rounded shapes, soft dark outline, warm pastel colors, full body,
   front view, centered, standing straight with arms stretched straight out sideways in a T-pose, empty
   open hands, no weapon, no shield, no staff, no bag, no cape, plain white background, no ground, no
   shadow, no text.* (`ref/hero-concepts.jpg` is the three results.)
2. **3D**: `meshy image-to-3d create --image-url <concept>.png --model-type smart-topology --ai-model
   meshy-t2.5 --target-polycount 10000 --should-texture true --texture-resolution 2k --pose-mode t-pose`.
3. **Rig**: `meshy rigging create --input-task-id <3d task> --height-meters 1.2` (also yields walking /
   running clips; the game does not use them). Download `result.rigged_character_glb_url`.
4. **Bake**: `python3 -I bake_hero.py <char.glb> ../../src/chibi-crawl/heroes/<kind>.glb 512`
   (`pip install pygltflib pillow numpy`): keeps the 24-bone skeleton and mesh, drops the normal and
   metal/rough maps, tangents and animations, repacks weights as normalised uint16.

| Hero | Concept | 3D | Rig | Prompt (before the suffix) |
|---|---|---|---|---|
| knight | `01a14127-bc06-71ae-8f91-c31334275af8` | `01a14128-4a28-7004-b3d8-f28884d247bf` | `01a1412b-36cf-70d7-9787-507ecc389fd0` | A tiny chibi knight guard in shiny silver plate armor and a silver visored helmet with a red plume, blue tabard with a gold lion, gold belt, brown boots, friendly face. |
| mage | `01a14127-c208-75bb-b463-9247e925dbc7` | `01a14128-5110-74d7-a375-72eac749068e` | `01a1412b-475c-712d-bcd0-732daefcd1c7` | A tiny chibi wizard in a purple robe with gold trim and a tall purple pointed hat with a gold band and a little star, long lavender hair, gold belt, dark purple boots, friendly face. |
| cleric | `01a14127-c7f8-73a0-bf7e-d2950d59c76a` | `01a14128-591d-7151-a511-e70b198de336` | `01a1412b-588f-7643-a3fa-14416033f5c1` | A tiny chibi cleric girl in a long cream-white robe with a mint green belt and gold hem, blonde hair in two round pigtail buns, a small golden halo floating above her head, tan boots, kind smiling face. |

## How the game animates them (`buildMeshyHero`)

The rig is posed with the same pose vector as the primitive heroes, no clips: `applyPose` rotates
virtual limb groups, then `R.sync()` converts each rotation to a bone rotation. Meshy's bone axes are
arbitrary, so each delta is expressed in the character's frame and conjugated by the parent's rest
orientation (`q = Pw⁻¹ · D · Pw · q0`); the rest pose is a T, so the arms get a fixed hang rotation
(`HERO_ARM_HANG`) on top. The game's `armR`/`legR` (the +x side) are the model's Left bones. Weapons hang
off pivots that follow the hand bones. Toon shading is a `MeshToonMaterial` on the baked texture, the
outline an inverted-hull second `SkinnedMesh` on the same skeleton (a one-line `onBeforeCompile` pushes
vertices along their skinned normals). The geometry is shared by every clone (`SkeletonUtils.clone`), so
`Unit.dispose` only frees the per-unit materials and the skeleton's bone texture.

## Foes: the slimes (static, unrigged) and what they taught us

`src/chibi-crawl/foes/slime.glb` (187 KB, 5k tris, 512px) is the ONE model behind all five slimes:
Slime, Petal, Pumpkin, Ice and the King. Loaded by `loadFoeArt()` (`?foeart=0` falls back to the primitives).
It has no skeleton: the pose vector's squash, hop, lean and KO tip-over are transforms on `body` already,
so a static mesh animates for free. The texture is *neutral* (near-white shading, painted face), so
`addMeshySlimeBody` multiplies the slime's colour in as its real hue (`SLIME_COLORS` for plain slimes, fixed
pastels for the biome kinds); the biome accessories (daisy, pumpkin stem, ice crystals, crown) are the old
primitives, nudged down because the Meshy dome sits lower than the primitive sphere. Pumpkin is the same
mesh squashed, and its flat side-rib plates were dropped. Ice is lightened, not transparent (real
transparency let the ground muddy it).

**Do not use the humanoid recipe for a blob.** Findings, in the order we hit them:
1. *Single-image smart topology gives a flat sticker.* The 2.5k-tri mesh was 0.83 wide and 0.37 deep: fine
   head-on, a slice of bread from the game's 3/4 camera. Stretching z does not fix it.
2. *Use a multi-view concept + `multi-image-to-3d`.* `meshy text-to-image ... --generate-multi-view true`
   returns three views (left, front, back; `--remove-background` works) and `meshy multi-image-to-3d create
   --input-task-id <task> --should-texture true --texture-resolution 2k` gives a properly round 1.9 x 1.9 x 1.9
   mesh (standard model, 72k tris, ~25 credits; no smart-topology / polycount option).
3. *Ask for NO outline in the concept.* With "soft dark outline" in the prompt, every view's silhouette
   outline is projected onto the model and shows up as dark smears down its sides. The game draws its own
   outline hull, so the concept should be shaded colour only.
4. *Meshy's standard export is unwelded triangle soup with a mosaic texture atlas.* That breaks every
   shortcut: a plain Blender decimate smears the face, trimesh/fast-simplification drop UVs, and any UV tool
   that works on topology (smart project, pack islands) shatters it into thousands of one-triangle islands.
   `decimate_blender.py` therefore **welds first** (`remove_doubles`), decimates a copy, smart-UV-unwraps it
   (a handful of big islands once welded), and Cycles-bakes the original's diffuse colour onto it
   (selected-to-active, colour only, cage 0.08, 1024px). Sphere projection looked ideal but puts the face on
   its seam and ignores attempts to spin the seam away.
5. `bake_static.py ... 512 --neutral` repacks it (pygltflib; stands the model on y=0) and divides the texture by
   its median colour *over the used atlas area* (the unused space is black, which first made the median 0 and
   blew the face out), so tints land on their true hue instead of going grey (cream x blue = grey).
6. A painted face survives all this only roughly, and a Meshy slime cannot blink (no `R.eyes`).

Task ids (final): concept `01a14150-b468-723f-bc61-f0886ee2bdcc` (multi-view), 3D
`01a14151-26de-75c7-b581-32622426224d`. Prompt: *A cute chibi jelly slime monster with a milky pale
cream-white soft jelly body shaped like a rounded water droplet with a tiny curl on top, two big glossy dark
eyes, a tiny smile, soft pink blush cheeks, one small glossy highlight, no arms, no legs. cute chibi
hand-painted storybook game character, soft rounded shapes, soft painted shading, NO outline, no black edge
lines, no dark borders, warm pastel colors, full body, plain white background, no ground, no shadow, no text.*
Pipeline: `blender --background --python decimate_blender.py -- model.glb out.glb 5000 1024`, then
`python3 -I bake_static.py out.glb ../../src/chibi-crawl/foes/slime.glb 512 --neutral`.
