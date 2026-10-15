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
