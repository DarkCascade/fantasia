# Gravebound — Vertical Slice Implementation Plan

**Audience: the model implementing this.** Read this whole document before
writing code. Companion: [`executive-summary.md`](./executive-summary.md) for
scope rationale and what was deliberately cut.

Everything below is normative unless marked *(suggestion)*. Where a number is
given, use that number — the balance targets in §14 assume them.

---

## 0. Assumptions, and how to challenge them

| # | Assumption | If wrong |
|---|---|---|
| A1 | The slice ships as a new game inside this repo (Fantasia), following its conventions: `window.launchGravebound()`, teardown via `window.returnToMenu()`, static files, no build step. | If the target is a standalone project instead, keep §3–§13 verbatim and discard §2 and §12. |
| A2 | UI is **DOM/CSS**, not Phaser. This is a card-and-text RPG; Phaser's canvas text would be a liability. Precedent: Gloom Hollow 3D's DOM HUD (`src/gloom-hollow-3d.js`). | If Phaser is mandated, §3–§10 are unaffected (the core is renderer-agnostic); only §11 is rewritten. |
| A3 | No external assets. All art is CSS (gradients, borders, box-shadow, unicode glyphs). This preserves the repo's offline-static property. | — |
| A4 | Original names and flavour throughout. The help site is a **mechanics reference only** — do not copy skill names, monster names, or prose from Buriedbornes2. | — |
| A5 | Modern evergreen browsers; ES2020 + ES modules + dynamic `import()`. | — |

**Do not add content beyond the counts in §5.** 8 skills, 6 runes, 7 statuses,
7 monsters + 1 boss, 5 room types, 1 dungeon, 1 job. Content is the easiest
place for this slice to fail.

---

## 1. Naming

