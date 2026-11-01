# Starship UI

UI mockups for a sci-fi **starship management game**: crew, planet exploration,
diplomacy, and trading across star systems. Three art directions, each with
three screens (a ship screen, a planet trade hub, a planet exploration screen),
nine in total. Not part of the deployed site.

Run it: serve the repo root (`python3 -m http.server`) and open
`experiments/starship-ui/index.html`. Each skin is a single self-contained
page with no network dependencies and no image assets.

| Skin | Look | Page |
|---|---|---|
| **Hologlass** | dark translucent glass HUD, cyan line-work, glow, LCARS-style bridge-console widgets | `hologlass/index.html` |
| **Atomic Age** | mid-century space-age poster: flat cut-paper colour, starbursts, halftone, faces | `atomic/index.html` |
| **Pixel Bridge** | 640×360 pixel art, 6×10 font, Bayer dithering, expressive sprites | `pixel/index.html` |

Inside a skin: `1` / `2` / `3` switch screens (or `#ship`, `#market`, `#explore`
in the URL), `N` toggles the **numbers lens**, and clicking a crew member or a
map marker selects it. `?lens=1` starts with the lens on.

## The brief: communicate without menus and numbers

The three skins share one set of ideas. The default screen never needs a table
or a stat block; the numbers lens exists for players who want them.

- **Status lives in the world.** Crew mood is posture + a halo / a weather
  glyph / an emote. A strained engine room flickers and steams; hull damage is
  a crack on the hull; power is how bright the lamps are.
- **Exception-based.** Everything is quiet unless it needs you: one attention
  line, a thought-bubble over the person who wants something, and a red thread
  to the room. The pixel skin's system lamps stay dark when healthy.
- **Fuel is a ring, not a bar.** Fuel draws your **jump range** on the star map.
  On a planet, air and tether draw the away team's **safe ring**; points of
  interest outside it are visibly out of reach (Pip's Spires, in the mock).
- **Price is a position.** Local price vs. the galaxy average is height (Hologlass),
  the tilt of a balance (Atomic Age, a gauge needle) or a coin stack against a dashed average
  line (Pixel). Scarcity is orb size / an emptier shelf. Your own cargo rides on
  the goods so "what do I carry that's dear here?" is one glance.
- **Routes show their reasons.** Width = profit for what you're *currently
  carrying*, dashes / skull = danger, pips = jumps.
- **Relationships on demand.** Select a crew member and their bonds draw as
  threads: jagged for friction, soft for closeness.
- **Diplomacy is a shape.** Rapport = overlapping circles, bunting flags, or hearts. Faction attitude = a ring, a face on a pennant, or a merchant's emote.
- **Pressure is an object.** The storm is a sweeping arc, an hourglass, a pie-wedge clock or a
  thundercloud; the survey is the map filling in.

## How it's built

- `shared/state.js` is the one mock game state (crew, bonds, market, routes,
  planet, star map) plus the tab/lens shell and tooltip helper. Every skin turns
  the same data into its own visuals, which is the point: the ideas live in the
  data model, not the art.
- **Hologlass** and **Atomic Age** are one inline SVG per screen (`viewBox
  1280×720`, so they scale to any window). Hologlass carries a small widget
  library (LCARS tabs/elbows/buttons, LED slider ladders, rotary knobs, scrolling
  scope/EKG traces, a spectrum analyzer, radar sweeps, toggles, lamp grids, hex
  data rails, a hex shield bubble); the decorative ones are texture, but the EKG
  rate, harmonics roughness and shield arc are wired to the same state as the
  main screen. Atomic Age's look is flat fills, a halftone `pattern`, a paper-grain
  filter, and one `face()` function that draws every mood.
- **Pixel Bridge** draws every frame to a 640×360 `<canvas>` (CSS
  `image-rendering: pixelated`). Layout is still authored in 320×180 "units" so
  hit boxes stay simple, but every primitive draws at native resolution:
  half-unit rects, Bresenham lines, an 8×8 Bayer dither (cached `createPattern`
  tiles), sprites stored as strings and run through Scale2x/EPX to smooth their
  diagonals, and a 6×10 font made by Scale2x-ing a 3×5 glyph table. People are
  10×22 native-pixel sprites with an outline pass, shading and per-mood faces
  (smile, frown, sweat drop, ×-eyes); portraits are the same sprite at 3×. The
  exploration terrain is painted once per native pixel into an offscreen canvas
  from value noise, with a Bayer-dithered fog edge. Hover tooltips come from hit
  rectangles registered during the draw. A frame costs ~4 ms.
- All animation is CSS/SMIL (SVG skins) or a 150 ms tick (pixel). Nothing needs
  a build step.

## Regenerating the screenshots

`shots/*.png` are generated headlessly (Chromium via the globally installed
Playwright, as described in the repo's `CLAUDE.md`):

```sh
python3 -m http.server 8123          # from the repo root
node experiments/starship-ui/shoot.js            # all three skins
node experiments/starship-ui/shoot.js pixel      # or just one
```

## Things not designed yet

Diplomacy dialogue itself (only the rapport read-out and the three gestures are
mocked), combat/boarding, ship upgrades, and the star-map screen proper (only the
range chart exists). The mocks assume the loop *ship → jump → trade → explore*
and a pause-able real-time ship, but nothing here commits to a ruleset.
