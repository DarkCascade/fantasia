# PRD: Daily Party Builder (working title: *Party Line*)

| | |
|---|---|
| **Status** | Parked: deeper follow-up to Daily Dungeon (`PRD-daily-dungeon.md`), which is being built first |
| **Owner** | Fantasia project |
| **Target** | New game on the Fantasia menu (`src/party-builder.js`) |
| **Platforms** | Phone-first (portrait), desktop and tablet second |
| **Last updated** | 2026-11-13 |

---

## 1. Summary

Party Line is a once-a-day puzzle. Every day at **00:00 UTC** the game publishes
the same fixed set of content: one boss, a draft pool of eight heroes, four
relics, and two daily mutators. Every player faces the same math problem.

The game is a **deterministic optimization engine**, not an RPG. There is no
randomness in combat, no grinding, and no progression. The player drafts a team,
orders it into a four-slot line, and presses **Fight**. The result is fully
determined by the lineup, and the only questions are *can I win*, *how few
turns can I win in*, and *how few party slots can I win with*.

The hook is the optimization itself. Victory is the entry fee. Par, the emoji
share grid, and the 3-tier scoring turn each day's solution into something
players want to compare and improve.

## 2. Problem and goals

**Problem.** Most daily puzzle games are either pure guessing (Wordle-style
luck) or idle-friendly RPGs with no moment-to-moment decisions. A puzzle where
the same seed produces the same answer for everyone, and where "better" is
measurable, is rare in this space.

**Goals**

1. Every daily puzzle is solvable, has a verified best solution, and has
   meaningful choices. Nothing is a coin flip.
2. A winning player can explain *why* their lineup worked in one sentence
   ("the Striker acts right after the Weaver, so the Mana Pulse lands on it").
3. Scoring rewards efficiency in two independent ways: fewest turns and fewest
   party slots.
4. A solved day takes 3–5 minutes of planning, and optimizing it can take
   longer. Players return to beat their own par.
5. Results share cleanly as a spoiler-free emoji grid.

**Non-goals (v1)**

- Random combat outcomes, crit rolls, dodge rolls, or any other RNG during a fight.
- Persistent character progression, levels, gear, gacha, or currency.
- Real-time multiplayer or live PvP.
- Accounts, backend services, or cross-device sync. (Scores live in
  `localStorage` and in the shared share string.)
- A global leaderboard. This is listed as a later option in section 14.
- Monetization of any kind.

## 3. Target players

- **The optimizer.** Enjoys puzzles like Factorio-style scheduling or Slay the
  Spire card sequencing. Wants the Gold tier and the lowest slot count.
- **The casual solver.** Plays for 5 minutes each morning. Wants a clean Silver
  and a share grid to post.
- **The turn-order theorist.** Interested mainly in the Mana Pulse and speed
  interactions. Will read the preview timeline closely.

## 4. Core loop

```
Midnight UTC: new daily seed (boss, pool, relics, mutators)
  └─► Read boss script + mutators
        └─► Draft (up to 4 heroes, up to 2 relics)     ┐
              └─► Position heroes into the 4-slot line  │ Planning Phase
                    └─► Scrub the Preview Timeline ◄────┘ (3–5 min typical)
                          └─► Fight: deterministic auto-resolution
                                ├─► Win → Bronze / Silver / Gold + share grid
                                └─► Lose → review the timeline, adjust, retry
```

Retries are unlimited within the day. Because the engine is deterministic, the
preview is not an estimate. It is the same simulation that runs in the fight.
"Fight" plays back a result the player has already seen, so the outcome is never
a surprise.

## 5. Combat engine

### 5.1 Combatants and turns

- The party is **four heroes** in a fixed line of slots: **1 Front, 2 Mid-Front,
  3 Mid-Back, 4 Back**.
- The enemy is **one boss**. It has a single HP pool.
- A **turn** is one full pass of the timeline. Every living combatant acts once,
  in speed order. Turn numbers start at 1.
- Speed is an integer from **1 to 10** for heroes. The boss has a fixed speed
  defined in its data.
- **Ties go to heroes.** When a hero and the boss share a speed value, the hero
  acts first. Ties between heroes are broken by slot order (Front first).
- The **timeline** is recomputed at the start of each turn from current living
  speeds, so Weaver speed changes apply to the following turn's order. (See
  open question O-3 for mid-turn changes.)

### 5.2 Actions

Each hero has:

- a **basic action**, which always fires on that hero's turn, and
- an **Overdrive** ability, which fires only when the Mana Pulse triggers
  (section 5.3).