- Game title: **Gravebound**
- Launcher: `window.launchGravebound()`
- Handle: `window.graveboundGame` — a plain object with `destroy()` (**no
  arguments**, like `gloom3DGame`, unlike the Phaser games' `destroy(true)`)
- localStorage key: `gravebound-best`
- CSS/DOM namespace: every class is `gb-*`; every test hook is `data-gb="…"`
- Seed override query param: `?gbseed=<int>`

---

## 2. Files and repo integration

### 2.1 New files

```
src/gravebound.js              classic script; defines window.launchGravebound(); dynamic-imports main.js
src/gravebound/package.json    {"type":"module"} — makes Node treat this dir as ESM. Ignored by browsers.
src/gravebound/main.js         boot(container) -> handle; owns lifecycle, wires core <-> view
src/gravebound/rng.js          seeded RNG
src/gravebound/content.js      ALL data tables. No logic, no imports except constants.
src/gravebound/rules.js        pure rule functions (damage, hit, statuses, brave, runes)
src/gravebound/combat.js       battle state machine
src/gravebound/run.js          run / dungeon / floor / room state machine
src/gravebound/view.js         DOM rendering + input
src/gravebound/styles.js       exported CSS string
src/gravebound/sim.js          headless run simulator (dev tool; shipping it is harmless)
tools/gravebound-sim.mjs       Node entry point: dynamic-imports sim.js, prints stats
```

`src/gravebound/package.json` is load-bearing for testing, not for the browser:
Node resolves module type from the nearest `package.json`, so this one line lets
`node` import the core modules as ESM with no flags and no bundler. The deploy
does `cp -r src _site/`, so it ships harmlessly.

### 2.2 `src/gravebound.js` (the classic-script shim)

Mirror `src/gloom-hollow-3d.js`'s bootstrap exactly — resolve the module URL
against the script's own `src`, not the document base, so it works both from the
repo root and from the `/fantasia/` Pages subpath:

```js
(function () {
  "use strict";
  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  var MAIN_URL = new URL("./gravebound/main.js", SELF_SRC || window.location.href).href;

  function launchGravebound() {
    if (window.graveboundGame) return;
    var container = document.getElementById("game-container");
    // The handle exists from the moment the button is pressed, so returning to
    // the menu mid-load cancels the boot instead of racing it.
    var handle = { game: null, cancelled: false, destroy: destroy };
    window.graveboundGame = handle;
    import(MAIN_URL).then(function (mod) {
      if (handle.cancelled) return;
      handle.game = mod.boot(container);
    }).catch(function (err) {
      console.error("Gravebound failed to load", err);
      handle.cancelled = true;
    });
    function destroy() {
      handle.cancelled = true;
      if (handle.game) { try { handle.game.destroy(); } catch (e) {} handle.game = null; }
    }
  }
  window.launchGravebound = launchGravebound;
})();
```

### 2.3 `index.html` edits (four of them)

1. **Script tag** alongside the other games:
   `<script src="src/gravebound.js"></script>`
2. **Menu button.** Page 2 currently holds five buttons (`btn-underfoot`,
   `btn-gloom`, `btn-combat`, `btn-gloom3d`, `btn-starcatcher`) and page 1 holds
   five. Add `btn-gravebound` as a **sixth button on page 2**; check the
   `.menu-page` layout still fits at 390×844 and, if it does not, add a page 3
   to the carousel (`#menu-screen[data-page]` CSS at ~line 150 plus the
   `page-next`/`page-prev` handlers at ~line 432). **Do not repurpose the
   `btn-underfoot` placeholder** — it belongs to a different planned game and
   owns the under-construction modal.
3. **Click handler**, next to the others:
   ```js
   document.getElementById("btn-gravebound").addEventListener("click", function () {
     hideMenu();
     if (typeof window.launchGravebound === "function") window.launchGravebound();
   });
   ```
4. **Teardown line** inside `window.returnToMenu()` (~line 491), in the
   non-Phaser group beside `gloom3DGame`:
   ```js
   if (window.graveboundGame) { try { window.graveboundGame.destroy(); } catch (e) {} window.graveboundGame = null; }
   ```

### 2.4 Workflow

**No change to `.github/workflows/deploy.yml`.** `cp -r src _site/` already
ships new game files and subdirectories. Do not add anything to the "Verify
required files" check — that list is for core files only.

---

## 3. Architecture

```
                content.js  (data)          rng.js (seeded)
                     |                          |
                     v                          v
   rules.js  ──►  combat.js  ──►  run.js  ──►  main.js  ──►  view.js ──► DOM
   (pure fns)     (battle FSM)   (run FSM)   (lifecycle)    (render+input)
```

Three hard rules:

1. **The core is pure.** `rng.js`, `content.js`, `rules.js`, `combat.js`,
   `run.js` must not touch `document`, `window`, `localStorage`, timers, or
   `Math.random`. They import nothing from `view.js` or `main.js`. A run must be
   fully simulatable in Node. Enforce with a grep gate (§13.4).
2. **State transitions return `{state, events}`.** Reducers never mutate the
   state they were handed; they return a new state object plus an ordered list of
   **events** (§8.4) describing what happened. The view animates events; it never
   re-derives what happened by diffing.
3. **All randomness flows through one `Rng` instance** created per run and
   stored on the run state, so a seed reproduces a run exactly.

### 3.1 `rng.js`

```js
export function makeRng(seed) { /* mulberry32 */ }
// rng.next()        -> float [0,1)
// rng.int(n)        -> integer [0,n)
// rng.range(a,b)    -> float [a,b)
// rng.pick(arr)     -> element
// rng.weighted(arr, weightFn) -> element
// rng.chance(pct)   -> boolean, pct is 0..100
// rng.shuffle(arr)  -> new shuffled array
// rng.state / rng.seed exposed for save+replay
```

Mulberry32 is 6 lines; write it inline, no dependency.

---

## 4. Data model

Use JSDoc typedefs (no TypeScript build step). Put these at the top of
`content.js`.

```js
/** @typedef {"turns"|"actions"|"battles"|"permanent"} Clock */

/** @typedef {Object} StatusInstance
 *  @property {string} id          // key into STATUSES
 *  @property {number} stacks      // magnitude
 *  @property {number} remaining   // ticks left on its clock; Infinity for "permanent"
 */

/** @typedef {Object} Combatant
 *  @property {string} uid          // unique within a battle
 *  @property {string} name
 *  @property {boolean} isPlayer
 *  @property {number} hp @property {number} maxHp
 *  @property {number} atk @property {number} def
 *  @property {number} hit @property {number} eva
 *  @property {number} resist        // status resistance
 *  @property {number} brave         // 0..BRAVE_MAX
 *  @property {StatusInstance[]} statuses
 *  @property {string[]} skillIds    // for monsters: their attack table
 *  @property {Object<string,number>} charges  // skillId -> uses left this battle
 *  @property {boolean} elite
 *  @property {number} tier
 */

/** @typedef {Object} SkillSlot
 *  @property {string} skillId
 *  @property {(string|null)[]} runes   // length RUNE_SOCKETS, null = empty
 */

/** @typedef {Object} PlayerBuild
 *  @property {SkillSlot[]} slots        // length SKILL_SLOTS
 *  @property {Object<string,string|null>} equipment  // {weapon, armor} -> itemId
 *  @property {string[]} inventoryRunes  // unsocketed runes
 */

/** @typedef {Object} RunState
 *  @property {number} seed @property {Object} rng
 *  @property {PlayerBuild} build
 *  @property {Combatant} player          // persists across battles (hp carries over)
 *  @property {number} floor              // 1..FLOORS
 *  @property {number} layer              // 1..LAYERS_PER_FLOOR
 *  @property {number} risk               // 0..∞, percent
 *  @property {boolean} savage
 *  @property {number} soulstones
 *  @property {boolean} revivedOnce
 *  @property {"build"|"map"|"battle"|"event"|"loot"|"dead"|"won"} phase
 *  @property {Object|null} battle        // BattleState when phase === "battle"
 *  @property {Object[]} roomOptions      // the 2 offers for this layer
 *  @property {Object} stats              // run tally: kills, elites, damage, turns
 */
```

---

## 5. Content tables (`content.js`)

These are the exact contents of the slice. Every number here is a starting
value; §14 says which ones you may retune and which you may not.

### 5.1 Global constants

```js
export const BRAVE_MAX = 3;
export const SKILL_SLOTS = 3;         // source game has 5; slice uses 3
export const RUNE_SOCKETS = 2;        // source game has 5; slice uses 2
export const FLOORS = 5;
export const LAYERS_PER_FLOOR = 3;
export const ROOM_OFFERS = 2;         // "choose between 2 rooms" — from the source
export const SAVAGE_THRESHOLD = 100;  // risk % at which Savage mode latches on
export const MAX_ENEMIES = 3;         // 4 in Savage
export const VARIANCE = [0.9, 1.1];   // damage roll
export const HIT_CLAMP = [5, 100];
```

### 5.2 The job (one)

```js
export const JOB = {
  id: "revenant", name: "Revenant",
  blurb: "A corpse that remembers being a soldier.",
  maxHp: 120, atk: 14, def: 8, hit: 90, eva: 10, resist: 20,
  startingSkillPool: ["cleave", "rend", "bulwark", "whirl", "draught", "hexmark"],
  startingPicks: 3,          // pick 3 of the 6 to fill the 3 slots
};
```

`vigil` and `toll` (§5.3) are **loot-only** — they cannot be picked at start.

### 5.3 Skills (8)

`power` is a multiplier on ATK (1.0 = a plain strike). `acc` is added to the hit
formula. `endsTurn` defaults `true`. `charges` is uses-per-battle (absent =
unlimited). Every skill has a `burst` variant used when `brave === BRAVE_MAX`.

| id | name | target | power | acc | charges | effects | **burst** |
|---|---|---|---|---|---|---|---|
| `cleave` | Cleave | one | 1.0 | +10 | — | damage | hits **all**, power 0.8 |
| `rend` | Rend | one | 0.7 | +10 | — | damage, apply `bleed` 2 | power 1.0, `bleed` 5 |
| `bulwark` | Bulwark | self | — | — | — | apply `guard` 1 | `guard` 3, heal 15% maxHp |
| `whirl` | Whirl | all | 0.75 | −20 | — | damage | power 1.1, acc +20 |
| `draught` | Grave Draught | self | — | — | 2 | heal 25% maxHp | heal 100%, clear all negative statuses |
| `hexmark` | Hexmark | one | 0.3 | +10 | — | damage, apply `weaken` 3 | target **all**, also apply `drain` 2 |
| `vigil` | Steel Vigil | self | — | — | **1** | apply `rage` 3, **`endsTurn: false`** | `rage` 5 + `guard` 2 |
| `toll` | Reaper's Toll | one | 1.6 | −10 | — | damage, then self-damage 10% maxHp | **replaced entirely** by *Toll of Silence*: power 2.4, ignores 50% of target DEF, no self-damage |

Two of these are guard rails, not flavour:

- **`vigil` has `charges: 1`.** It is the only non-turn-ending skill; without a
  per-battle charge it can be re-used forever inside one turn.
- **`toll`'s burst is a full replacement**, not a modifier. This reproduces the
  source's "some skills become a completely different skill in Burst" case, and
  the view must render the *burst* name and description while brave is maxed.

### 5.4 Runes (6)

| id | name | hook | effect |
|---|---|---|---|
| `serrate` | Serrate | on damaging hit | apply `bleed` 1 to the target |
| `siphon` | Siphon | on damage dealt | heal the user 25% of damage dealt |
| `echo` | Echo | after resolve | 30% chance to deal the skill's damage again at 50% power |
| `ward` | Ward | after use | apply `guard` 1 to the user |
| `kindle` | Kindle | on turn end | +1 extra brave |
| `keeper` | Keeper's Vigil | **auto-activate** | once per battle, when the user's HP falls below 30% at the start of their turn, this skill fires immediately and for free |

`keeper` is the slice's representative of the source's *auto-use /
auto-activate* runes. Keep it — it is the one rune that changes turn structure.

### 5.5 Statuses (7)

Four different clocks, matching the source's taxonomy (turns / actions /
battles / permanent).

