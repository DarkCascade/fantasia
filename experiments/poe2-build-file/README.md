# PoE2 build-file generator

Generates and validates `.build` files for **Path of Exile 2's official
in-game Build Planner** (added Patch 0.5) from a build description given in
plain display names — "Flameblast", "Avatar of Fire", "Gemling Legionnaire"
— rather than the internal game-data ids the file format actually requires.

## What a `.build` file is

GGG's in-game Build Planner reads `.build` JSON files from
`Documents/My Games/Path of Exile 2/BuildPlanner/` and highlights the
matching passive-tree route, tags recommended skill/support gems, and drops
hint icons on inventory slots — a visual guide overlay. It does not allocate
points or equip items for you.

## Why display names aren't enough on their own

Every reference in the file is to an internal id, not the name a player
sees: passives use `PassiveSkills` table ids (`"projectiles18"`,
`"AscendancyMercenary3Notable1_"`), gems use `BaseItemTypes` paths
(`"Metadata/Items/Gems/SkillGemFlameblast"`). These aren't derivable by
formula — confirmed by cross-checking against a real, in-game-tested
`.build` file (`test/fixtures/gemling-example.build`):

- The gem id path is inconsistently `Gem` vs. `Gems` for no discernible
  reason (`.../Gem/SupportGemBurgeonTwo` next to `.../Gems/SkillGemFlameblast`
  in the same file) — a naming-formula generator would get an unpredictable
  subset of ids wrong.
- A gem's *id* can lag behind its *current display name* after a rename:
  `SupportGemConcentratedEffect`'s id still says "Effect", but the gem is
  now called "Concentrated Area" in-game.
- Generic filler passives (`"Attribute"`, `"Skill Gem Quality"`) repeat
  dozens of times across the tree, sometimes even within the *same*
  ascendancy — name lookup alone can't place a specific instance.

So this tool resolves everything against two real upstream data sources
instead of guessing, and refuses (loudly) rather than silently picking a
default whenever a name doesn't resolve to exactly one id.

## Data sources

| What | Source | Why trust it |
|---|---|---|
| Passive tree (ids, names, adjacency) | [`grindinggear/poe2-skilltree-export`](https://github.com/grindinggear/poe2-skilltree-export) | GGG's own repo — the exact data their web tree planner runs on |
| Skill/support gems (ids, names) | [`repoe-fork/poe2`](https://github.com/repoe-fork/poe2) | Community extraction of PoE2's internal data tables, RePoE-style |
| Unique items (names) | same repo, `data/uniques.json` | ditto |

Run `npm run fetch-data` to download these into `data/raw/` (gitignored —
large, and PoE2 patches change this data), then `npm run build-index` to
derive the compact `data/index/*.json` this library actually loads (the raw
tree export is ~5MB of mostly icon paths and UI art metadata; the derived
index keeps only id/name/stats/adjacency, ~1.8MB). `npm run refresh-data`
does both. **Re-run this after a PoE2 patch** — passive/gem ids do change.

## Usage

```js
const { assembleBuildFile, writeBuildFile } = require('./src');

const { build, validation } = assembleBuildFile({
  name: 'My Flameblast Gemling',
  author: 'you',
  ascendancy: 'Gemling Legionnaire',      // or the raw id 'Mercenary3' — either works
  passives: {
    // startClass is inferred from `ascendancy` when omitted
    notables: ['Essence of Virtue'],       // resolved within this ascendancy automatically
    keystones: ['Avatar of Fire'],         // resolved tree-wide
    ids: ['jewel_slot1975'],               // pass-through ids you already know
  },
  skills: [
    {
      name: 'Flameblast',
      levelInterval: [90, 100],
      supports: ['Burgeon II', 'Concentrated Area', 'Ignite III'], // tier is part of the name
    },
  ],
  gear: [
    { inventoryId: 'Amulet1', slotX: 0, slotY: 0, additionalText: '<b>{Stat priority}\\r\\n1. Spirit' },
  ],
});

if (!validation.valid) throw new Error(JSON.stringify(validation.errors, null, 2));
writeBuildFile(build, 'My Flameblast Gemling.build');
// -> drop this in Documents/My Games/Path of Exile 2/BuildPlanner/
```

`assembleBuildFile` resolves notables/keystones and paths them to the class
start via `computeAllocationPath` — you name *what* to take, not the filler
nodes needed to reach it. That's a greedy nearest-target-first walk, not an
optimal Steiner tree (that's NP-hard and unnecessary here — every real build
planner ships the same greedy approach; on PoE2's sparse tree it rarely
finds a worse route than optimal).

Lower-level pieces (`src/passives.js`, `src/gems.js`, `src/uniques.js`,
`src/schema.js`) are usable directly for anything the assembler doesn't
cover.

## Known limitations — read before trusting output blindly

- **Name collisions.** `resolvePassiveId`/`resolveGemId` throw rather than
  guess whenever a name isn't unique (optionally scoped by `ascendancyId`
  or `category`) — but scoping isn't always enough (three different
  Mercenary3 "Small" nodes are all just named "Skill Gem Quality"). When
  that happens, use `findPassivesByName`/`findGemsByName` and pick the
  right id yourself (by adjacent node context, or by the gem's category).
- **Two markup tags are unconfirmed.** `additional_text` in a real file
  uses `<b>`/`<i>`/`<s>`/`<m>` — `<b>` (bold) and `<i>` (italics) are
  obvious from context, but `<s>` and `<m>`'s exact meaning (a default body
  style and an accent colour, going by how they're used) isn't confirmed
  against GGG's own docs (blocked from the sandbox this was researched in).
  Verify in-game before relying on either for something visually important.
- **`Trinket1` vs `Charm1`.** The schema's community source only lists
  `Charm1`; a real file uses `Trinket1` for the same slot type. Both are
  accepted here since which one your current patch actually expects wasn't
  independently confirmed — if in-game highlighting doesn't show up for a
  charm slot, try the other.
- **Uniques aren't validated against gear class.** `uniques.findUnique(name)`
  looks a name up and returns its item class as a sanity check, but nothing
  stops `assembleBuildFile` from attaching a boot enchant's name to a
  `Weapon1` slot — check this yourself for now.

## Testing

```sh
npm test
```

The strongest test in here validates `test/fixtures/gemling-example.build`
— a real file the user got working in-game, completely unmodified — against
our schema. Other tests cross-check id resolution against the same file's
real ids, confirm the ascendancy→start-node mapping computed at runtime
(see `passives.js`'s `computeClassStartMap`), and verify `computeAllocationPath`
only ever returns a genuinely connected route (every node adjacent to
something allocated before it — not just "the targets, however you get
there").