The boss does not act from a menu. It follows its scripted loop (section 7).

### 5.3 The Mana Pulse

- The party shares one **Mana Bar** from 0 to 4.
- Each time a **hero** takes an action, the bar fills by 1. Boss actions do not
  fill it.
- When the action that brings the bar to 4 resolves, the bar is set to 0 and
  the **next living hero** in the timeline triggers **Overdrive alongside their
  basic action**. This is the same turn's timeline, so the Overdrive hero is
  the hero who acts immediately after the pulse-filling action.
- Because the pulse is shared, speed tuning decides who catches it. Putting a
  high-value Overdrive hero directly behind a fast action is the central
  puzzle.
- If no living hero comes next in the turn, the pulse rolls into the next turn
  and waits. It is never lost.

### 5.4 Positional targeting

- Attacks name a **target set** of fixed slots: `Front`, `Mid-Front`, `Mid-Back`,
  `Back`, `All`, `Lowest HP`, or a named combination such as `Front + Mid-Front`.
- Boss skills target the party's slots. Example: *Heavy Strike [Front]*.
- **Death shifts the line.** When a hero dies, every surviving hero behind them
  moves forward one slot, preserving order. A slot is never left empty
  in the middle of the line. The shift happens immediately, before the next
  actor in the timeline resolves.
- Hero abilities with slot requirements such as *Cleave (Front + Mid-Front)* or
  *Snipe (Back)* are gated by the user's slot. See open question O-1 for the
  boss-side interpretation.

### 5.5 Archetypes

Each archetype has a distinct job. Heroes in the roster are instances of these
archetypes with their own stats and abilities.

| Archetype | Role | Speed | HP | Mechanical identity |
|---|---|---|---|---|
| **Vanguard** | Tank / Disruptor | Low | High | **Guard**: absorbs damage aimed at an adjacent ally. **Taunt**: forces single-target boss skills onto its current slot. |
| **Arcanist** | Combo / AoE | Medium | Low | Low base damage. Applies tags (**Soaked**, **Brittle**) that multiply the next hit on the target. Can also manipulate the Mana Bar. |
| **Striker** | Executioner | High | Medium | Burst single-target. Bonus damage on conditions: target is debuffed, acted immediately after an ally, or the turn number is odd. |
| **Weaver** | Tactician / Support | Variable | Medium | Swaps ally slots mid-turn, edits ally Speed to change who catches the pulse, or reflects boss statuses. **No large heals**. |

Design rule: no archetype can heal enough to erase a mistake. Recovery comes
from positioning, speed, and the pulse, not from HP buckets.

### 5.6 Win and loss

- **Win:** the boss reaches 0 HP.
- **Loss:** all four heroes are dead, or turn 10 ends with the boss alive.

### 5.7 Determinism

- No randomness in combat, targeting, or ordering. Ties are resolved by the
  rules above, never by a roll.
- Relics and mutators are applied as fixed modifiers before turn 1.
- The engine is a **pure function** of `(seed content, lineup, relics,
  positions)`. The same input always yields the same event log, byte for byte.
  This is the property that makes the preview honest and the share grid
  verifiable.

## 6. Daily draft

Generated from the **daily seed** at 00:00 UTC.

| Element | Count | Player choice |
|---|---|---|
| Boss | 1 | None (fixed for the day) |
| Hero pool | 8, drawn from a master roster of 20+ | Pick up to 4 |
| Relics | 4 | Pick up to 2 |
| Mutators | 2 | None (applied to everyone) |

- A **lineup** is up to 4 heroes plus up to 2 relics, each hero placed in a slot.
  Fewer than 4 heroes is legal and is the basis of the Gold tier.
- The **candidate space** is small enough to search exhaustively. Choosing 4 of
  8 heroes, ordering them across 4 slots, and selecting up to 2 of 4 relics gives
  roughly **18,000** lineups. The generator uses this to verify each day (section 10).
- Relics are passive modifiers, such as "+2 Speed to the Back slot."
  Their effects are part of the fixed seed content.

### 6.1 Draft pool generation

- The seed is derived from the UTC date (e.g., `YYYY-MM-DD`) with a standard
  string hash. A seeded PRNG chooses the pool from the content tables.
- The generator runs **at build time or at first load** in the same way for
  every client. Because the same code and the same date produce the same output,
  no server is required.
- The generator must produce the same day's content for every player. Any
  change to the content tables or to the generator is a **content version
  bump**, and it changes all subsequent daily seeds. This is documented in
  section 12.

## 7. Boss scripting