| id | name | clock | negative? | effect |
|---|---|---|---|---|
| `bleed` | Bleeding | `turns` | yes | at the bearer's turn end: take `3 × stacks`, then `stacks -= 1` (expires at 0) |
| `poison` | Rot | `battles` | yes | at the bearer's turn end: take `5% maxHp` (rounded up, min 1). Does **not** decay within a battle; `remaining -= 1` at battle end |
| `guard` | Guard | `turns` | no | incoming damage × 0.6 |
| `rage` | Rage | `actions` | no | outgoing damage × 1.3; `remaining -= 1` each time the bearer uses a skill |
| `weaken` | Weakened | `turns` | yes | outgoing damage × 0.75 |
| `stone` | Petrified | `turns` | yes | the bearer skips their turn entirely |
| `drain` | Drained | `turns` | yes | the bearer gains no brave |

Rules: same-id reapplication takes `max(remaining)` and `stacks` **adds** for
`bleed` only (cap 10); everything else takes `max(stacks)`. Statuses on the
`turns` clock are cleared at battle end; `battles` and `permanent` persist across
rooms and floors.

### 5.6 Monsters (7 + 1 boss)

Base stats at floor 1. Scale per §7.3.

| id | name | tier | elite | hp | atk | def | hit | eva | resist | skills |
|---|---|---|---|---|---|---|---|---|---|---|
| `husk` | Husk | 1 | no | 40 | 8 | 2 | 85 | 5 | 10 | `m_claw` |
| `hound` | Carrion Hound | 1 | no | 32 | 11 | 1 | 90 | 20 | 5 | `m_bite` |
| `acolyte` | Pale Acolyte | 2 | no | 45 | 9 | 4 | 88 | 8 | 25 | `m_hex`, `m_claw` |
| `sergeant` | Bone Sergeant | 2 | no | 70 | 12 | 8 | 88 | 5 | 20 | `m_cleave` |
| `swarm` | Rotfly Swarm | 2 | no | 38 | 7 | 3 | 92 | 25 | 15 | `m_spit` |
| `warden` | Gravewarden | 3 | **yes** | 120 | 16 | 12 | 88 | 0 | 35 | `m_slam` |
| `ashen` | Ashen Revenant | 3 | **yes** | 100 | 18 | 6 | 92 | 12 | 30 | `m_sear` |
| `tollkeeper` | **The Toll-Keeper** (boss) | 4 | boss | 420 | 20 | 14 | 92 | 8 | 45 | `m_slam`, `m_sear`, `m_tithe` |

