# Gravebound — Executive Summary

**A vertical slice of a Buriedbornes2-style dungeon RPG, built for Fantasia.**

Source material: the official [Buriedbornes2 Help](https://sites.google.com/view/bb2-help-en/)
site (Nussygame). Status: proposal / design doc. Companion document:
[`implementation-plan.md`](./implementation-plan.md).

---

## 1. What the source game is

Buriedbornes2 is a turn-based, single-character dungeon-crawling roguelite set
in **Versiegelt**, a post-apocalyptic dark-fantasy world overrun by corpses. You
animate a corpse, send it into a dungeon, and it either conquers the dungeon
boss or dies — either way the run ends, you bank rewards, and you go again.

The help site documents the game as five subsystems:

| Area | What the site says |
|---|---|
| **How to play** | A repeating cycle: prepare → pick a dungeon → build a corpse (race / job / origin) → descend → beat the boss or die → collect rewards → repeat. |
| **World map** | Dungeon select, Continue, Sanctuary (high-difficulty, monthly reset, 5 attempts/day), Battlefield PvP (level-synced opponents; the game's hardest content), Unions. |
| **Adventure** | Dungeons are a few dozen floors; each floor is several *layers* of rooms; each room holds enemies or an event. You choose between **two** room options each step. The target floor's innermost room holds the boss. Dungeon events include encounters, treasure and **crafting** (pay soulstones, apply a recipe you own). |
| **Combat** | Pick one of up to **5 skills** per turn. **Brave** caps at 3; at max, every skill flips into an enhanced **Burst** form — sometimes a straight upgrade (longer Guard, more accurate Whirlwind), sometimes an entirely different skill. Statuses expire on varied clocks: turns, *number of actions taken*, battles, room moves, floor moves. Summoners can't be targeted until their minions are dead. **Risk** climbs as you fight strong enemies back to back; past 100% the run enters **Savage mode** — more enemies, more elites, and the only place rarity 6+ loot drops. |
| **Build** | Up to 5 skills, up to 5 **runes** per skill. **Rune linking** is the signature idea: hold several copies of the same skill and *all* copies inherit *all* of their runes' effects. Some runes make a skill auto-use / auto-activate on a condition. **Soulstones** are earned from kills (elites pay much more), spent during the run, and **lost when the run ends**. |

Two things make it distinctive, and both are cheap to reproduce: **rune linking**
(a build puzzle, not a stat stick) and the **risk/reward ratchet** (Risk →
Savage mode is the game asking you to volunteer for danger to see the good loot).

## 2. What the vertical slice is

**Gravebound**: one complete run, start to finish, in the browser — a new
Fantasia game reachable from the menu, no accounts, no server, no external art.

The slice is *vertical*, not horizontal: it goes all the way through the loop
(menu → build → descend → fight → loot → boss → death/victory → summary → again)
with a deliberately thin content layer, rather than building a broad content
library on top of a half-finished loop.

**In scope**

- **One dungeon** — *The Highway*, 5 floors × 3 room-layers, boss in the last room.
- **One job** — the Revenant, with a 3-of-6 opening skill pick, so the very
  first decision is already a build decision.
- **Full combat turn**: one hero vs. 1–4 monsters, pick-a-skill turns,
  hit/damage/mitigation, non-turn-ending skills, death.
- **Brave & Burst** at full fidelity — 3 points, whole-bar burst state, burst
  variants that can replace a skill outright, enemy brave-drain.
- **Skills + runes with rune linking** — 3 skill slots, 2 rune sockets each,
  8 skills, 6 runes, including one auto-activate rune.
- **Statuses on four different clocks** (turns / actions / battles / permanent),
  because the varied expiry is a real texture of the source, not a detail.
- **Risk → Savage mode**, with the loot-rarity and encounter-size consequences.
- **Soulstones**: earned per kill, spent in-run at crafting and shrine rooms,
  lost at the end. One soulstone-priced revive.
- **Room choice**: two face-down-ish options per layer, typed (battle, elite,
  treasure, craft, rest).
- **Run summary + a single persisted best-run record** in `localStorage`.

**Explicitly out of scope** (and why)

| Cut | Reason |
|---|---|
| Races and origins; jobs beyond one | Multiplies content without testing any new mechanic. |
| Meta-progression between runs, unlockable dungeons | The slice proves the *run*; the meta layer is the next slice. |
| PvP / Battlefield, Unions, Sanctuary, monthly resets | Require a backend and an audience. |
| Crafting *recipes* as a collectible system | Kept as a single in-run soulstone sink; the recipe economy is horizontal content. |
| Equipment depth (sets, affixes, rarity 6+ tables) | Two slots with flat modifiers is enough to prove the loot loop. |
| Cloud saves, achievements, memory/codex | Pure metagame. |
| Summoner enemies | The targeting rule is one of the more invasive combat changes; noted as the first post-slice combat addition. |

## 3. Why this shape

- **The loop is the product.** Buriedbornes' appeal is a fast, legible risk
  decision repeated hundreds of times. A slice that ships one full loop is
  playable and judgeable; a slice that ships 40 skills and no boss is neither.
- **Rune linking earns its place early.** It is the one system that changes how
  you read every loot drop. Deferring it would make the slice feel like a
  generic turn-based crawler.
- **It fits Fantasia's constraints as-is.** Self-contained, static, offline,
  no external assets. Unlike the arcade games in this repo, it is a
  text-and-cards UI, so it is built as a **DOM/CSS overlay** rather than a
  Phaser canvas — following the precedent already set by Gloom Hollow 3D's DOM
  HUD, and gaining crisp text, real buttons, accessibility, and selector-driven
  headless testing for free.
- **A pure rules core makes it testable.** All game rules live in
  side-effect-free modules driven by a seeded RNG, so an entire run can be
  simulated headlessly in milliseconds — which is how the balance gets tuned
  and how regressions get caught without clicking through a dungeon.

## 4. Shape of the work

Seven milestones, each independently demonstrable:

| # | Milestone | Demonstrates |
|---|---|---|
| M0 | Skeleton, menu wiring, teardown | Launches and returns to menu cleanly |
| M1 | Rules core + seeded RNG + headless run simulator | A full run resolves in a test harness |
| M2 | Combat screen | A fight is playable end to end |
| M3 | Brave / Burst | The signature turn decision works |
| M4 | Skills, runes, rune linking, loot | Builds diverge run to run |
| M5 | Dungeon map, room types, events, soulstones | The full descent |
| M6 | Risk → Savage, boss, run summary, persistence | The complete loop |
| M7 | Polish, balance pass, mobile layout, verification | Shippable |

Rough size: **~2,500–3,500 lines** across a launcher, four core modules, a
content data file, a view layer and an injected stylesheet — comparable to the
larger existing games in this repo (`gloom-hollow-3d.js`, `bark-quest.js`).

## 5. Risks

| Risk | Mitigation |
|---|---|
| **Balance is invisible without play.** A hand-tuned RPG economy usually reveals itself only after hundreds of runs. | The headless simulator (M1) runs thousands of seeded runs with a scripted policy and reports win-rate by floor; balance targets are stated as numbers in the plan, not vibes. |
| **Scope creep through content.** RPG content is fun to write and each new skill feels free. | Content lives in one data file with hard counts in the plan (8 skills / 6 runes / 8 monsters). Adding an item is a data edit *after* the slice ships, not during it. |
| **Rune linking is easy to get subtly wrong** (duplicate application, ordering). | Specified as a single pure function with its own unit tests and an explicit dedup rule. |
| **Text-heavy UI on a phone.** | Mobile-first single-column layout; card lists, not tables; verified at 390×844 as part of M7. |
| **IP.** Mechanics are not copyrightable, but names, art, and flavour text are. | Original name, original skill/monster/status names, original flavour, zero imported assets. The help site is a design reference only. |

## 6. Definition of done

The slice is done when all of the following are true:

1. From the Fantasia menu, a player can start a run, descend five floors, fight
   the boss, win or die, see a summary, and start another run — with no console
   errors and no way to soft-lock.
2. Returning to the menu mid-run tears the game down completely (no stray
   listeners, timers, or DOM), and the menu is reusable.
3. Rune linking demonstrably works: two copies of one skill sharing four rune
   effects, verified by a test.
4. Risk crosses 100% in a normal-length run and Savage mode visibly changes
   encounters and loot.
5. 1,000 headless seeded runs complete without an exception, and the
   scripted-policy win rate lands in the 15–35% band stated in the plan.
6. Playable at 390×844 and at desktop width; keyboard-operable.
7. `node --check` clean; deployed to `main` and live on Pages.

---

*Sources: the Buriedbornes2 Help site — [How to play](https://sites.google.com/view/bb2-help-en/how-to-play),
[Play guide](https://sites.google.com/view/bb2-help-en/adventure/play-guide),
["Risk" and Savage mode](https://sites.google.com/view/bb2-help-en/adventure/combat/risk-and-savage-mode),
[Status (temporary and permanent)](https://sites.google.com/view/bb2-help-en/adventure/combat/using-skills/status-temporary-and-permanent),
[Auto-use / Auto-activate](https://sites.google.com/view/bb2-help-en/adventure/combat/using-skills/auto-use-auto-activate),
[Summoning](https://sites.google.com/view/bb2-help-en/adventure/combat/summoning),
[Crafting](https://sites.google.com/view/bb2-help-en/adventure/dungeon-events/crafting),
[Dungeon boss](https://sites.google.com/view/bb2-help-en/adventure/dungeon-events/encounter/dungeon-boss),
[Sanctuary](https://sites.google.com/view/bb2-help-en/world-map/select-dungeon/sanctuary),
[Battlefield (PvP)](https://sites.google.com/view/bb2-help-en/world-map/select-dungeon/battlefield-pvp).*