- Each boss has a **visible, looping 4-turn script**, shown at the top of the
  screen at all times. Example:

  ```
  Turn 1: Heavy Strike [Front]
  Turn 2: Poison Cloud [All]
  Turn 3: Devour [Lowest HP]
  Turn 4: Enrage [+50% Attack]
  ```

- Turn *n* uses script step `((n − 1) mod 4) + 1`. The script is known in full
  before the player commits.
- Script steps are data, not AI. A boss never reads the board to decide what
  to do.
- **Preview Timeline.** The player can scrub a turn slider from 1 to the final
  turn, and see every action, target, damage number, overdrive trigger, death,
  and slot shift for the currently planned lineup. Scrubbing uses the same
  engine as the fight.

## 8. Daily mutators (Realm Shift)

Two global rules apply to every player each day. They exist to break
standard strategies.

Examples:

- **Blood Magic.** The Mana Pulse triggers every **3** hero actions instead of
  4. The caster of the Overdrive pays **20% of their max HP**. Pulses that would
  kill the caster are not allowed (the Overdrive still fires, but the caster
  drops to 1 HP instead of dying).
- **Mirror March.** Turn order runs **slowest to fastest** instead of fastest to
  slowest. Ties still go to heroes.

Rules for mutators:

- Each mutator changes exactly one rule, so players can reason about its
  interaction with other rules.
- Two mutators may stack. The generator checks that the combination still has
  at least one winning lineup and that it does not collapse to a single
  obvious answer.
- Mutators are displayed in plain language next to the boss script.

## 9. Scoring and sharing

### 9.1 Three-tier par

| Tier | Condition |
|---|---|
| 🥉 **Bronze (Clear)** | Defeat the boss before turn 10. |
| 🥈 **Silver (Par)** | Defeat the boss within the daily **turn par** (e.g., 5 turns) with **zero hero deaths**. |
| 🥇 **Gold (Under-Par)** | Defeat the boss using **only 3 heroes**, *or* in **3 turns or fewer**. |

Par values are set per day by the generator (section 10), not hand-tuned.

### 9.2 Secondary metrics

Every win also records:

- **Turns taken.**
- **Party slots used** (number of heroes fielded, 1–4). This is the second
  optimization axis.
- **Per-turn survive / faint states** for each slot.

Personal bests are kept per metric: fewest turns, fewest slots, and highest
tier reached. Metrics are never collapsed into one number in the UI.

### 9.3 Emoji grid

On victory the player can copy a **spoiler-free** summary to the clipboard.

Format:

```
PARTY LINE 2026-11-13 🥇
⚔️ Turn 1 | 🛡️🧙‍♂️🏹💀
⚔️ Turn 2 | 🛡️🧙‍♂️🏹🗡️
⚔️ Turn 3 | 🧙‍♂️🏹
⚔️ Turn 4 | 🛡️🧙‍♂️🏹💀
Turns: 4 · Slots: 3/4
```

- One row per turn. Each hero glyph appears in its current slot order.
  A hero glyph shows **alive**. A 💀 shows that a slot has fainted in that turn.
  The example above uses hero glyphs as stand-ins; the exact glyph set is
  defined in the content tables and the emoji set must be spoiler-free
  (no boss name, no relic names, no mutator names).
- Include the day's date, tier emoji, turns, and slots used.
- Never include the boss name, relic names, or mutator names in the grid.
  Those are the parts a late player should be able to find out for themselves.

## 10. Content generation and verification

Each daily seed must pass **automatic verification** before it ships.

1. **Solvability.** The generator runs the engine over the full lineup space
   (about 18,000 candidates) and finds the optimal lineup for each metric:
   fewest turns, fewest slots, and highest tier.
2. **Solution diversity.** There must be at least two distinct winning lineups,
   so one hero is not the only answer.
3. **Non-trivial.** The optimum must not be reachable by simply taking the
   highest-HP team (a baseline bot check).
4. **Mutator sanity.** Each mutator must change the best lineup on at least one
   fixed test day. This keeps mutators from being decorative.
5. **Par derivation.** Silver turn par is the optimal turn count plus a small
   slack (proposed: +1 to +2). Gold slot threshold is the optimal 3-hero or
   turn threshold. Par is computed from the solver, not guessed.
6. **Reject and reseed.** A seed that fails any check is regenerated with the
   next counter value (`seed#1`, `seed#2`, …). The accepted counter is logged
   in the daily content record.

The verification runs in the Node test suite, not in the browser, so content
regressions fail in CI before a deploy.