Monster skills (same schema as player skills; monsters also have brave and
burst — this is what makes an enemy turn readable):

| id | power | target | effect | burst |
|---|---|---|---|---|
| `m_claw` | 1.0 | player | damage | power 1.4 |
| `m_bite` | 0.8 | player | damage | **two hits** at 0.8 |
| `m_hex` | 0.4 | player | apply `weaken` 3 | apply `drain` 2 + `weaken` 3 |
| `m_cleave` | 1.1 | player | damage | power 1.5, apply `bleed` 2 |
| `m_spit` | 0.5 | player | apply `poison` 1 | apply `poison` 2, power 0.8 |
| `m_slam` | 1.2 | player | damage | power 1.6, 35% apply `stone` 1 |
| `m_sear` | 1.1 | player | damage, apply `bleed` 1 | power 1.7, `bleed` 3 |
| `m_tithe` | 0.9 | player | damage, **−1 player brave** | power 1.5, **set player brave to 0** |

**Boss phase change:** when the Toll-Keeper first drops below 50% HP, emit a
`phase` event, grant it permanent `rage` 1 (`clock: "permanent"`), and set its
brave gain to +2/turn instead of +1. One phase, no more.

### 5.7 Equipment (2 slots, generated not authored)

Slots: `weapon`, `armor`. Items are **generated** from rarity, not hand-listed —
this keeps the loot table from becoming content.

```js
// rarity r in 1..6
weapon: { atk: round(3 + 2.2*r + floor*0.8), hit: r >= 4 ? 5 : 0 }
armor:  { def: round(2 + 1.6*r + floor*0.6), maxHp: round(6 + 5*r) }
```

Name = `RARITY_PREFIX[r] + " " + rng.pick(WEAPON_NOUNS | ARMOR_NOUNS)`, with
6 prefixes and ~8 nouns per slot. Equipping replaces; the old item is discarded
with a confirm-free swap (the slice has no stash).

### 5.8 Rooms (5 types)

| type | weight | contents |
|---|---|---|
| `battle` | 45 | 1–3 monsters (§7.3) |
| `elite` | 12 | 1 elite + 0–1 normal; doubled weight in Savage |
| `treasure` | 15 | 1 loot roll, free |
| `craft` | 12 | the soulstone shop (§9.3) |
| `rest` | 16 | heal 30% maxHp **and** `risk -= 25` |

Per layer, draw `ROOM_OFFERS` (2) **distinct** types by weight. The **last layer
of every floor** is forced: `battle` with a guaranteed elite on floors 1–4, and
the **boss** on floor 5 (no choice offered — show one room card and a "descend"
button).

---

## 6. Rules (`rules.js`) — the formulas

All of these are pure functions. Get them exactly right; everything else is
plumbing.

### 6.1 Hit

```
chance = clamp(skill.acc + attacker.hit - defender.eva, 5, 100)
hit    = rng.chance(chance)
```
A miss emits a `miss` event and applies **no** effects — including no rune hooks.

### 6.2 Damage

```
raw       = attacker.atk * skill.power
raw      *= outgoingMult(attacker)         // rage ×1.3, weaken ×0.75 (multiply all that apply)
defEff    = defender.def * (skill.defPierce ? 1 - skill.defPierce : 1)
mitigated = raw * 100 / (100 + defEff)
mitigated*= incomingMult(defender)         // guard ×0.6
dmg       = max(1, round(mitigated * rng.range(0.9, 1.1)))
```

Defence is a **diminishing multiplier, not a subtraction**. This is a deliberate
divergence from a subtractive model: it guarantees a minimum of 1 damage, so no
build can stall a battle into an unwinnable loop, and it keeps late-floor DEF
scaling from flipping fights binary.

### 6.3 Status application

```
chance = clamp(baseChance - defender.resist, 5, 100)   // baseChance defaults to 100
```
So a 100-base status still lands 80% of the time on a 20-resist target, and 55%
on the boss. Statuses applied to **yourself** (`guard`, `rage`) always land.

