# Tiny Haulers art (Meshy)

The 24 models in `src/tiny-haulers/models/` (vehicles, every building, the two
tree species and the lighthouse) are Meshy generations, shrunk for the web.
`src/tiny-haulers.js` loads them on boot (`loadArt`, each file optional) and
falls back to its primitive builders for anything missing; `?art=0` forces the
primitives. ~2.8 MB in all, 40-155 KB per model.

## Pipeline

Text-to-3D (`meshy-6`) was tried first and dropped: it kept adding a ground
disc and trees around buildings even when told not to, and the truck came out
realistic rather than toy-like. The shipped route gives far more control over
the look because the concept image *is* the look:

1. **Concept image** — `python3 -I concepts.py models.json OUT/concepts`
   (Meshy text-to-image, `nano-banana-2`, 6 credits each). One shared style
   template (in `concepts.py`): *clean 3D game asset render, cute chibi toy-like
   style, chunky rounded proportions, soft hand-painted pastel colors, three-
   quarter front view, isolated on a plain white background, no ground/base/
   shadow/text*. That template is what keeps 24 separate generations reading
   as one set.
2. **Image to 3D** — `python3 -I to3d.py models.json OUT/concepts OUT/glb`
   (`image-to-3d`, `smart-topology`, `--target-polycount` per model,
   textured, 2K base colour, no PBR, 15 credits each). Smart topology returns
   clean low-poly meshes at the requested count, so no decimation step.
3. **Shrink** — `GT=…/gltf-transform sh process.sh OUT/glb ../../src/tiny-haulers/models`
   (512px WebP base colour, 256px for trees, quantized attributes).
   `npm install @gltf-transform/cli@4 sharp` outside the repo first.

Both Python steps drive the pinned Meshy CLI (`meshy-cli@0.4.0`) and need
`NODE_USE_ENV_PROXY=1` in this sandbox (set in the scripts) plus `api.meshy.ai`
and `assets.meshy.ai` reachable. Meshy caps pending tasks per account (~10), so
`to3d.py` runs at most 8 at once; `concepts.py` doesn't, so pass it ≤10 names.

`viewer.html` (serve the repo root, open `/experiments/tiny-haulers-art/viewer.html`)
lines the models up with a red +z arrow: a building's door and a vehicle's
nose must face it after the game's `rot`. `marquee.html` renders the tinted
truck for `src/tiny-haulers/marquee.webp` (the Fantasia Featured image and the
title-screen logo; screenshot with a transparent background).

## How the game uses them

- **Facing.** Buildings come out facing +z. Vehicles lie along x: the truck,
  car0 and car1 have their nose on -x, car2 on +x — hence `rot` in `ART_SPEC`.
- **Size.** Buildings are scaled into a footprint box (`fit`), vehicles to a
  length (`len`); both are re-centred on the footprint with the base at y=0.
- **Tint.** Vehicle concepts were deliberately generated with **white bodies**:
  `tintMaterial` recolours only near-white, unsaturated texels, so every truck
  and car keeps its own colour while windows, wheels and lights stay painted.
- **Look.** Meshy's material is swapped for the game's 4-step toon ramp (same
  texture), so models shade like the primitive roads and props around them.
- **Trees** are two `InstancedMesh`es (~190 trees) with per-instance colour
  variation; everything else is one mesh per building.

## Credits

564 credits in all: 504 for the 24 shipped models (6 + 15 each) and 60 for the
three abandoned text-to-3D previews.