## 11. Player experience

### 11.1 Screens

1. **Title / daily card.** Date, boss name and portrait, tier-best status, and
   a "Play today" button. Shows a countdown to the next seed.
2. **Draft.** The 8-hero pool and 4-relic pool, with a counter ("2/4 heroes,
   1/2 relics"). Tap or drag to pick.
3. **Planning.** The four-slot line, boss script bar at the top, mutator chips
   beneath, and the Preview Timeline scrubber at the bottom. Drag heroes to
   reorder. Tap a hero, then a slot, to move them.
4. **Fight playback.** Plays the already-computed timeline, with a Skip button
   and a speed toggle.
5. **Result.** Tier, turns, slots used, the emoji grid with a Copy button, and
   a Retry button.
6. **Settings / help.** How the Mana Pulse works, a glossary of archetypes,
   and a reset-progress option.

### 11.2 Input

- Touch first. Drag a hero card into a slot. A tap also works as a
  "select, then tap a slot" alternative for small screens.
- Keyboard and mouse supported on desktop. Arrow keys move the selected hero
  between slots. Enter fights.
- All hero and boss information is text or icons with labels. Color is never
  the only signal, to support colour-blind players.

### 11.3 Feel

- Fights are fast. A full timeline plays back in roughly 10–20 seconds unless
  the player skips it.
- Overdrive triggers get a short, distinct beat. The Mana Bar visibly fills and
  flashes on the pulse.
- Honour `prefers-reduced-motion`: disable screen shake and reduce animation to
  simple fades.

## 12. Technical approach

Fits the existing architecture of Fantasia (see `CLAUDE.md`).

- **Files**
  - `src/party-builder.js`: view, HUD, title screen, and the daily card.
    Exposes `window.launchPartyBuilder()` and stores its handle on
    `window.partyBuilderGame`.
  - `src/party-builder/engine.js`: pure simulation (UMD, so Node can `require`
    it). Contains the timeline, Mana Pulse, positional targeting, death shifts,
    mutators, and the event log.
  - `src/party-builder/content.js`: heroes, relics, bosses, mutators, and the
    emoji glyph table. Content version constant.
  - `src/party-builder/seed.js`: date → seed → daily content (pure).
  - `test/party-builder.test.js`: engine and seed tests, run with
    `node --test test/`.
  - `experiments/party-builder-balance/`: the solver and par-calibration sweeps,
    kept out of the deploy copy.
- **Menu integration.** A new menu button on an available page, with the
  click handler calling `launchPartyBuilder()`. A matching teardown line in
  `returnToMenu()`, and the handle on `window.partyBuilderGame` with a
  zero-argument `destroy()`.
- **Rendering.** DOM overlay (`#pb-root` and a `<style id="pb-style">`), like
  Indie Grind and Greenlit. The game is buttons, cards, and text, so a canvas
  adds nothing. Animations use CSS transitions and `requestAnimationFrame`.
- **Persistence (`localStorage` only).**
  - `party-builder-daily-<date>`: the lineup used and the result for each day.
  - `party-builder-best`: personal bests per metric.
  - All reads and writes are wrapped in `try/catch`, and the game works without
    them.
- **Dependencies.** None. No external assets. All art is text, emoji, and CSS.
  This matches the rule that most games generate their own art.
- **Clock.** The UTC date is read once at launch. The countdown uses the same
  clock. A player who keeps the tab open across midnight is prompted to reload
  for the new day.
- **Versioning.** `CONTENT_VERSION` is stored with each saved result. A
  content-version change does not invalidate old results, but it is shown in
  the share grid footer so mismatched comparisons are visible.

## 13. Analytics and success metrics

Measured locally in the first version, and by an opt-in aggregate later if a
backend is ever added.

| Metric | Target (first 30 days) |
|---|---|
| Daily solve rate (any win) | ≥ 60% of players who start a day |
| Silver rate among winners | 25–45% (too high = par too loose; too low = par too tight) |
| Gold rate among winners | 5–15% |
| Median planning time before Fight | 3–5 min |
| Share rate (copied grid / wins) | ≥ 20% |
| Days with a single dominant lineup | 0 (see section 10 diversity check) |

These targets are design hypotheses. They should be adjusted once real play
data exists.

## 14. Roadmap

- **v1:** everything above, single boss, single mutator pair, offline and
  local scoring.
- **v1.1:** weekly "archive" mode where past daily seeds can be replayed
  for practice (not scored against the daily board).
- **v1.2:** optional global leaderboard for turns and slots, using a
  static, versioned JSON of anonymised results if a backend is avoided.
- **v2:** more bosses on a rotating schedule, expanded roster (40+), and
  mutator combinations that unlock as the player finishes days.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Solver finds a single dominant lineup each day | Puzzle becomes "find the answer" | Diversity check in content verification (section 10). |
| Mutators are decorative | Daily variety feels fake | Mutator sanity check on fixed test days. |
| Par set too tight or too loose | Silver/Gold feel unfair or meaningless | Par derived from solver output, then tuned with real play data. |
| Cheating or copying solutions | Share grid loses meaning | Grid is spoiler-free and shows outcome only. Scores are self-reported in v1 and this is accepted. |
| Content changes mid-week reshape old days | Players lose trust | `CONTENT_VERSION` is stamped on each result and shown in the share grid. |
| Players feel punished by unavoidable losses | Churn | Every loss shows the exact failing turn in the preview. Retries are free. |
| Phone usability of 4-slot drag and 3-slot draft | Frustration | Tap-to-select fallback (section 11.2). Playtest on a real phone before launch. |

## 16. Open questions

These need a decision before implementation starts. Each has a proposed
default that the engine can start with.

- **O-1. Hero positional abilities vs a single boss.** The spec says *Cleave
  hits Front + Mid-Front* and *Snipe hits Back*, but the boss is one body.
  **Proposed default:** a hero's positional ability is a *range gate*. Cleave
  can only be used from Front or Mid-Front, and Snipe only from Back. A hero
  out of range falls back to the basic action. This makes slot placement a real
  decision without inventing boss zones.
- **O-2. Gold condition.** "Only 3 heroes, *or* in 3 turns or fewer" is read
  here as an **OR**. Confirm, since an AND would be much harder.
- **O-3. Mid-turn speed changes.** Weaver can change Speed. **Proposed
  default:** speed changes apply from the next turn's timeline. Mid-turn
  changes would make the order harder to read.
- **O-4. Overdrive chain.** If the next hero in the timeline is already
  scheduled for an Overdrive from a previous pulse, does the pulse carry to
  the following hero? **Proposed default:** no. A hero can receive at most one
  Overdrive per turn, and the pulse waits for the next free hero.
- **O-5. Blood Magic and dead casters.** The proposed default in section 8
  (caster drops to 1 HP rather than dying) differs from a simple "costs 20%".
  Confirm.
- **O-6. Relic count rule.** Are relics optional? **Proposed default:** yes.
  Up to 2 is a maximum, not a requirement.
- **O-7. Mutator stacking.** Should both mutators always apply, or can a day
  have only one? **Proposed default:** always both, for consistency with the
  spec.
- **O-8. Leaderboards.** Is a global board needed for v1, or is "beat your own
  par" enough? **Proposed default:** no board in v1.
- **O-9. Name.** *Party Line* is a working title. Confirm or replace.

## 17. Milestones

1. **M1: engine.** Pure simulation, Mana Pulse, positional targeting, death
   shifts, and the event log. Unit tests for every rule in section 5.
2. **M2: content and seed.** Hero roster (20+), relics, bosses, mutators, and
   the seed generator. Solver and verification tooling in `experiments/`.
3. **M3: par calibration.** Run the solver over generated days and set par and
   thresholds. Check the diversity and mutator-sanity rules.
4. **M4: UI.** Title, draft, planning with the Preview Timeline, fight
   playback, result, and the emoji grid.
5. **M5: polish and playtest.** Touch input on real phones, reduced motion,
   colour-blind check, and first-day live run.

## 18. Appendix: illustrative hero roster (placeholder)

Placeholder stats for documentation only. The real values come from the
balance pass in M2 and M3.

| Hero | Archetype | Speed | Basic action | Overdrive |
|---|---|---|---|---|
| Brannoc the Shieldbearer | Vanguard | 2 | Strike Front (4 dmg) | **Taunt**: boss skills hit his slot this turn |
| Mirelle the Ember-Mage | Arcanist | 5 | Spark All (1 dmg, tags Soaked) | Refill: the next pulse triggers one action sooner |
| Vex Quickblade | Striker | 9 | Stab Front (3 dmg) | **Execute**: +3 damage if target is Soaked |
| Oriel the Thread-Singer | Weaver | 6 | Swap adjacent allies | Speed boost: next ally +2 speed this turn |
| Harrow the Longshot | Striker | 7 | Snipe Back (3 dmg, Back only) | Odd-turn double shot |

Every example hero follows the rules in section 5. None of them has a random
element.