### 6.4 Brave

- Battle starts with `brave = 0` for everyone.
- `brave === BRAVE_MAX` ⇒ the combatant is **in burst state**: *every* skill
  displays and resolves as its burst variant.
- Using any skill while in burst state sets `brave = 0` **before** the end-of-turn
  gain (so you finish a burst turn at 1, and burst again on the 3rd turn after).
- End of turn: `brave = min(BRAVE_MAX, brave + 1 + kindleBonus)` unless the
  combatant has `drain`.
- A kill grants `+1` brave immediately (still capped, still suppressed by `drain`).
- Non-turn-ending skills (`vigil`) grant **no** brave and do **not** trigger
  end-of-turn status ticks.

### 6.5 Rune resolution — **rune linking**

This is the signature system. Implement it as exactly one function:

```js
/** Union of every rune socketed into ANY slot holding this skill, deduped.
 *  This is "rune linking": hold two copies of a skill and both copies gain
 *  every rune socketed into either. Duplicates of the SAME rune id do not
 *  stack — the set is deduped by id. */
export function effectiveRunes(build, skillId) {
  const set = new Set();
  for (const slot of build.slots) {
    if (slot.skillId !== skillId) continue;
    for (const r of slot.runes) if (r) set.add(r);
  }
  return [...set];
}
```

**Hook order is fixed** and must not vary: `echo → serrate → siphon → ward`.

- `echo` fires once, produces one extra damage instance at 50% power flagged
  `fromRune: true`.
- A `fromRune` damage instance runs **no** rune hooks at all. Without this,
  Echo→Serrate→Echo recursion is possible.
- `serrate` and `siphon` fire per damage instance that actually connected.
- `ward` fires once per skill use, hit or miss.
- `kindle` is read at end of turn (§6.4), not in this chain.
- `keeper` is checked at start of turn (§8.1), not in this chain.

---

## 7. Run and dungeon (`run.js`)

### 7.1 Run lifecycle

```
newRun(seed) -> phase "build"
  choose 3 of 6 skills -> slots filled, runes empty
  -> phase "map"        (floor 1, layer 1)

map:  present ROOM_OFFERS room cards -> player picks one
      battle/elite -> phase "battle"
      treasure     -> phase "loot"
      craft        -> phase "event"
      rest         -> apply, advance
advance():
  layer += 1
  if layer > LAYERS_PER_FLOOR: floor += 1, layer = 1, tick "floor" clocks
  if floor > FLOORS: phase "won"
  else phase "map"
```

Player HP, statuses on `battles`/`permanent` clocks, brave (reset to 0),
soulstones, risk and Savage all persist across rooms. HP does **not**
auto-restore between battles — that is what `rest` and `draught` are for.

### 7.2 Risk and Savage mode

```
on battle cleared:  risk += 8 + 3 * (floor - 1) + 10 * elitesKilledThisBattle
on rest room:       risk = max(0, risk - 25)
if (!savage && risk > SAVAGE_THRESHOLD) savage = true   // latches for the rest of the run
```

Savage effects — all four, all visible:

1. `MAX_ENEMIES` 3 → 4.
2. `elite` room weight doubled (12 → 24).
3. Loot rarity table shifts and **rarity 6 becomes reachable** (§9.2). Rarity 6
   is otherwise impossible — this is the incentive.
4. Soulstone yields ×1.5 (rounded down); monster stat scale ×1.15.

The view must announce the transition with a full-width banner. It is the run's
biggest single moment.

### 7.3 Encounter generation

```
count  = clamp(1 + floor(floor / 2), 1, savage ? 4 : 3)
scale  = (1 + 0.35 * (floor - 1)) * (savage ? 1.15 : 1)
```
Scale multiplies `hp`, `atk`, `def` only — never `hit`, `eva` or `resist`.
Draw monsters weighted so `tier <= 1 + floor(floor/2)`; elite rooms force one
elite. Elites get `hp ×1.5` on top of `scale` and always act first.

### 7.4 Soulstones

```
perKill  = (4 + 3 * tier) * (elite ? 2 : 1) * (savage ? 1.5 : 1)   // floor()
boss     = 60
```
Awarded at **battle end**, not per kill, so a wipe forfeits them — the source's
"lost at the end of the adventure" tension, at battle scale. All soulstones are
discarded when the run ends, win or lose. Show this in the run summary.

---

## 8. Combat (`combat.js`)

### 8.1 Turn structure — implement exactly this order

