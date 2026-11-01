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
| **Hologlass** | dark translucent glass HUD, cyan line-work, glow | `hologlass/index.html` |
| **Cartographer** | parchment atlas: ink, watercolour, brass, wax seals | `cartographer/index.html` |
| **Pixel Bridge** | 320×180 pixel art, 3×5 bitmap font, dithering | `pixel/index.html` |

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
  the tilt of a balance (Cartographer) or a coin stack against a dashed average
  line (Pixel). Scarcity is orb size / an emptier shelf. Your own cargo rides on
  the goods so "what do I carry that's dear here?" is one glance.
- **Routes show their reasons.** Width = profit for what you're *currently
  carrying*, dashes / skull = danger, pips = jumps.
- **Relationships on demand.** Select a crew member and their bonds draw as
  threads: jagged for friction, soft for closeness.
- **Diplomacy is a shape.** Rapport = overlapping circles, planks on a rope
  bridge, or hearts. Faction attitude = a ring, a wax seal (bright / plain /
  cracked), or a merchant's face.
- **Pressure is an object.** The storm is a sweeping arc, an hourglass or a
  wind-head; the survey is the map filling in.

## How it's built

- `shared/state.js` is the one mock game state (crew, bonds, market, routes,
  planet, star map) plus the tab/lens shell and tooltip helper. Every skin turns
  the same data into its own visuals, which is the point: the ideas live in the
  data model, not the art.
- **Hologlass** and **Cartographer** are one inline SVG per screen (`viewBox
  1280×720`, so they scale to any window). Cartographer's hand-drawn feel is
  `feTurbulence` + `feDisplacementMap` wobble on the ink, a paper-grain filter
  and a `blot` filter on the watercolour washes.
- **Pixel Bridge** draws every frame to a 320×180 `<canvas>` (CSS
  `image-rendering: pixelated`): Bresenham lines, ordered (Bayer) dithering for
  gradients and fog, sprites as strings, people drawn from rectangles with a
  few per-character accessories, and a 3×5 font defined as five octal digits per
  glyph. Hover tooltips come from hit rectangles registered during the draw.
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