| Model | Concept (text-to-image) | Model (image-to-3d) | Tris | Subject |
|---|---|---|---|---|
| truck | `01a1be5b-0c0f-7034-8b04-637f9699c2ac` | `01a1be5d-4101-710e-8e9e-a97c3d10eacc` | 3000 | a tiny chibi delivery box truck with a short rounded white cab, a light blue windshield, a big boxy white cargo box on the back, round yellow headlights and four chunky black wheels |
| car0 | `01a1be5c-8938-701f-8448-778130a82ee7` | `01a1be5d-4201-743d-af27-9193c7538a29` | 2000 | a tiny chibi rounded hatchback car with a white body, light blue windows, round headlights and four chunky black wheels |
| car1 | `01a1be5b-b443-709f-bb90-4d54225134c4` | `01a1be5d-4150-7594-8467-3ffbb9492359` | 2000 | a tiny chibi retro camper van with a white body, light blue windows, round headlights and four chunky black wheels |
| car2 | `01a1be5b-b512-70d1-bbf6-53d82fbf5989` | `01a1be5d-41ce-75e3-b272-29e88c722f4a` | 2000 | a tiny chibi round bubble car with a white egg-shaped body, a light blue glass top and four small black wheels |
| cottage_a | `01a1be5c-88f6-75b7-8a03-220c602c9194` | `01a1be5d-40ee-71d6-9656-10f4721873d5` | 3000 | a tiny cozy cottage with red brick walls, a steep orange tiled gable roof, a chimney, a round wooden front door and two windows with flower boxes |
| cottage_b | `01a1be5b-b465-73dc-82e9-f09a243407ef` | `01a1be5d-419a-7153-88d0-e543967e5b45` | 3000 | a tiny cozy cottage with cream timber-framed walls, a dark brown shingle gable roof, a green front door, small windows and a little porch |
| shop_m | `01a1be5b-b331-72d1-b73e-2bcf36cafb6d` | `01a1be5d-413b-7032-a463-393784fccc86` | 3000 | a tiny village corner shop with cream walls, a red and white striped awning over a big front window, a wooden front door and a small blank sign board, flat roof |
| bakery | `01a1be5c-8912-70fd-99c1-83f5cc069de2` | `01a1be5e-411f-733f-98ce-57c094ff08f4` | 3000 | a tiny village bakery with warm yellow walls, a brown gable roof with a chimney, a red striped awning over the front window and a giant loaf of bread sign on the roof |
| sawmill | `01a1be5b-b4d3-7683-a917-f66cf595aa94` | `01a1be5d-40ad-7257-a860-5bdb719e3f69` | 3000 | a tiny rustic red wooden sawmill barn with a dark roof, big open front doors, a small stack of logs beside it and a round saw blade |
| apiary | `01a1be5b-b44e-7287-b887-35f8efeee6fc` | `01a1be5e-4115-7316-841a-df69dbfaef82` | 3000 | a tiny honey farm shed with yellow walls and a brown roof, three stacked white and yellow wooden beehive boxes beside the door and a honey pot sign |
| hq | `01a1be5b-b4ce-7604-bd38-0022480fffbb` | `01a1be5e-41ea-7402-a5e2-5cd5997cbb6b` | 3000 | a tiny delivery company depot garage with teal walls, a big roll-up garage door, a plain yellow sign board above the door, a small office door and a flat roof |
| maple | `01a1be5b-b42d-712d-93e2-4faa58476a46` | `01a1be5e-4278-7494-9c0d-97a61a2dcc64` | 800 | a small round autumn maple tree with a short brown trunk and one big fluffy orange and red leafy canopy |
| beach_a | `01a1be5c-89ab-7436-b767-9c73c883ca51` | `01a1be5e-42af-7150-bdc1-e9d8f5b01f4e` | 3000 | a tiny pastel mint green two storey beach house with white trim, a flat white roof, big windows, a white front door and a little wooden porch |
| beach_b | `01a1be5b-b4f5-7550-9c6c-4d7105c4d8ab` | `01a1be5e-444e-741b-b00c-69d225859a73` | 3000 | a tiny pastel pink seaside cottage with white wooden trim, a light blue roof, a round porthole window and a white front door with steps |
| shop_s | `01a1be5c-899c-7339-9ca8-6c4dfdcdc3e9` | `01a1be5e-e9a9-7597-b42e-d543c1939f4e` | 3000 | a tiny seaside boardwalk shop with pastel blue walls, a pink and white striped awning, a big front window, a white door and a flat roof with a small blank sign |
| fishmarket | `01a1be5c-89c8-753d-bcd6-c3b8b595b48b` | `01a1be5e-43a6-775a-b02a-bf48bd6a7acf` | 3000 | a tiny seaside fish market shed with light blue wooden walls, a dark blue gable roof, an open front counter with fish on ice and a big fish sign on the roof |
| icecream | `01a1be5c-8936-7159-8c5d-00e247f42f0b` | `01a1be5e-44cd-7025-b341-1e17dfe2bfd9` | 3000 | a tiny pastel pink ice cream parlour with white trim, a pink and white striped awning and a giant ice cream cone sign on the roof |
| taffy | `01a1be5c-88e2-7127-8eb2-9fbd5b402dcf` | `01a1be5e-e971-7729-8359-c582dd6d9dfc` | 3000 | a tiny candy factory with pink and white candy striped walls, a purple roof, a small chimney and a big wrapped candy sign |
| lighthouse | `01a1be5b-b41c-7465-b1e8-16ec8b8105c2` | `01a1be5e-e8a9-7712-b43c-116c0f73e9a6` | 2500 | a small red and white striped lighthouse with a glass lantern room and a red cap on a small rocky base |
| palm | `01a1be5c-897b-777f-ba54-7fcde2106203` | `01a1be5e-e8f0-7295-9833-959ccc6a905d` | 800 | a small palm tree with a gently curved trunk and a few bright green fronds |
| inn | `01a1be62-018c-7439-9e1f-c003e861019b` | `01a1be62-8e8f-71c2-8f3c-7d2d4592a989` | 3000 | a tiny cozy two storey village inn with cream timber-framed walls, a red tiled gable roof, a hanging wooden sign, a wooden front door and window boxes with flowers |
| school | `01a1be62-01b6-7082-88e8-87284a0dd6e7` | `01a1be62-8fce-75ca-9577-079ef37c11c9` | 3000 | a tiny little red village schoolhouse with white trim, a small bell tower on the roof, a white front door with steps and tall windows |
| hotel | `01a1be62-018b-71e3-b01f-79cbb25c6ada` | `01a1be62-8e58-753b-9f50-35faec4ebcac` | 3000 | a tiny pastel yellow seaside hotel with white balconies, a light blue flat roof with a small sign, a white front door and striped window awnings |
| cafe | `01a1be62-01ff-720a-b7bd-1c47a6ce23d3` | `01a1be62-8ff9-70f4-9655-656aea717812` | 3000 | a tiny pastel seafoam green seaside cafe with white trim, a mint and white striped awning, a big front window and one small table with an umbrella beside the door, flat roof |