```
startPlayerTurn(state):
  1. auto-activate pass: for each slot, if effectiveRunes(build, slot.skillId)
     includes "keeper" and !keeperUsedThisBattle and player.hp < 30% maxHp:
       fire that skill for free (no charge spent, does not end the turn),
       set keeperUsedThisBattle = true, emit "autoSkill".
  2. if player has `stone`: emit "skipTurn", tick statuses, go to enemyPhase.
  3. compute burstActive = (player.brave === BRAVE_MAX)
  4. WAIT for input (the reducer returns; the view enables the skill bar)

resolveSkill(state, actor, skill, targets):
  5. if skill.charges != null: require charges[skill.id] > 0, decrement
  6. variant = burstActive ? skill.burst : skill
  7. for each target: hit roll (§6.1) -> damage (§6.2) -> statuses (§6.3)
  8. self effects (heal, self-damage, self statuses)
  9. rune hooks in fixed order (§6.5)
 10. decrement every `actions`-clock status on the actor by 1
 11. if burstActive: actor.brave = 0
 12. for each target that died: emit "death", actor.brave += 1 (unless drained),
     accumulate soulstones
 13. if !variant.endsTurn: return to step 3 (recompute burstActive; no brave
     gain, no status tick)

endPlayerTurn(state):
 14. brave gain (§6.4)
 15. status tick on the player: bleed/poison damage, decrement `turns` clocks
 16. if player.hp <= 0 -> "dead"

enemyPhase(state):
 17. for each living monster, elites first then by index (deterministic order):
       if `stone`: skip and tick
       burstActive = brave === BRAVE_MAX
       pick a skill: burst-state monsters always use their most damaging skill;
         otherwise rng.weighted over the monster's skill list
       resolve vs the player (steps 5–12, no runes — monsters have none)
       brave gain, status tick on that monster
       if player.hp <= 0 -> "dead", stop immediately
 18. if all monsters dead -> "cleared"
 19. else -> startPlayerTurn
```

### 8.2 Battle end

On `cleared`: award accumulated soulstones, apply risk (§7.2), decrement
`battles`-clock statuses by 1, **clear all `turns` and `actions` statuses**,
reset brave to 0, reset all charges, roll loot (§9.2) for elite/boss rooms.

On `dead`: offer the revive (§9.4) if `!revivedOnce`, else `phase = "dead"`.

### 8.3 Targeting

Single-target skills default to the **lowest-HP living monster**; the player may
override by tapping a monster card. Multi-target hits all living monsters. There
are no summoners in the slice, so there is no target-locking rule — if summoners
are added later, that rule (minions must die before the summoner is targetable)
goes here.

### 8.4 Events

Every reducer returns an ordered `events` array. The view consumes it as an
animation queue. Event types — implement all of them, nothing else:

`turnStart`, `skillUsed` (`{actorUid, skillId, burst}`), `miss`, `damage`
(`{targetUid, amount, crit:false, fromRune}`), `heal`, `statusApplied`,
`statusExpired`, `statusTick`, `death`, `braveChanged`, `autoSkill`, `phase`,
`cleared`, `defeated`, `soulstones`, `loot`, `savage`, `riskChanged`.

---

## 9. Economy, loot, events

### 9.1 Loot sources

Elite kills, boss kill, and `treasure` rooms each roll once on the loot table.
Ordinary battles drop soulstones only.

### 9.2 Loot roll

```
kind:   50% equipment, 30% rune, 20% skill
rarity: normal  d100 -> 1:≤40  2:≤70  3:≤88  4:≤96  5:≤100
        savage  d100 -> 1:≤20  2:≤45  3:≤68  4:≤85  5:≤96  6:≤100
```
Rarity 6 is unreachable outside Savage — enforce it in code, not by table luck.

- **equipment** → generate per §5.7; the view offers equip-or-discard.
- **rune** → goes to `inventoryRunes`; the view offers immediate socketing.
- **skill** → drawn from all 8 including `vigil` and `toll`; the view offers
  replacing one of the 3 slots (**keeping the slot's runes** — that is how a
  player intentionally builds toward rune linking) or discarding.

### 9.3 The craft room (soulstone sink)

Menu of four options, prices scaling `× (1 + 0.25 × (floor − 1))`, rounded:

| option | base cost | effect |
|---|---|---|
| Mend | 25 | heal 40% maxHp |
| Etch | 40 | gain a random rune (rarity roll per §9.2) |
| Reforge | 30 | reroll one equipped item at the same rarity |
| Duplicate | 70 | **copy one skill you already hold into another slot** — the deliberate on-ramp to rune linking |

Leave the room at any time; unspent soulstones carry to the next room.

### 9.4 Revive (slice-local adaptation)

Once per run, on death: pay `max(80, all current soulstones)` to revive at 50%
maxHp with all `turns` statuses cleared, in the same battle. If the player
cannot pay, the option is shown disabled with the price. Mark this in the code
comment as a slice-local adaptation of the source's Continue — it is not a
faithful reproduction of that screen.

### 9.5 Persistence

Exactly one key, `gravebound-best`, holding
`{deepestFloor, bossKills, bestSoulstones, runs}`. Wrap every read in
`try/catch` (private-mode Safari throws) and treat a parse failure as "no
record". No other persistence — no mid-run saves.

---

## 10. Screens

Six screens, all inside one container, switched by `data-gb-screen`.

| screen | shows | key controls |
|---|---|---|
| `title` | Name, best record, Begin, Back to Fantasia | `[data-gb="begin"]`, `[data-gb="menu"]` |
| `build` | 6 skill cards, pick 3 | `[data-gb="pick"][data-skill=…]`, `[data-gb="confirm"]` |
| `map` | Floor/layer, risk meter, soulstones, 2 room cards | `[data-gb="room"][data-index="0\|1"]` |
| `battle` | Enemy row, player panel, brave pips, status chips, 3-slot skill bar, log | `[data-gb="skill"][data-slot=…]`, `[data-gb="target"][data-uid=…]` |
| `loot` / `event` | The offer or the craft menu | `[data-gb="take"]`, `[data-gb="skip"]`, `[data-gb="buy"][data-option=…]` |
| `summary` | Won/died, floor reached, kills, soulstones **forfeited**, build recap, new-record flag | `[data-gb="again"]`, `[data-gb="menu"]` |

### 10.1 Battle screen layout (mobile-first, single column)

```
┌──────────────────────────────────────┐
│ Floor 3-2   Risk 64%   ◈ 118        │  header, always visible
├──────────────────────────────────────┤
│  [Bone Sergeant  ▮▮▮▮▮░░  ● ● ○ ]    │  enemy cards: HP bar, brave pips,
│  [Rotfly Swarm   ▮▮░░░░░  ● ○ ○ ]    │  status chips; tap = target
├──────────────────────────────────────┤
│  REVENANT  ▮▮▮▮▮▮▮░░  84/120         │
│  BRAVE ● ● ●        ⚑ BURST          │  burst state changes the whole bar
│  [bleed 2] [rage 3]                  │
├──────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐     │  skill bar: 3 slots. In burst state,
│ │ Cleave │ │  Rend  │ │ Toll of│     │  each card shows its BURST name,
│ │ ALL 0.8│ │ 1.0 ☠5 │ │ Silence│     │  description, and numbers.
│ │ ◆serrate│ │◆echo   │ │  2.4   │     │  rune pips under each card
│ └────────┘ └────────┘ └────────┘     │
├──────────────────────────────────────┤
│ log: Cleave hits Bone Sergeant for 23│  last 4 lines, scrollable
└──────────────────────────────────────┘
```

Burst state must be **impossible to miss**: the skill bar gets a distinct
border/glow, the brave pips fill, and the cards re-title. A player who bursts
without realising it is a design failure.

### 10.2 View contract

- `view.render(state)` is a **pure function of state** for the static layout.
- `view.play(events)` drains the animation queue and resolves a promise when
  done; input is disabled while it drains.
- Every interactive element is a real `<button>` with an accessible label.
- No animation may exceed 400ms. Provide a "fast" toggle that sets all durations
  to 0 and persists in the same localStorage record.
- Respect `prefers-reduced-motion`: skip transitions, keep the log.

### 10.3 Teardown (`main.js`)

`boot(container)` returns `{ destroy() }`. `destroy()` must:

1. Cancel every pending timer/RAF (keep them in one array).
2. Remove every listener (use one `AbortController` and pass its `signal` to
   every `addEventListener`).
3. Remove the injected `<style>` element and empty `container`.
4. Null out module-level state so a re-launch starts clean.

Verify by launching → returning to the menu → launching again, five times, and
asserting no growth in `document.querySelectorAll("style").length`.

---

## 11. Styling (`styles.js`)

One exported template-literal string, injected as a single `<style
data-gb-style>` element. All selectors scoped under `.gb-root`. Palette
*(suggestion)*: near-black ground `#0d0b0f`, bone `#d9d2c4`, dried blood
`#8c2f2f`, brave-flame cyan `#4fd6e0`, savage amber `#e0912f`. Typography:
system stack, but the same decorative face the Fantasia menu uses for headings.
No images, no webfonts.

---

## 12. Milestones

Each milestone ends with a commit that leaves the site working. Per this repo's
`CLAUDE.md`, **commit and push to `main`** — a feature branch never deploys.

| # | Deliverable | Done when |
|---|---|---|
| **M0** | `src/gravebound.js`, `main.js` stub rendering a title screen; `index.html` wiring | Menu button launches it, "Back" returns to the menu, five launch/teardown cycles leak nothing |
| **M1** | `rng.js`, `content.js`, `rules.js`, `combat.js`, `run.js`, `sim.js`, `tools/gravebound-sim.mjs` | `node tools/gravebound-sim.mjs --runs 1000` completes with no exception and prints win-rate, average floor, average battle length |
| **M2** | Battle screen: enemy cards, player panel, skill bar, log, targeting | A floor-1 fight is winnable and losable by hand with no console errors |
| **M3** | Brave, burst state, burst variants, `toll`'s replacement burst, enemy brave | Brave reaches 3 in ≤3 turns; every skill card re-titles; a burst spends all 3 |
| **M4** | Skills, runes, sockets, **rune linking**, loot rolls, equipment | The rune-linking test (§13.2) passes; a run can reach two copies of one skill via Duplicate |
| **M5** | Map screen, 5 room types, craft room, treasure, rest, floor advance | A full 5-floor descent is playable |
| **M6** | Risk meter, Savage transition, boss + phase change, run summary, `localStorage` | Risk crosses 100 in a normal route; the boss dies; the summary records a best run |
| **M7** | Balance pass against §14, mobile layout, reduced-motion, fast toggle, final verification | §15 checklist fully green |

Do not start M2 before M1's simulator runs. Building the UI first against
unproven rules is the main way this plan goes wrong.

---

## 13. Testing

### 13.1 Headless simulator (`sim.js`)

Exposes `simulate({seed, policy})` returning
`{won, floor, turns, battles, kills, damageDealt, damageTaken, savageAt, cause}`.
Ship one scripted policy: *use `draught` below 35% HP; else `bulwark` if
unguarded and facing ≥2 enemies; else the highest-expected-damage skill;
prefer the lowest-HP target.* On the map: prefer `rest` under 50% HP, else
`treasure`, else `battle`. Buy `Mend` if affordable and under 60% HP.

`tools/gravebound-sim.mjs --runs N [--seed S]` prints win rate, mean/median
floor reached, mean battle length in turns, savage-onset floor histogram, and
the death-cause breakdown.

### 13.2 Unit tests (in `sim.js`, run by the same tool with `--test`)

Assert at minimum:

1. `effectiveRunes` returns the deduped **union** across duplicate slots, and
   two slots holding the same skill both see all four runes.
2. Two copies of the same rune id in different slots do **not** double its effect.
3. `echo`'s extra instance triggers no rune hooks (no infinite recursion; assert
   a bounded event count).
4. Damage is ≥1 against arbitrarily high DEF.
5. A `battles`-clock status survives a battle end; a `turns`-clock one does not.
6. `rage` decrements on skill use, not on turn end; `vigil` (non-turn-ending)
   consumes exactly one `actions` tick and grants no brave.
7. Brave: 3 turns to burst; burst zeroes brave before the end-of-turn gain, so
   the player is at 1 after bursting.
8. Rarity 6 never rolls when `savage === false`, over 10,000 rolls.
9. The same seed produces byte-identical run transcripts.
10. `vigil` cannot be used twice in one battle.

### 13.3 Browser verification (Playwright)

Per `CLAUDE.md`: serve with `python3 -m http.server`, drive Chromium at
`/opt/pw-browsers/chromium`, do **not** run `playwright install`. Because the UI
is DOM, click by selector — this game does **not** have the canvas-coordinate
problem the Phaser games have.

```js
await page.click("#btn-gravebound");
await page.click('[data-gb="begin"]');
await page.click('[data-gb="pick"][data-skill="cleave"]');  // ...x3
await page.click('[data-gb="confirm"]');
await page.click('[data-gb="room"][data-index="0"]');
await page.click('[data-gb="skill"][data-slot="0"]');
```
Also expose `window.graveboundGame.game.state` (read-only) for assertions, the
way `gloom3DGame.game` exposes the scene.

Screenshot at 390×844 and 1280×800; check no horizontal scroll on either.

### 13.4 Gates before any push

```bash
node --check src/gravebound.js
node tools/gravebound-sim.mjs --test
node tools/gravebound-sim.mjs --runs 1000
grep -rn "Math\.random" src/gravebound/ | grep -v "rng.js"   # must be empty
grep -rn "document\.\|window\.\|localStorage" src/gravebound/{rules,combat,run,content,rng}.js  # must be empty
```

---

## 14. Balance targets

Tune the numbers in §5 until the simulator reports all of these. **Do not**
change the formulas in §6 to hit them.

| metric | target |
|---|---|
| Scripted-policy win rate | 15–35% |
| Mean floor reached | 3.2–4.0 |
| Mean player turns per battle | 4–7 |
| Battles per full run | 12–16 |
| Savage onset | floor 3–4 on a typical route; before the boss in ≥70% of runs |
| Human run length | 12–20 minutes |
| Deaths on floor 1 | <5% |
| Boss kills that use at least one burst | ~100% (i.e. burst is not optional) |

Free to retune: all monster stats, skill `power`/`charges`, room weights, risk
increments, soulstone yields, craft prices.
**Not** free to retune without re-reading this plan: `BRAVE_MAX`, the burst-spends-all
rule, the defence formula, the minimum-1-damage floor, rune hook order,
rarity-6-is-Savage-only.

---

## 15. Definition of done

- [ ] Menu → run → 5 floors → boss → win/die → summary → run again, no console errors
- [ ] Return to menu at any point tears down cleanly; relaunch works (×5, no leaks)
- [ ] Rune linking works and is covered by tests §13.2 (1)(2)
- [ ] Risk crosses 100 in a normal run; Savage visibly changes encounters and loot
- [ ] 1,000 seeded runs, zero exceptions; win rate inside 15–35%
- [ ] Playable at 390×844 and 1280×800; no horizontal scroll; keyboard-operable
- [ ] `prefers-reduced-motion` respected; fast-animation toggle persists
- [ ] All §13.4 gates clean
- [ ] Committed and pushed to `main`; `version.json` `shortCommit` matches
- [ ] `CLAUDE.md` updated: game blurb, file-tree line, launcher name in the
      "Adding a game" list, and the `graveboundGame.destroy()` (no-args) note
      alongside `gloom3DGame`

---

## 16. First post-slice additions, in order

1. Summoner monsters and the target-locking rule (minions before summoner).
2. Skill slots 3 → 5 and rune sockets 2 → 5, matching the source.
3. A second dungeon and a second job.
4. Meta-progression: a between-run currency that survives, and dungeon unlocks.
5. Crafting recipes as a collectible system.
